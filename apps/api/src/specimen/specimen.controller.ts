import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  specimenCreateSchema,
  specimenLabelSchema,
  specimenSchema,
  specimenSearchQuerySchema,
  type Specimen,
  type SpecimenLabel,
} from '@lis/domain';
import {
  generateAccessionNumber,
  order,
  orderedTest,
  specimen,
  specimenFulfillment,
} from '@lis/db';
import { eq, inArray } from 'drizzle-orm';
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
import { renderSpecimenLabel } from './label-render';

const specimenIdParamSchema = z.object({ id: z.uuid() });

class SpecimenCreateDto extends createZodDto(specimenCreateSchema) {}
class SpecimenDto extends createZodDto(specimenSchema) {}
class SpecimenSearchQueryDto extends createZodDto(specimenSearchQuerySchema) {}
class SpecimenIdParamDto extends createZodDto(specimenIdParamSchema) {}
class SpecimenLabelDto extends createZodDto(specimenLabelSchema) {}

function toSpecimenDto(
  row: typeof specimen.$inferSelect,
  fulfilledOrderedTestIds?: string[],
): Specimen {
  return {
    ...row,
    status: row.status as Specimen['status'], // CHECK-constrained (ck_specimen_status)
    rejectionReason: row.rejectionReason as Specimen['rejectionReason'], // CHECK-constrained (ck_specimen_rejection_reason)
    collectionContext:
      (row.collectionContext as Record<string, unknown> | null) ?? null,
    collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
    // TASK-440: always an explicit key (never omitted-when-undefined) --
    // create()'s `after` payload feeds AuditInterceptor's hash, same
    // stability requirement this file's own header comment already states
    // for `fulfilledOrderedTestIds`.
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    // Only set when actually resolved (search()/getById()) — never an
    // explicit `fulfilledOrderedTestIds: undefined` key. create()'s
    // response feeds AuditInterceptor's `after` payload; an explicit
    // undefined-valued key there breaks that audit row's hash (see
    // order.controller.ts's own `patient` field comment and
    // packages/db/src/audit.ts's header — the exact same class of bug,
    // avoided here proactively rather than rediscovered).
    ...(fulfilledOrderedTestIds ? { fulfilledOrderedTestIds } : {}),
  };
}

/** TASK-046 revision §2/§5: renders both barcode SVGs from the specimen's
 * own accession number — no other field is ever passed to `bwip-js`. */
function toSpecimenLabelDto(row: typeof specimen.$inferSelect): SpecimenLabel {
  const { code128Svg, dataMatrixSvg } = renderSpecimenLabel(
    row.accessionNumber,
  );
  return {
    accessionNumber: row.accessionNumber,
    specimenType: row.specimenType,
    receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
    code128Svg,
    dataMatrixSvg,
  };
}

/**
 * TASK-047 (FEAT-013). First real writer to `specimen`/`specimen_fulfillment`
 * (both created by TASK-023 with zero prior consumers — revision §1).
 * `/v1/specimens` per ADR-0013 §3.
 *
 * One combined create action (revision §1 finding #2, §5): `accessionNumber`
 * is `NOT NULL` on `specimen`, and `rejected` is a state reachable only from
 * `received` (already-accessioned) per the schema's own header comment — so
 * an accession number is generated unconditionally on every call, and
 * `rejectionReason`'s presence/absence in the body is what decides
 * `status: 'accessioned'` vs. `status: 'rejected'`. This also means the
 * schema-valid `'collected'`/`'received'` intermediate states are never
 * written by this task (revision §10 Q3, human-approved 2026-08-05) — no
 * separate "record collection" task exists anywhere in this feature.
 *
 * Every `@Body()`/`@Query()`/`@Param()` below explicitly instantiates `new
 * ZodValidationPipe(schema)`, matching every other controller in this repo
 * (`engineering/api-design` entry #8: vitest's esbuild transform doesn't
 * emit `design:paramtypes`, so the global pipe alone can't identify a DTO
 * class by reflection under this repo's test harness).
 */
