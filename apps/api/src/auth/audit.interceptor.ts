import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { writeAuditEvent } from '@lis/db';
import { from, firstValueFrom, type Observable } from 'rxjs';
import { AUDIT_KEY, type AuditMetadata } from './audit.decorator';
import type { RequestWithGrantingRole } from './capability.guard';
import type { RequestWithTx } from './tenant-context.interceptor';

export interface AuditedMutationResult {
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

type RequestWithAuditContext = RequestWithTx & RequestWithGrantingRole;

/**
 * Must run after TenantContextInterceptor (needs request.tx) and after
 * CapabilityGuard (needs request.grantingRole) — apply as
 * @UseInterceptors(TenantContextInterceptor, AuditInterceptor) alongside
 * @UseGuards(JwtAuthGuard, CapabilityGuard) on any route decorated with
 * @Audit(...). The route handler itself must return an
 * AuditedMutationResult (resourceId + before/after/reason).
 *
 * Writes the audit_event row through request.tx — the SAME transaction the
 * mutation ran in, never a follow-up write (Constitution Law #5: "written
 * in the same transaction as the change"). Because TenantContextInterceptor
 * wraps this interceptor's whole call in db.transaction(...), a failure
 * here (e.g. a constraint violation on the audit insert) propagates out and
 * rolls back the mutation too, by construction — proven, not just reasoned
 * about, by capability-check.controller.ts's `*-forced-audit-failure` route,
 * which deliberately returns a malformed resourceId to force exactly this.
 *
 * A route with no @Audit() metadata is not audited by this interceptor at
 * all — same opt-in shape as JwtAuthGuard/TenantContextInterceptor/
 * CapabilityGuard: every route that mutates clinical data must apply the
 * decorator explicitly, nothing is enforced by default.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!metadata) {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithAuditContext>();

    return from(
      (async () => {
        const result = (await firstValueFrom(
          next.handle(),
        )) as AuditedMutationResult;

        await writeAuditEvent(request.tx, {
          tenantId: request.authContext.tenantId,
          actorPrincipalId: request.authContext.sub,
          actorRole: request.grantingRole,
          actorType: 'human',
          action: metadata.action,
          resourceType: metadata.resourceType,
          resourceId: result.resourceId,
          before: result.before,
          after: result.after,
          reason: result.reason,
        });

        return { ...result, actorRole: request.grantingRole };
      })(),
    );
  }
}
