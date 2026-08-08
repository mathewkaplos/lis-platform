import {
  ConflictException,
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
  qcRuleViolationListItemSchema,
  type QcRuleViolationListItem,
  type QcRuleViolationResult,
} from '@lis/domain';
import { controlLot, qcRuleViolation } from '@lis/db';
import { desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { toQcRuleViolationDto } from '../control-lot/control-lot.controller';
import { Audit } from '../auth/audit.decorator';
import type { AuditedMutationResult } from '../auth/audit.interceptor';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const violationIdParamSchema = z.object({ id: z.uuid() });
class ViolationIdParamDto extends createZodDto(violationIdParamSchema) {}
// Query params always arrive as strings -- z.coerce.boolean() would coerce
// the literal string 'false' to `true` (Boolean('false') === true), the
// exact wrong-default footgun that would make `?resolved=false` behave like
// `?resolved=true`. No `.transform()` here deliberately: ADR-0013 §1's
// global ZodValidationPipe (APP_PIPE) already runs this same schema once,
// and this route's own explicit `@Query(new ZodValidationPipe(...))` runs it
// a second time on the ALREADY-transformed value -- harmless for a plain
// passthrough enum (`critical-notification.controller.ts`'s own `status`
// filter has always relied on exactly this double-run), but a real bug for
// a type-changing transform: the second pass would validate a real boolean
// against `z.enum(['true','false'])` and always fail. Comparing the raw
// string in `list()` below avoids the whole class of bug instead of fixing
// it once for this one field.
const listQuerySchema = z.object({
  resolved: z.enum(['true', 'false']).optional(),
});
class ListQueryDto extends createZodDto(listQuerySchema) {}
class QcRuleViolationListItemDto extends createZodDto(
  qcRuleViolationListItemSchema,
) {}

type Tx = RequestWithTx['tx'];

/**
 * TASK-070 (FEAT-020, ADR-0019 Decision 3). The resolution half of the QC
 * release gate `FinalizationRollupInterceptor` now enforces
 * (finalization-rollup.interceptor.ts) -- clears the hold on an unresolved,
 * rejection-severity `qc_rule_violation` so a held panel's rollup can
 * complete on its next `finalize()` call. Bare action, no body (mirrors
 * `critical-notification.controller.ts`'s own `acknowledge()` shape, minus
 * the read-back text this action has no equivalent of), gated by the new
 * `resolve_qc` capability -- not `verify` -- per ADR-0019's own reasoning
 * that resolving a QC failure and verifying a patient result are different
 * real-world actors (`qa` role, not `technologist`/`verifier`).
 *
 * No re-evaluation requirement: this route does not check for a fresh
 * in-control QC result before clearing the hold (ADR-0019 Consequences) --
 * that clinical judgment call belongs to the `qa` user, the same trust
 * boundary `verify()` already extends to a verifier for patient results.
 */
@Controller('v1/qc-rule-violations')
export class QcRuleViolationController {
  private async loadViolation(tx: Tx, id: string) {
    const [row] = await tx
      .select()
      .from(qcRuleViolation)
      .where(eq(qcRuleViolation.id, id))
      .limit(1);
    // RLS makes a cross-tenant row structurally invisible (engineering/
    // api-design entry #7).
    if (!row) {
      throw new NotFoundException('QC rule violation not found');
    }
    return row;
  }

  /**
   * Rejects an already-resolved violation with 409 rather than silently
   * overwriting who/when resolved it -- resolution is a one-time, documented
   * action, not an editable field (same discipline as `acknowledge()`'s own
   * already-acknowledged 409).
   */
  @Post(':id/resolve')
  @HttpCode(200) // an action on an existing resource, not a creation
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('resolve_qc')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({
    action: 'qc_rule_violation.resolve',
    resourceType: 'qc_rule_violation',
  })
  async resolve(
    @Param(new ZodValidationPipe(violationIdParamSchema))
    { id }: ViolationIdParamDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: Tx,
  ): Promise<AuditedMutationResult & { after: QcRuleViolationResult }> {
    const existing = await this.loadViolation(tx, id);
    if (existing.resolvedAt !== null) {
      throw new ConflictException(
        `QC rule violation ${id} is already resolved`,
      );
    }

    const before = toQcRuleViolationDto(existing);
    const [updated] = await tx
      .update(qcRuleViolation)
      .set({
        resolvedAt: new Date(),
        resolvedByUserId: user.sub,
      })
      .where(eq(qcRuleViolation.id, id))
      .returning();

    const after = toQcRuleViolationDto(updated);
    return { resourceId: after.id, before, after };
  }

  /**
   * The minimal violation-list screen's own read (proposal §10 Q2, folding
   * in issue #381 -- a QA user needs some screen to find an active
   * violation, not just the direct-link-only chart TASK-069 shipped).
   * Defaults to unresolved-only (`?resolved` omitted) -- an action queue,
   * not a full history browser (explicitly out of this feature's scope,
   * ADR-0019's own "not a full QC dashboard" framing). No capability gate --
   * any authenticated tenant user may read, matching
   * `critical-notification.controller.ts`'s own `list()` precedent. No
   * `@Audit()` -- an unmutating read (`engineering/api-design` entry #6).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: [QcRuleViolationListItemDto], status: 200 })
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto,
    @DbTx() tx: Tx,
  ): Promise<QcRuleViolationListItem[]> {
    const resolvedFilter = query.resolved === 'true';
    const rows = await tx
      .select({
        violation: qcRuleViolation,
        analyteId: controlLot.analyteId,
      })
      .from(qcRuleViolation)
      .innerJoin(controlLot, eq(controlLot.id, qcRuleViolation.controlLotId))
      .where(
        resolvedFilter
          ? isNotNull(qcRuleViolation.resolvedAt)
          : isNull(qcRuleViolation.resolvedAt),
      )
      .orderBy(desc(qcRuleViolation.detectedAt));

    return rows.map((row) => ({
      ...toQcRuleViolationDto(row.violation),
      analyteId: row.analyteId,
    }));
  }
}