@Controller('v1/specimens')
export class SpecimenController {
  /**
   * revision §5: `orderedTestIds`, if omitted, defaults to every currently
   * `'ordered'` OrderedTest on `orderId` — not a catalog-driven auto-split
   * (no per-test container/volume requirement data exists anywhere in this
   * repo, `domain/specimen-lifecycle` Skill entry #3). A caller-supplied
   * `orderedTestIds` is checked for RLS visibility and `orderId` match the
   * same way order.controller.ts checks referenced patient/panel/test ids —
   * a nonexistent or mismatched id fails the whole request with `400`,
   * never a partial specimen.
   */
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'specimen.receive', resourceType: 'specimen' })
  async create(
    @Body(new ZodValidationPipe(specimenCreateSchema)) body: SpecimenCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [orderRow] = await tx
      .select({ id: order.id })
      .from(order)
      .where(eq(order.id, body.orderId))
      .limit(1);
    if (!orderRow) {
      throw new BadRequestException(`Unknown order id: ${body.orderId}`);
    }

    const orderedTestsForOrder = await tx
      .select()
      .from(orderedTest)
      .where(eq(orderedTest.orderId, body.orderId));

    let resolvedOrderedTestIds: string[];
    if (body.orderedTestIds !== undefined) {
      const visibleIds = new Set(orderedTestsForOrder.map((row) => row.id));
      const missing = body.orderedTestIds.filter((id) => !visibleIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(
          `Unknown ordered test id(s) for this order: ${missing.join(', ')}`,
        );
      }
      resolvedOrderedTestIds = body.orderedTestIds;
    } else {
      resolvedOrderedTestIds = orderedTestsForOrder
        .filter((row) => row.status === 'ordered')
        .map((row) => row.id);
    }

    if (resolvedOrderedTestIds.length === 0) {
      throw new BadRequestException(
        'No ordered tests on this order are eligible to be fulfilled (already collected, cancelled, or none exist)',
      );
    }

    const accessionNumber = await generateAccessionNumber(tx);
    const isRejected = body.rejectionReason !== undefined;

    const [specimenRow] = await tx
      .insert(specimen)
      .values({
        tenantId: user.tenantId,
        accessionNumber,
        specimenType: body.specimenType,
        status: isRejected ? 'rejected' : 'accessioned',
        rejectionReason: body.rejectionReason ?? null,
        collectionContext: body.collectionContext ?? null,
        collectedAt: body.collectedAt ? new Date(body.collectedAt) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        receivedAt: new Date(),
      })
      .returning();

    await tx.insert(specimenFulfillment).values(
      resolvedOrderedTestIds.map((orderedTestId) => ({
        tenantId: user.tenantId,
        specimenId: specimenRow.id,
        orderedTestId,
      })),
    );

    await tx
      .update(orderedTest)
      .set({ status: isRejected ? 'rejected' : 'received' })
      .where(inArray(orderedTest.id, resolvedOrderedTestIds));

    return {
      resourceId: specimenRow.id,
      before: null,
      after: toSpecimenDto(specimenRow, resolvedOrderedTestIds),
    };
  }

  /** revision §10 Q1: the reception screen's own lookup fallback — search by
   * `orderId` when the scanned/typed value isn't found as an Order id
   * directly. No free-text mode; that's the existing `/orders` search. */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [SpecimenDto], status: 200 })
  async search(
    @Query(new ZodValidationPipe(specimenSearchQuerySchema))
    query: SpecimenSearchQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Specimen[]> {
    if (query.orderId === undefined) {
      return [];
    }
    // No join precedent exists elsewhere in this repo (order.controller.ts's
    // own search() resolves multi-table data via separate queries + an
    // in-memory map, not .innerJoin()) — matched here rather than
    // introducing a first, untested join-result-key convention.
    const orderedTestsForOrder = await tx
      .select({ id: orderedTest.id })
      .from(orderedTest)
      .where(eq(orderedTest.orderId, query.orderId));
    const orderedTestIds = orderedTestsForOrder.map((row) => row.id);
    if (orderedTestIds.length === 0) {
      return [];
    }

    const fulfillmentRows = await tx
      .select()
      .from(specimenFulfillment)
      .where(inArray(specimenFulfillment.orderedTestId, orderedTestIds));

    const specimenIds = Array.from(
      new Set(fulfillmentRows.map((row) => row.specimenId)),
    );
    if (specimenIds.length === 0) {
      return [];
    }

    const rows = await tx
      .select()
      .from(specimen)
      .where(inArray(specimen.id, specimenIds));

    const orderedTestIdsBySpecimenId = new Map<string, string[]>();
    for (const row of fulfillmentRows) {
      const existing = orderedTestIdsBySpecimenId.get(row.specimenId) ?? [];
      existing.push(row.orderedTestId);
      orderedTestIdsBySpecimenId.set(row.specimenId, existing);
    }

    return rows.map((row) =>
      toSpecimenDto(row, orderedTestIdsBySpecimenId.get(row.id) ?? []),
    );
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: SpecimenDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(specimenIdParamSchema))
    { id }: SpecimenIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<Specimen> {
    const [row] = await tx
      .select()
      .from(specimen)
      .where(eq(specimen.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!row) {
      throw new NotFoundException('Specimen not found');
    }
    const fulfillmentRows = await tx
      .select()
      .from(specimenFulfillment)
      .where(eq(specimenFulfillment.specimenId, id));
    return toSpecimenDto(
      row,
      fulfillmentRows.map((r) => r.orderedTestId),
    );
  }

  /**
   * TASK-046 revision §2: unaudited preview — a pure read with no side
   * effect (`engineering/api-design` entry #6: only mutating, operationally
   * significant actions are audited; no existing GET route carries
   * `@Audit()`). Lets a receiving user check a label looks right without
   * that preview itself being logged as a print.
   */
  @Get(':id/label')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: SpecimenLabelDto, status: 200 })
  async label(
    @Param(new ZodValidationPipe(specimenIdParamSchema))
    { id }: SpecimenIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<SpecimenLabel> {
    const [row] = await tx
      .select()
      .from(specimen)
      .where(eq(specimen.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/api-design entry #7).
    if (!row) {
      throw new NotFoundException('Specimen not found');
    }
    return toSpecimenLabelDto(row);
  }

  /**
   * TASK-046 revision §2/§10 Q1/Q2. Action sub-resource matching
   * order.controller.ts's own `POST /:id/cancel` shape exactly: slash, not
   * KB-08's literal colon-suffix (entry #11 — confirmed broken under this
   * repo's real Fastify adapter). Same `manage_specimens` capability gate
   * TASK-047 already uses — no new capability. Audited via the existing
   * `audit_event` mechanism (`specimen.label_print`) rather than a new
   * print-log table; "who printed what and when" (KB-24) is answered by
   * querying `audit_event`. Every print — first or repeat — is audited
   * identically (§10 Q2, human-resolved 2026-08-05: no reprint-reason code,
   * no `printedAt`/`printCount` column). Mutates nothing on `specimen`
   * itself, so `before`/`after` are the same label snapshot, not a
   * null-before (which would imply creation).
   */
  @Post(':id/print')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'specimen.label_print', resourceType: 'specimen' })
  async print(
    @Param(new ZodValidationPipe(specimenIdParamSchema))
    { id }: SpecimenIdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [row] = await tx
      .select()
      .from(specimen)
      .where(eq(specimen.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Specimen not found');
    }
    const label = toSpecimenLabelDto(row);
    return {
      resourceId: row.id,
      before: label,
      after: label,
    };
  }
}
