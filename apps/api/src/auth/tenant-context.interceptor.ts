import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { resolveTenantRouting } from '@lis/db';
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
 *
 * ADR-0039: also resolves the tenant's isolation tier and, for a
 * `dedicated_schema` tenant, binds `search_path` for the rest of the
 * transaction so its queries land in its own schema. Every tenant with no
 * `tenant` row (i.e. every tenant that existed before FEAT-045) resolves to
 * `shared` — today's only behavior, unchanged.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithTx>();
    const tenantId = request.authContext.tenantId;

    return from(
      (async () => {
        // ADR-0039: resolved against the primary/control-plane pool, before
        // this request's own transaction opens — the `tenant` table is
        // global (no RLS, ADR-0038), so it needs no tenant context bound to
        // be queried safely. A `dedicated_db` tenant throws here (fail
        // closed, see resolveTenantRouting's own doc comment) rather than
        // this interceptor ever opening a transaction against the wrong
        // database.
        const routing = await resolveTenantRouting(db, tenantId);

        return db.transaction(async (tx) => {
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

          // ADR-0039: a `dedicated_schema` tenant additionally gets
          // unqualified table references routed into its own schema for the
          // rest of this transaction — same `set_config(..., true)`
          // transaction-scope guarantee as `app.tenant_id` above, applied to
          // the real `search_path` GUC (not a custom one, but `set_config`
          // works identically for either). `public` stays on the path so any
          // genuinely global table (analyte/unit/code_system_value/tenant)
          // still resolves normally.
          if (routing.tier === 'dedicated_schema') {
            await tx.execute(
              sql`SELECT set_config('search_path', ${`${routing.schemaName}, public`}, true)`,
            );
          }

          request.tx = tx;
          // Runs the route handler inside this same transaction. If it
          // throws, the rejection propagates out of this callback and
          // drizzle rolls back; on success, drizzle commits. Explicit
          // `unknown` breaks CallHandler.handle()'s `Observable<any>` typing
          // from flowing into this callback's inferred return type.
          const result: unknown = await firstValueFrom(next.handle());
          return result;
        });
      })(),
    );
  }
}
