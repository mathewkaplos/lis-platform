import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import { assembleAndPersistReport } from './report-assembly';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';

const orderedTestIdParamSchema = z.object({ id: z.uuid() });
class OrderedTestIdParamDto extends createZodDto(orderedTestIdParamSchema) {}

/**
 * TASK-060 (FEAT-016 revision, docs/plans/feat-016-minimal-report.md §1
 * findings #2/#3). This repo's first route returning raw, non-JSON bytes —
 * deliberately excluded from the `@ZodResponse`/OpenAPI-schema convention
 * every other route follows (finding #2): a PDF has no meaningful JSON
 * schema, and `apps/web` calls this route via a direct authenticated
 * `fetch`, not the typed `@lis/sdk` client.
 *
 * No `@Audit()`/`AuditInterceptor` here (finding #3) — `assembleAndPersistReport`
 * already writes its own `report.generate` audit event directly, inside the
 * same transaction as the `report` row insert; `AuditInterceptor`'s own
 * contract (a JSON `before`/`after` shape) has no sensible meaning for a
 * raw-bytes response, and applying it here would double-audit the same
 * action. Only `TenantContextInterceptor` is applied, for `tx`/RLS binding.
 *
 * Gated behind the existing `verify` capability (§10 Q2, resolved): a
 * generated report is this feature's own final, clinically-signed artifact,
 * gated the same way `verify` itself already is (TASK-055) rather than a
 * laxer standard for the artifact that *depends on* verification.
 */
@Controller('v1/ordered-tests/:id')
export class ReportController {
  /**
   * Side-effecting on every call — a new `report` row + audit event, every
   * time, first request or repeat (§5 assumption, matching TASK-046/059's
   * own "every print/generate, first or repeat, audited identically"
   * precedent) — hence `POST`, not `GET`, even though `apps/web`'s own
   * Route Handler is what the browser actually reaches via a plain-link
   * `GET` (finding #4 in the plan doc: the two layers are allowed to
   * differ, since only `apps/web`'s edge is browser-visible).
   */
  @Post('report')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('verify')
  @UseInterceptors(TenantContextInterceptor)
  async generate(
    @Param(new ZodValidationPipe(orderedTestIdParamSchema))
    { id }: OrderedTestIdParamDto,
    @Req() request: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
    @Res({ passthrough: false }) res: FastifyReply,
  ): Promise<void> {
    // A thrown ConflictException (not all analytes verified) propagates to
    // Nest's own exception-filter layer (ProblemDetailsFilter) exactly as
    // it does on every other route — @Res() only changes how a *successful*
    // response is sent, not exception handling, since `res` is never
    // touched until after this call resolves.
    const result = await assembleAndPersistReport(tx, {
      tenantId: request.authContext.tenantId,
      orderedTestId: id,
      actorPrincipalId: request.authContext.sub,
      actorRole: request.grantingRole,
    });

    res
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="report-${id}.pdf"`)
      .send(result.pdf);
  }
}
