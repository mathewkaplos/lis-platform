import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  careRelationshipCreateSchema,
  patientCreateSchema,
  patientDetailSchema,
  patientMergeRequestSchema,
  patientSchema,
  patientSearchQuerySchema,
  patientUpdateSchema,
  PATIENT_SEARCH_RESULT_LIMIT,
  PATIENT_RECENT_RESULT_LIMIT,
  type CareRelationship,
  type Patient,
  type PatientDetail,
} from '@lis/domain';
import {
  careRelationship,
  invoice,
  observation,
  order,
  patient,
  patientAlert,
  patientPortalAccount,
} from '@lis/db';
import { and, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { isClinicianOnly, relatedPatientIds } from '../auth/clinician-scope';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const patientIdParamSchema = z.object({ id: z.uuid() });

class PatientCreateDto extends createZodDto(patientCreateSchema) {}
class PatientDto extends createZodDto(patientSchema) {}
class PatientDetailDto extends createZodDto(patientDetailSchema) {}
class PatientSearchQueryDto extends createZodDto(patientSearchQuerySchema) {}
class PatientIdParamDto extends createZodDto(patientIdParamSchema) {}
class PatientMergeRequestDto extends createZodDto(patientMergeRequestSchema) {}
class PatientUpdateDto extends createZodDto(patientUpdateSchema) {}
class CareRelationshipCreateDto extends createZodDto(
  careRelationshipCreateSchema,
) {}

function toCareRelationshipDto(
  row: typeof careRelationship.$inferSelect,
): CareRelationship {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Postgres unique_violation, per https://www.postgresql.org/docs/current/errcodes-appendix.html */
const UNIQUE_VIOLATION = '23505';

function pgErrorCode(err: unknown): string | undefined {
  return (err as { cause?: { code?: string } })?.cause?.code;
}

function pgConstraintName(err: unknown): string | undefined {
  return (err as { cause?: { constraint?: string } })?.cause?.constraint;
}

/**
 * TASK-039 (FEAT-011 proposal §10 Q1): MRN is server-generated, not
 * caller-supplied — retry-on-unique-violation, not TASK-045's own
 * "collision-safe under concurrent analyzer writes" mechanism, since patient
 * registration is human-initiated and low-frequency, not a high-throughput
 * automated feed.
 */
function generateMrn(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

const MAX_MRN_ATTEMPTS = 5;

/**
 * `packages/db/src/schema/patient.ts`'s `birthDate`/`createdAt` round-trip
 * through `drizzle-orm` as real `Date` objects; `packages/domain`'s
 * `patientSchema` models the wire shape (`z.iso.date()`/`z.iso.datetime()`
 * strings) — explicit here rather than relying on `@ZodResponse`'s
 * serializer to coerce a `Date` into an ISO string implicitly.
 */
// Exported for ClinicianController's own "my patients" list (FEAT-038) --
// same shape, no reason to duplicate this mapping.
export function toPatientDto(row: typeof patient.$inferSelect): Patient {
  return {
    ...row,
    sex: row.sex as Patient['sex'], // CHECK-constrained in Postgres (ck_patient_sex), not reflected in drizzle's plain `text` column type
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * TASK-039 (FEAT-011). First real domain-resource endpoint in this repo —
 * built against ADR-0013's minimal API baseline. `/v1/patients` per ADR-0013
 * §3 (new resource routes only; `/auth/*`/`/health` stay unversioned).
 *
 * Search/get-by-id are not @Audit()'d — Constitution Law #5 covers
 * significant *actions*, matching the existing convention that no read route
 * in this repo carries @Audit() (FEAT-011 proposal §5). Only creation is
 * audited, via the existing FEAT-009 mechanism, which is why it needs
 * `manage_patients` (CapabilityGuard populates `request.grantingRole`,
 * which AuditInterceptor requires — see the proposal §3/§10 Q2). Its
 * response is intentionally the existing `{resourceId, before, after}`
 * audited-mutation shape (same as capability-check.controller.ts's routes),
 * not run through `@ZodResponse` — layering nestjs-zod's own
 * response-serializing interceptor under AuditInterceptor's
 * response-transforming one (which appends `actorRole` after the handler
 * returns) is an untested interaction this task doesn't need to take on;
 * the two GET routes have no such interceptor and use `@ZodResponse`
 * directly.
 *
 * **Every `@Body()`/`@Query()`/`@Param()` below explicitly instantiates
 * `new ZodValidationPipe(schema)` — never relying on the global `APP_PIPE`
 * (`app.module.ts`) alone to infer the schema from the DTO class's
 * `design:paramtypes` metadata.** Found for real, not hypothetical, writing
 * this task's own e2e spec: `capability.guard.ts`'s own header comment
 * already documents that vitest's esbuild transform doesn't emit
 * `design:paramtypes` (constructor DI silently resolving to `undefined`);
 * the identical gap silently no-ops nestjs-zod's metatype-based DTO
 * detection for method parameters too — a malformed body reached this
 * controller's DB insert entirely unvalidated under the e2e test harness,
 * failing on a Postgres `NOT NULL` violation instead of a `400`. Passing the
 * schema explicitly bypasses reflection entirely, so it validates
 * correctly under both the real (tsc-compiled) server and this test suite.
 * The global pipe stays registered as a defense-in-depth default for future
 * routes that forget this, not as this controller's actual mechanism.
 */
@Controller('v1/patients')
export class PatientController {
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_patients')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'patient.create', resourceType: 'patient' })
  async create(
    @Body(new ZodValidationPipe(patientCreateSchema)) body: PatientCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    for (let attempt = 0; attempt < MAX_MRN_ATTEMPTS; attempt++) {
      try {
        const [row] = await tx
          .insert(patient)
          .values({
            tenantId: user.tenantId,
            mrn: generateMrn(),
            nationalId: body.nationalId,
            firstName: body.firstName,
            middleName: body.middleName,
            lastName: body.lastName,
            sex: body.sex,
            // Zod's `z.iso.date()` yields a plain date string; drizzle's
            // `date(..., { mode: "date" })` column expects a real `Date`.
            birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
            // FEAT-066 (ADR-0053).
            phone: body.phone,
            email: body.email,
            address: body.address,
            nextOfKinName: body.nextOfKinName,
            nextOfKinPhone: body.nextOfKinPhone,
          })
          .returning();
        return { resourceId: row.id, before: null, after: toPatientDto(row) };
      } catch (err) {
        if (
          pgErrorCode(err) === UNIQUE_VIOLATION &&
          pgConstraintName(err) === 'ux_patient_tenant_mrn'
        ) {
          continue; // regenerate and retry
        }
        if (
          pgErrorCode(err) === UNIQUE_VIOLATION &&
          pgConstraintName(err) === 'ux_patient_tenant_national_id'
        ) {
          throw new ConflictException(
            'A patient with this national ID already exists',
          );
        }
        throw err;
      }
    }
    throw new Error(
      `failed to generate a unique MRN after ${MAX_MRN_ATTEMPTS} attempts`,
    );
  }

  /**
   * Five mutually exclusive lookup shapes (`patientSearchQuerySchema`
   * requires exactly one): `mrn` (exact), `nationalId` (exact),
   * `firstName`+`lastName`+`birthDate` together (TASK-040's own duplicate-
   * detection check, not general search — case-insensitive on names, per
   * that task's proposal §10 Q1), `recent` (issue #716: the default
   * `/patients` view with no search term yet — most-recently-registered
   * first, capped at `PATIENT_RECENT_RESULT_LIMIT`), or `q` (TASK-041's free-text search:
   * case-insensitive partial match on name, prefix match on mrn/nationalId
   * — an MRN/national ID is typically typed in full or scanned, not
   * partially searched the way a name is). `q` results are capped at
   * `PATIENT_SEARCH_RESULT_LIMIT` since cursor pagination is deliberately
   * deferred (ADR-0013 §Decision 4, TASK-041 proposal §5/§10 Q2) — the other
   * three modes return at most one row each, so no cap applies there.
   * Tenant isolation is RLS alone (TenantContextInterceptor's `SET LOCAL`) —
   * no `tenantId` filter added in application code, matching every existing
   * read route in this repo (e.g. `order-count`'s plain unfiltered SELECT).
   *
   * FEAT-040 (proposal §10 Q1/Q2): a `clinician`-only principal (no
   * `technologist`/`verifier`/`qa` role also held) is additionally scoped to
   * patients with a real `care_relationship` row — every other role's
   * behavior is unchanged. Zero related patients returns an empty result,
   * not an error; this is a real, valid state for a newly onboarded
   * clinician.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [PatientDto], status: 200 })
  async search(
    @Query(new ZodValidationPipe(patientSearchQuerySchema))
    query: PatientSearchQueryDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Patient[]> {
    let scopeToPatientIds: string[] | undefined;
    if (isClinicianOnly(user.roles)) {
      scopeToPatientIds = await relatedPatientIds(tx, user.sub);
      if (scopeToPatientIds.length === 0) {
        return [];
      }
    }

    // Issue #716: "recent patients" default view -- most recently
    // registered first, capped much tighter than free-text search
    // (PATIENT_RECENT_RESULT_LIMIT, not PATIENT_SEARCH_RESULT_LIMIT). Same
    // merged-patient exclusion and clinician-scoping as the `q` branch
    // below.
    if (query.recent !== undefined) {
      const rows = await tx
        .select()
        .from(patient)
        .where(
          and(
            isNull(patient.mergedInto),
            scopeToPatientIds
              ? inArray(patient.id, scopeToPatientIds)
              : undefined,
          ),
        )
        .orderBy(desc(patient.createdAt))
        .limit(PATIENT_RECENT_RESULT_LIMIT);
      return rows.map(toPatientDto);
    }
    if (query.q !== undefined) {
      const term = query.q;
      const rows = await tx
        .select()
        .from(patient)
        .where(
          and(
            or(
              ilike(patient.firstName, `%${term}%`),
              ilike(patient.lastName, `%${term}%`),
              ilike(patient.mrn, `${term}%`),
              ilike(patient.nationalId, `${term}%`),
            ),
            // FEAT-065 (ADR-0052 Decision 4): a merged-away patient is no
            // longer the record a caller should act on going forward --
            // same default-exclusion precedent worklist.controller.ts's own
            // ACTIVE_STATUSES and case.controller.ts's own terminal-state
            // exclusion (FEAT-063) already established. The exact-match
            // mrn/nationalId/name+DOB branches below are deliberately
            // unchanged -- a merged-away patient's own identifiers must
            // still resolve directly to its own row (so a caller can follow
            // `mergedInto`), and TASK-040's duplicate-detection mode must
            // keep seeing every row regardless of merge status.
            isNull(patient.mergedInto),
            scopeToPatientIds
              ? inArray(patient.id, scopeToPatientIds)
              : undefined,
          ),
        )
        .limit(PATIENT_SEARCH_RESULT_LIMIT);
      return rows.map(toPatientDto);
    }
    const where = and(
      query.mrn !== undefined
        ? eq(patient.mrn, query.mrn)
        : query.nationalId !== undefined
          ? eq(patient.nationalId, query.nationalId)
          : and(
              ilike(patient.firstName, query.firstName as string),
              ilike(patient.lastName, query.lastName as string),
              eq(patient.birthDate, new Date(query.birthDate as string)),
            ),
      scopeToPatientIds ? inArray(patient.id, scopeToPatientIds) : undefined,
    );
    const rows = await tx.select().from(patient).where(where);
    return rows.map(toPatientDto);
  }

  /**
   * FEAT-040 (proposal §10 Q1/Q2): a `clinician`-only principal must also
   * have a real `care_relationship` row for this specific patient, or the
   * response is 404 — same "never leak existence" reasoning
   * `engineering/api-design` entry #7 already established for cross-tenant
   * access, applied here to "no relationship" too.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: PatientDetailDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(patientIdParamSchema))
    { id }: PatientIdParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<PatientDetail> {
    const [row] = await tx
      .select()
      .from(patient)
      .where(eq(patient.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible, not a leaked
    // "exists but forbidden" signal — a genuinely nonexistent id and a real
    // id belonging to another tenant are indistinguishable here, by design
    // (FEAT-011 proposal §7).
    if (!row) {
      throw new NotFoundException('Patient not found');
    }
    if (isClinicianOnly(user.roles)) {
      const related = await relatedPatientIds(tx, user.sub);
      if (!related.includes(id)) {
        throw new NotFoundException('Patient not found');
      }
    }
    // FEAT-065 (ADR-0052 Decision 3): a merged-away id resolves here with
    // `mergedInto` set (never a 404/redirect) -- the survivor's own
    // response includes the reverse `mergedFrom` list, so the merge is
    // visible from the ordinary read path, not only the audit trail.
    const mergedFromRows = await tx
      .select({ id: patient.id })
      .from(patient)
      .where(eq(patient.mergedInto, id));
    return {
      ...toPatientDto(row),
      mergedFrom: mergedFromRows.map((r) => r.id),
    };
  }

  /**
   * Issue #747 (docs/plans/task-747-patient-demographic-editing.md,
   * pilot-readiness audit follow-up): the only correction path for a
   * mistyped registration — no `PUT`/`PATCH` route existed for a patient at
   * all before this. `manage_patients`-gated, same capability `create()`
   * above uses (a front-desk-adjacent administrative action, not a clinical
   * one). Every field uses the `!== undefined ? body.x : before.x`
   * partial-update convention `org-settings.controller.ts`'s `update()`
   * already established — an omitted key never clobbers a value the caller
   * didn't mean to touch, while an explicit `null` clears it. `mrn` and
   * `tenantId` are absent from `patientUpdateSchema` entirely — not
   * editable (§10 Q3 of the proposal: no field-level lock beyond that for
   * this first pass).
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_patients')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'patient.update', resourceType: 'patient' })
  async update(
    @Param(new ZodValidationPipe(patientIdParamSchema))
    { id }: PatientIdParamDto,
    @Body(new ZodValidationPipe(patientUpdateSchema)) body: PatientUpdateDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [before] = await tx
      .select()
      .from(patient)
      .where(eq(patient.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible, same "never leak
    // existence" reasoning as getById() above.
    if (!before) {
      throw new NotFoundException('Patient not found');
    }

    try {
      const [after] = await tx
        .update(patient)
        .set({
          firstName:
            body.firstName !== undefined ? body.firstName : before.firstName,
          middleName:
            body.middleName !== undefined ? body.middleName : before.middleName,
          lastName:
            body.lastName !== undefined ? body.lastName : before.lastName,
          sex: body.sex !== undefined ? body.sex : before.sex,
          birthDate:
            body.birthDate !== undefined
              ? body.birthDate
                ? new Date(body.birthDate)
                : null
              : before.birthDate,
          nationalId:
            body.nationalId !== undefined ? body.nationalId : before.nationalId,
          phone: body.phone !== undefined ? body.phone : before.phone,
          email: body.email !== undefined ? body.email : before.email,
          address: body.address !== undefined ? body.address : before.address,
          nextOfKinName:
            body.nextOfKinName !== undefined
              ? body.nextOfKinName
              : before.nextOfKinName,
          nextOfKinPhone:
            body.nextOfKinPhone !== undefined
              ? body.nextOfKinPhone
              : before.nextOfKinPhone,
        })
        .where(eq(patient.id, id))
        .returning();
      return {
        resourceId: id,
        before: toPatientDto(before),
        after: toPatientDto(after),
      };
    } catch (err) {
      if (
        pgErrorCode(err) === UNIQUE_VIOLATION &&
        pgConstraintName(err) === 'ux_patient_tenant_national_id'
      ) {
        throw new ConflictException(
          'A patient with this national ID already exists',
        );
      }
      throw err;
    }
  }

  /**
   * FEAT-038 (proposal §10 Q1): the one new mechanism this task adds — a
   * lab-staff user assigns a clinician to a patient, which is how a
   * `care_relationship` row comes to exist outside a direct DB insert for
   * the first time (FEAT-040 shipped the table with no assignment endpoint
   * at all). Same `manage_patients` capability as `create()` above — this is
   * the same front-desk-adjacent administrative action, not a clinical one.
   */
  @Post(':id/care-relationships')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_patients')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'patient.assign_clinician', resourceType: 'patient' })
  async assignClinician(
    @Param(new ZodValidationPipe(patientIdParamSchema))
    { id }: PatientIdParamDto,
    @Body(new ZodValidationPipe(careRelationshipCreateSchema))
    body: CareRelationshipCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [patientRow] = await tx
      .select({ id: patient.id })
      .from(patient)
      .where(eq(patient.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible, same "never leak
    // existence" reasoning as getById() above.
    if (!patientRow) {
      throw new NotFoundException('Patient not found');
    }

    try {
      const [row] = await tx
        .insert(careRelationship)
        .values({
          tenantId: user.tenantId,
          clinicianUserId: body.clinicianUserId,
          patientId: id,
        })
        .returning();
      return {
        resourceId: row.id,
        before: null,
        after: toCareRelationshipDto(row),
      };
    } catch (err) {
      if (
        pgErrorCode(err) === UNIQUE_VIOLATION &&
        pgConstraintName(err) ===
          'ux_care_relationship_tenant_clinician_patient'
      ) {
        throw new ConflictException(
          'This clinician is already assigned to this patient',
        );
      }
      throw err;
    }
  }

  /**
   * FEAT-065 (ADR-0052, docs/plans/feat-065-patient-merge.md). `:id` is the
   * surviving patient; `body.loserPatientId` is merged into it. Physically
   * rewrites `patient_id` on every dependent table (ADR-0052 Decision 1) --
   * a one-time cost paid here so no query anywhere else ever needs to
   * resolve a merge chain. The loser's own row is never deleted, only
   * tombstoned via `mergedInto` (Decision 2/3) -- same "old row stays,
   * pointer moves forward" shape `observation.superseded_by`/
   * `caseReportVersion.supersededBy` already established.
   *
   * `manage_patients` (reused, matching `create()`/`assignClinician()`
   * above) + `@Audit()`/`AuditInterceptor` -- the same simple
   * `{resourceId, before, after}` shape those two routes already use is
   * sufficient here (contrast `case.controller.ts finalize()`'s own manual
   * `writeAuditEvent`, needed there only for step-up context this route has
   * none of).
   */
  @Post(':id/merge')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_patients')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'patient.merge', resourceType: 'patient' })
  async merge(
    @Param(new ZodValidationPipe(patientIdParamSchema))
    { id }: PatientIdParamDto,
    @Body(new ZodValidationPipe(patientMergeRequestSchema))
    body: PatientMergeRequestDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    if (body.loserPatientId === id) {
      throw new BadRequestException('Cannot merge a patient into itself');
    }

    const [survivor] = await tx
      .select()
      .from(patient)
      .where(eq(patient.id, id))
      .limit(1);
    if (!survivor) {
      throw new NotFoundException('Patient not found');
    }
    if (survivor.mergedInto) {
      throw new BadRequestException(
        `Cannot merge into patient ${id}: it has itself been merged into ${survivor.mergedInto} -- merge into that patient instead`,
      );
    }

    const [loser] = await tx
      .select()
      .from(patient)
      .where(eq(patient.id, body.loserPatientId))
      .limit(1);
    if (!loser) {
      throw new NotFoundException('Patient not found');
    }
    if (loser.mergedInto) {
      throw new BadRequestException(
        `Patient ${body.loserPatientId} has already been merged into ${loser.mergedInto}`,
      );
    }

    // ADR-0052 Decision 6: which Keycloak login should survive is a real
    // human decision this feature does not make automatically.
    const [survivorPortal] = await tx
      .select({ id: patientPortalAccount.id })
      .from(patientPortalAccount)
      .where(eq(patientPortalAccount.patientId, id))
      .limit(1);
    const [loserPortal] = await tx
      .select({ id: patientPortalAccount.id })
      .from(patientPortalAccount)
      .where(eq(patientPortalAccount.patientId, body.loserPatientId))
      .limit(1);
    if (survivorPortal && loserPortal) {
      throw new ConflictException(
        'Both patients already have their own portal account -- resolve which login should survive before merging',
      );
    }

    const movedOrders = await tx
      .update(order)
      .set({ patientId: id })
      .where(eq(order.patientId, body.loserPatientId))
      .returning({ id: order.id });
    const movedObservations = await tx
      .update(observation)
      .set({ patientId: id })
      .where(eq(observation.patientId, body.loserPatientId))
      .returning({ id: observation.id });
    const movedAlerts = await tx
      .update(patientAlert)
      .set({ patientId: id })
      .where(eq(patientAlert.patientId, body.loserPatientId))
      .returning({ id: patientAlert.id });
    const movedCareRelationships = await tx
      .update(careRelationship)
      .set({ patientId: id })
      .where(eq(careRelationship.patientId, body.loserPatientId))
      .returning({ id: careRelationship.id });
    const movedPortalAccounts = await tx
      .update(patientPortalAccount)
      .set({ patientId: id })
      .where(eq(patientPortalAccount.patientId, body.loserPatientId))
      .returning({ id: patientPortalAccount.id });
    const movedInvoices = await tx
      .update(invoice)
      .set({ patientId: id })
      .where(eq(invoice.patientId, body.loserPatientId))
      .returning({ id: invoice.id });

    const [updatedLoser] = await tx
      .update(patient)
      .set({ mergedInto: id })
      .where(eq(patient.id, body.loserPatientId))
      .returning();

    return {
      resourceId: id,
      before: {
        survivorId: id,
        loserPatientId: body.loserPatientId,
        reason: body.reason,
      },
      after: {
        survivor: toPatientDto(survivor),
        loser: toPatientDto(updatedLoser),
        movedCounts: {
          order: movedOrders.length,
          observation: movedObservations.length,
          patientAlert: movedAlerts.length,
          careRelationship: movedCareRelationships.length,
          patientPortalAccount: movedPortalAccounts.length,
          invoice: movedInvoices.length,
        },
      },
    };
  }
}
