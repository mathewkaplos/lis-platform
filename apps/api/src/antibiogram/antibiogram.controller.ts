import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  recordAntibiogramInputSchema,
  antibiogramResultSchema,
  type AntibiogramResult,
} from '@lis/domain';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { assembleAndPersistAntibiogram } from './antibiogram-assembly';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const orderedTestIdParamSchema = z.object({ orderedTestId: z.uuid() });
class OrderedTestIdParamDto extends createZodDto(orderedTestIdParamSchema) {}
class RecordAntibiogramDto extends createZodDto(recordAntibiogramInputSchema) {}
class AntibiogramResultDto extends createZodDto(antibiogramResultSchema) {}

type Tx = RequestWithTx['tx'];

/**
 * FEAT-053 (docs/plans/feat-053-susceptibility-interpretation-antibiogram.md).
 * `enter_result`-gated (proposal §1: "a human enters the raw MIC; the S/I/R
 * math is deterministic computation over that human-entered value, the same
 * class computeFlags() already is for chemistry results -- not an
 * autonomous clinical judgment"), same capability as every other raw-result-
 * entry action in this codebase. No `@Audit()`/`AuditInterceptor` -- like
 * `report.controller.ts`'s own `generate()`, the assembly function already
 * writes its own audit event inside the same transaction as its inserts.
 */
@Controller('v1/ordered-tests/:orderedTestId/antibiogram')
@UseGuards(JwtAuthGuard, CapabilityGuard)
@UseInterceptors(TenantContextInterceptor)
export class AntibiogramController {
  @Post()
  @HttpCode(201)
  @RequireCapability('enter_result')
  @ZodResponse({ type: AntibiogramResultDto, status: 201 })
  async record(
    @Param(new ZodValidationPipe(orderedTestIdParamSchema))
    { orderedTestId }: OrderedTestIdParamDto,
    @Body(new ZodValidationPipe(recordAntibiogramInputSchema))
    body: RecordAntibiogramDto,
    @Req() request: RequestWithGrantingRole,
    @DbTx() tx: Tx,
  ): Promise<AntibiogramResult> {
    return assembleAndPersistAntibiogram(tx, {
      tenantId: request.authContext.tenantId,
      orderedTestId,
      entries: body.results,
      actorPrincipalId: request.authContext.sub,
      actorRole: request.grantingRole,
    });
  }
}
