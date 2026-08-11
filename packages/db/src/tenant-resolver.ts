import { eq } from "drizzle-orm";
import type { createDb } from "./client";
import { tenant } from "./schema/tenant";

type Db = ReturnType<typeof createDb>;

export type TenantRouting =
  | { tier: "shared" }
  | { tier: "dedicated_schema"; schemaName: string };

/**
 * ADR-0039: resolves a tenant's isolation tier from the global `tenant`
 * registry table (queried against the primary/control-plane pool, which
 * every tier's routing record lives in regardless of where that tenant's
 * own data ends up). Called once per request by `TenantContextInterceptor`,
 * before the request's own transaction opens.
 *
 * A tenant_id with no `tenant` row is treated as `shared` — this is not a
 * new gap, it is today's only actual behavior (every existing tenant has no
 * row in this brand-new table), so defaulting an unregistered tenant to the
 * tier the whole system already assumed keeps every current tenant working
 * unchanged.
 *
 * `dedicated_db` deliberately has no return case here: this feature (FEAT-045)
 * ships the enum value and the `connection_ref` column, but no second
 * physical connection pool. A tenant found with this tier throws rather than
 * silently falling back to `shared` — serving a data-residency-constrained
 * tenant's request against the wrong database would be a real Constitution
 * Law #4 violation, not a degraded convenience; refusing to serve it at all
 * is the fail-closed choice, matching this repo's established posture
 * (ADR-0011, ADR-0031).
 */
export async function resolveTenantRouting(db: Db, tenantId: string): Promise<TenantRouting> {
  const [row] = await db.select().from(tenant).where(eq(tenant.id, tenantId)).limit(1);

  if (!row || row.isolationTier === "shared") {
    return { tier: "shared" };
  }

  if (row.isolationTier === "dedicated_schema") {
    if (!row.schemaName) {
      throw new Error(
        `Tenant ${tenantId} is assigned isolation_tier 'dedicated_schema' but has no schema_name — refusing to route rather than falling back to shared (ADR-0039).`,
      );
    }
    return { tier: "dedicated_schema", schemaName: row.schemaName };
  }

  // row.isolationTier === "dedicated_db"
  throw new Error(
    `Tenant ${tenantId} is assigned isolation_tier 'dedicated_db', which has no working routing path yet (ADR-0039) — refusing to serve this request against the wrong database rather than silently falling back to shared.`,
  );
}
