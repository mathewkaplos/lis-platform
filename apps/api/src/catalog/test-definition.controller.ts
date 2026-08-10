import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  testDefinitionCreateSchema,
  type TestDefinitionResult,
} from '@lis/domain';
import { analyte, testAnalyte, testDefinition } from '@lis/db';
import { inArray } from 'drizzle-orm';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
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

class TestDefinitionCreateDto extends createZodDto(
  testDefinitionCreateSchema,
) {}

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). `POST /v1/test-
 * definitions` -- creates a tenant-scoped `test_definition` and binds it to
 * one or more already-existing global `analyte` rows via `test_analyte`, in
 * one transaction. Analyte *creation* is explicitly out of scope (proposal
 * §10 Q1) -- every `analyteIds` entry must already exist; validated
 * up front (mirroring `order.controller.ts`'s own
 * "query the referenced ids, diff against requested, 400 on any miss"
 * shape) rather than left to a raw FK-violation 500.
 *
 * `@Audit()`'d and `manage_catalog`-gated (`qa` only) -- creating a test
 * changes what every future order/result-entry screen offers, a real
 * operationally-significant action (Constitution Law #5), matching every
 * other `@Audit()`'d creation route's own precedent
 * (`patient.controller.ts`'s `create()`).
 */
@Controller('v1/test-definitions')
export class TestDefinitionController {
  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_catalog')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'test_definition.create', resourceType: 'test_definition' })
  async create(
    @Body(new ZodValidationPipe(testDefinitionCreateSchema))
    body: TestDefinitionCreateDto,
    @CurrentUser() user: RequestContext,
    @DbTx() tx: RequestWithTx['tx'],
  ) {
    const visibleAnalytes = await tx
      .select({ id: analyte.id })
      .from(analyte)
      .where(inArray(analyte.id, body.analyteIds));
    const visibleIds = new Set(visibleAnalytes.map((row) => row.id));
    const missing = body.analyteIds.filter((id) => !visibleIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown analyte id(s): ${missing.join(', ')}`,
      );
    }

    const [testDefinitionRow] = await tx
      .insert(testDefinition)
      .values({
        tenantId: user.tenantId,
        code: body.code,
        displayName: body.displayName,
      })
      .returning();

    await tx.insert(testAnalyte).values(
      body.analyteIds.map((analyteId) => ({
        tenantId: user.tenantId,
        testDefinitionId: testDefinitionRow.id,
        analyteId,
      })),
    );

    const after: TestDefinitionResult = {
      id: testDefinitionRow.id,
      code: testDefinitionRow.code,
      displayName: testDefinitionRow.displayName,
      analyteIds: body.analyteIds,
    };
    return { resourceId: testDefinitionRow.id, before: null, after };
  }
}
