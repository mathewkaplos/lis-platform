import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { from, firstValueFrom, type Observable } from 'rxjs';
import { db } from './db';
import type { RequestWithAuthContext } from './jwt-auth.guard';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RequestWithTx = RequestWithAuthContext & { tx: Tx };

/**
 * ADR-0010: binds the authenticated tenant into the RLS session variable
 * every tenant-scoped table's policy reads, safely under apps/api's pooled
 * pg.Pool. Must run after JwtAuthGuard (needs request.authContext) — apply
 * both together on any tenant-scoped route.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithTx>();
    const tenantId = request.authContext.tenantId;

    return from(
      db.transaction(async (tx) => {
        // set_config(..., true) is the parameterized equivalent of `SET
        // LOCAL app.tenant_id = ...` (Postgres docs: "SET LOCAL ... is
        // equivalent to set_config(setting_name, new_value, true)") — used
        // instead of the literal SET LOCAL keyword because SET does not
        // accept bind parameters, and this repo does not string-interpolate
        // values into raw SQL when a parameterized form exists. Same
        // transaction-scoped guarantee ADR-0010 requires: automatically
        // cleared at COMMIT/ROLLBACK regardless of physical connection,
        // never session-level (`is_local: false`, which is what
        // rls-isolation-check.ts/golden-dataset-check.ts correctly use
        // instead, since those are single-shot single-tenant processes, not
        // a pooled multi-tenant server — see ADR-0010).
        await tx.execute(
          sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
        );
        request.tx = tx;
        // Runs the route handler inside this same transaction. If it
        // throws, the rejection propagates out of this callback and
        // drizzle rolls back; on success, drizzle commits. Explicit
        // `unknown` breaks CallHandler.handle()'s `Observable<any>` typing
        // from flowing into this callback's inferred return type.
        const result: unknown = await firstValueFrom(next.handle());
        return result;
      }),
    );
  }
}
