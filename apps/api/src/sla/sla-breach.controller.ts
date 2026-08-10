import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  slaBreachListQuerySchema,
  slaBreachSchema,
  type SlaBreachResult,
} from '@lis/domain';
import { slaBreach } from '@lis/db';
import { desc, eq } from 'drizzle-orm';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

class ListQueryDto extends createZodDto(slaBreachListQuerySchema) {}
class SlaBreachDto extends createZodDto(slaBreachSchema) {}

type Tx = RequestWithTx['tx'];
type SlaBreachRow = typeof slaBreach.$inferSelect;

function toSlaBreachDto(row: SlaBreachRow): SlaBreachResult {
  return {
    id: row.id,
    orderedTestId: row.orderedTestId,
    priority: row.priority as SlaBreachResult['priority'],
    targetMinutes: row.targetMinutes,
    breachedAt: row.breachedAt.toISOString(),
    status: row.status as SlaBreachResult['status'],
    escalationLevel: row.escalationLevel,
    lastEscalatedAt: row.lastEscalatedAt
      ? row.lastEscalatedAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * FEAT-029 (remainder, docs/plans/feat-029-sla-timers-workflow-migration.md
 * §10 Q2). Gated behind `view_operational_reports` (already `qa`-only, the
 * "lab-oversight" persona FEAT-034 established) rather than a new
 * capability invented for one list endpoint -- revisit with a narrower
 * capability if a future feature needs a different split. Unaudited (a
 * read; `engineering/api-design` Skill entry #6).
 */
@Controller('v1/sla-breaches')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@UseInterceptors(TenantContextInterceptor)
export class SlaBreachController {
  @Get()
  @RequireCapability('view_operational_reports')
  @ZodResponse({ type: [SlaBreachDto], status: 200 })
  async list(
    @Query(new ZodValidationPipe(slaBreachListQuerySchema)) query: ListQueryDto,
    @DbTx() tx: Tx,
  ): Promise<SlaBreachResult[]> {
    const rows = query.status
      ? await tx
          .select()
          .from(slaBreach)
          .where(eq(slaBreach.status, query.status))
          .orderBy(desc(slaBreach.breachedAt))
      : await tx.select().from(slaBreach).orderBy(desc(slaBreach.breachedAt));

    return rows.map(toSlaBreachDto);
  }
}
