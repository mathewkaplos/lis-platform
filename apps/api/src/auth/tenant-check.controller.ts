import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CurrentUser } from './current-user.decorator';
import { DbTx } from './db-tx.decorator';
import { db } from './db';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { RequestContext } from './request-context';
import {
  TenantContextInterceptor,
  type RequestWithTx,
} from './tenant-context.interceptor';

/**
 * TASK-030 (FEAT-008) verification-only routes — proving ADR-0010's binding
 * mechanism through the live API, not just in SQL (the literal AC). Not a
 * business feature: audit_event is used only because it's the simplest
 * already-existing tenant-scoped table with no required FKs to seed.
 */
@Controller('auth')
export class TenantCheckController {
  /**
   * Bound path: guard + interceptor, query runs inside the transaction the
   * interceptor opened. Correctly tenant-isolated by construction.
   */
  @Get('tenant-audit-count')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  async boundCount(
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const result = await tx.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM audit_event`,
    );
    return { tenantId: user.tenantId, count: result.rows[0].count };
  }

  /**
   * Deliberately unbound: guard only, no interceptor — proves ADR-0010's
   * fail-closed requirement. A tenant-scoped query reached without SET
   * LOCAL having run must error, not silently return the wrong tenant's
   * rows or an empty-but-plausible 200. Never used for anything but this
   * proof.
   */
  @Get('tenant-audit-count-unbound')
  @UseGuards(JwtAuthGuard)
  async unboundCount() {
    const result = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM audit_event`,
    );
    return { count: result.rows[0].count };
  }
}
