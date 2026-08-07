import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
   *
   * Real bug found and fixed during this task's own local verification, not
   * caught by CI (see `engineering/testing` Skill entry #11's own origin
   * note): an earlier version of this handler took over the response itself
   * via `@Res({ passthrough: false })`, calling `res.send()` directly. That
   * call happens *inside* `TenantContextInterceptor`'s own
   * `db.transaction(async (tx) => ...)` callback -- which only issues
   * `COMMIT` *after* the callback (i.e., this handler) returns -- so the PDF
   * bytes could reach the client before the `report`/`audit_event` insert
   * had actually committed. Confirmed directly, not assumed: a same-process
   * follow-up query for the just-created `report` row intermittently found
   * zero rows immediately after a `200` response. Returning a
   * `StreamableFile` instead routes the response through Nest's own normal
   * post-interceptor pipeline (confirmed live via Context7's NestJS docs:
   * "Returns a StreamableFile instance to allow post-controller interceptor
   * logic to execute") -- the bytes are only sent once the full interceptor
   * chain, including the transaction commit, has resolved.
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
  ): Promise<StreamableFile> {
    const result = await assembleAndPersistReport(tx, {
      tenantId: request.authContext.tenantId,
      orderedTestId: id,
      actorPrincipalId: request.authContext.sub,
      actorRole: request.grantingRole,
    });

    return new StreamableFile(result.pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="report-${id}.pdf"`,
    });
  }
}
