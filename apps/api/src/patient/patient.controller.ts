import { randomBytes } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  patientCreateSchema,
  patientSchema,
  patientSearchQuerySchema,
  PATIENT_SEARCH_RESULT_LIMIT,
  type Patient,
} from '@lis/domain';
import { patient } from '@lis/db';
import { and, eq, ilike, or } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
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
class PatientSearchQueryDto extends createZodDto(patientSearchQuerySchema) {}
class PatientIdParamDto extends createZodDto(patientIdParamSchema) {}

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
function toPatientDto(row: typeof patient.$inferSelect): Patient {
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
   * Four mutually exclusive lookup shapes (`patientSearchQuerySchema`
   * requires exactly one): `mrn` (exact), `nationalId` (exact),
   * `firstName`+`lastName`+`birthDate` together (TASK-040's own duplicate-
   * detection check, not general search — case-insensitive on names, per
   * that task's proposal §10 Q1), or `q` (TASK-041's free-text search:
   * case-insensitive partial match on name, prefix match on mrn/nationalId
   * — an MRN/national ID is typically typed in full or scanned, not
   * partially searched the way a name is). `q` results are capped at
   * `PATIENT_SEARCH_RESULT_LIMIT` since cursor pagination is deliberately
   * deferred (ADR-0013 §Decision 4, TASK-041 proposal §5/§10 Q2) — the other
   * three modes return at most one row each, so no cap applies there.
   * Tenant isolation is RLS alone (TenantContextInterceptor's `SET LOCAL`) —
   * no `tenantId` filter added in application code, matching every existing
   * read route in this repo (e.g. `order-count`'s plain unfiltered SELECT).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [PatientDto], status: 200 })
  async search(
    @Query(new ZodValidationPipe(patientSearchQuerySchema))
    query: PatientSearchQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Patient[]> {
    if (query.q !== undefined) {
      const term = query.q;
      const rows = await tx
        .select()
        .from(patient)
        .where(
          or(
            ilike(patient.firstName, `%${term}%`),
            ilike(patient.lastName, `%${term}%`),
            ilike(patient.mrn, `${term}%`),
            ilike(patient.nationalId, `${term}%`),
          ),
        )
        .limit(PATIENT_SEARCH_RESULT_LIMIT);
      return rows.map(toPatientDto);
    }
    const where =
      query.mrn !== undefined
        ? eq(patient.mrn, query.mrn)
        : query.nationalId !== undefined
          ? eq(patient.nationalId, query.nationalId)
          : and(
              ilike(patient.firstName, query.firstName as string),
              ilike(patient.lastName, query.lastName as string),
              eq(patient.birthDate, new Date(query.birthDate as string)),
            );
    const rows = await tx.select().from(patient).where(where);
    return rows.map(toPatientDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: PatientDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(patientIdParamSchema))
    { id }: PatientIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Patient> {
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
    return toPatientDto(row);
  }
}
