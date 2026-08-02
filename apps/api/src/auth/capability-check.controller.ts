import { randomUUID } from 'node:crypto';
import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { order, patient, verifyAuditChain } from '@lis/db';
import { sql } from 'drizzle-orm';
import { Audit } from './audit.decorator';
import { AuditInterceptor } from './audit.interceptor';
import { CapabilityGuard } from './capability.guard';
import { CurrentUser } from './current-user.decorator';
import { DbTx } from './db-tx.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequireCapability } from './require-capability.decorator';
import type { RequestContext } from './request-context';
import {
  TenantContextInterceptor,
  type RequestWithTx,
} from './tenant-context.interceptor';

/**
 * TASK-032/TASK-033 (FEAT-009) proof routes — no real result-entry/
 * verification feature exists yet (M3/M4), so these prove the capability +
 * audit mechanisms structurally, same standard TASK-030's
 * tenant-check.controller.ts already established for RLS binding ahead of a
 * real business feature needing it. `order` (already migrated by FEAT-006)
 * is the synthetic mutation target — never used for anything but this
 * proof. `order.patient_id` carries a real FK as of TASK-038 (previously a
 * forward-reference per ADR-0005, satisfied by any `randomUUID()`); see
 * `insertDemoPatient` below.
 */
@Controller('auth/capability-check')
export class CapabilityCheckController {
  /**
   * TASK-038 backfilled a real FK on order.patient_id (previously a
   * forward-reference per ADR-0005, so `randomUUID()` used to satisfy it
   * with no table to check against). Every route below needs a real patient
   * row to reference now — this helper is the minimal, throwaway fixture,
   * never used for anything but keeping these proof routes' `order` inserts
   * FK-valid.
   */
  private async insertDemoPatient(
    tx: RequestWithTx['tx'],
    tenantId: string,
  ): Promise<string> {
    const [row] = await tx
      .insert(patient)
      .values({
        tenantId,
        mrn: randomUUID(),
        firstName: 'Capability',
        lastName: 'Check',
        sex: 'U',
      })
      .returning();
    return row.id;
  }

  @Post('enter-result')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'order.enter_result_demo', resourceType: 'order' })
  async enterResult(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [row] = await tx
      .insert(order)
      .values({
        tenantId: user.tenantId,
        patientId: await this.insertDemoPatient(tx, user.tenantId),
        status: 'pending',
      })
      .returning();
    return { resourceId: row.id, before: null, after: { status: row.status } };
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('verify')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'order.verify_demo', resourceType: 'order' })
  async verify(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [row] = await tx
      .insert(order)
      .values({
        tenantId: user.tenantId,
        patientId: await this.insertDemoPatient(tx, user.tenantId),
        status: 'pending',
      })
      .returning();
    return { resourceId: row.id, before: null, after: { status: row.status } };
  }

  /**
   * Deliberately unaudited: capability-guarded and transaction-bound, but no
   * @Audit()/AuditInterceptor applied — proves the audit mechanism is
   * opt-in, not implicit (FEAT-009 proposal §8 item 7). Never used for
   * anything but this proof; every real route must always pair
   * TenantContextInterceptor + AuditInterceptor.
   */
  @Post('enter-result-unaudited')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor)
  async enterResultUnaudited(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const [row] = await tx
      .insert(order)
      .values({
        tenantId: user.tenantId,
        patientId: await this.insertDemoPatient(tx, user.tenantId),
        status: 'pending',
      })
      .returning();
    return { resourceId: row.id };
  }

  /**
   * Deliberately broken: returns a resourceId that is not a valid uuid,
   * which audit_event.resource_id (uuid NOT NULL) rejects — forcing a real
   * Postgres constraint violation inside writeAuditEvent's INSERT. Proves
   * the mutation above (the tx.insert(order) call) rolls back too, since
   * both run in the one transaction TenantContextInterceptor opened —
   * never used for anything but this proof (FEAT-009 proposal §6/§8 item 6).
   */
  @Post('enter-result-forced-audit-failure')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'order.enter_result_demo', resourceType: 'order' })
  async enterResultForcedAuditFailure(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    await tx.insert(order).values({
      tenantId: user.tenantId,
      patientId: await this.insertDemoPatient(tx, user.tenantId),
      status: 'pending',
    });
    return { resourceId: 'not-a-uuid', before: null, after: null };
  }

  @Get('order-count')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async orderCount(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const result = await tx.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM "order"`,
    );
    return { tenantId: user.tenantId, count: result.rows[0].count };
  }

  /**
   * Re-derives the caller's tenant's audit hash chain from stored content
   * (verifyAuditChain, TASK-025) and confirms it still validates after being
   * exercised through this controller's real interceptor-written rows, not
   * just its own pre-existing unit tests (FEAT-009 proposal §8 item 8).
   */
  @Get('audit-chain-valid')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async auditChainValid(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    return verifyAuditChain(tx, user.tenantId);
  }
}
