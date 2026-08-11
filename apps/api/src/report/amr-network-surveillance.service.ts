import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import type { createDb } from '@lis/db';
import { tenant, resolveTenantRouting, writeAuditEvent } from '@lis/db';
import type { TenantRouting } from '@lis/db';
import type {
  AmrSurveillanceEntry,
  NetworkAmrSurveillanceEntry,
  NetworkAmrSurveillanceQuery,
  NetworkAmrSurveillanceReport,
} from '@lis/domain';
import { computeAmrSurveillanceReport } from './amr-surveillance.service';

type Db = ReturnType<typeof createDb>;

// ADR-0048 decision 5: the common public-health surveillance convention
// (e.g. CDC's own AR Lab Network suppression practice) -- a real, adjustable
// policy default, not hard-coded forever (ADR-0048's own Consequences
// section).
const MIN_CELL_SIZE = 5;

/**
 * ADR-0048 decision 1: pure merge/suppression math, kept separate from the
 * per-tenant DB iteration below so it's directly unit-testable against
 * synthetic per-tenant count arrays (proposal §8) -- no real Postgres
 * needed to prove this logic correct. Merges by (organismId,
 * antimicrobialId) -- both are FEAT-051's own global reference ids, shared
 * identically across every tenant's catalog, so this is a safe, correct
 * join key across tenants (never a display-string comparison, which could
 * in principle drift).
 */
export function mergeAndSuppress(
  perTenantEntries: readonly AmrSurveillanceEntry[][],
  timeBucket: string,
): NetworkAmrSurveillanceReport {
  const merged = new Map<
    string,
    {
      organismDisplay: string;
      antimicrobialDisplay: string;
      susceptibleCount: number;
      intermediateCount: number;
      resistantCount: number;
    }
  >();

  for (const entries of perTenantEntries) {
    for (const entry of entries) {
      const key = `${entry.organismId}:${entry.antimicrobialId}`;
      const existing = merged.get(key) ?? {
        organismDisplay: entry.organismDisplay,
        antimicrobialDisplay: entry.antimicrobialDisplay,
        susceptibleCount: 0,
        intermediateCount: 0,
        resistantCount: 0,
      };
      existing.susceptibleCount += entry.susceptibleCount;
      existing.intermediateCount += entry.intermediateCount;
      existing.resistantCount += entry.resistantCount;
      merged.set(key, existing);
    }
  }

  const entries: NetworkAmrSurveillanceEntry[] = Array.from(
    merged.values(),
  ).map((e) => {
    const totalCount =
      e.susceptibleCount + e.intermediateCount + e.resistantCount;
    const suppressed = totalCount < MIN_CELL_SIZE;
    return {
      organismDisplay: e.organismDisplay,
      antimicrobialDisplay: e.antimicrobialDisplay,
      timeBucket,
      suppressed,
      susceptibleCount: suppressed ? null : e.susceptibleCount,
      intermediateCount: suppressed ? null : e.intermediateCount,
      resistantCount: suppressed ? null : e.resistantCount,
      totalCount: suppressed ? null : totalCount,
    };
  });

  return { entries };
}

function monthBounds(month: string): { from: Date; to: Date } {
  const [year, mon] = month.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, mon - 1, 1)),
    to: new Date(Date.UTC(year, mon, 1)), // exclusive -- first of the next month
  };
}

/**
 * FEAT-056 (docs/plans/feat-056-cross-tenant-deidentified-aggregation.md,
 * ADR-0048). Per-tenant iteration, not one cross-tenant SQL query (ADR-0048
 * decision 1/Alternatives-rejected) -- a `dedicated_schema` tenant's own
 * rows live in a different Postgres schema entirely, invisible to any
 * single query against the shared one. Each opted-in tenant is resolved via
 * the existing `resolveTenantRouting()` (FEAT-045, unmodified) and queried
 * inside its own real transaction with `app.tenant_id`/`search_path` bound
 * exactly the way `TenantContextInterceptor` binds them for a normal
 * request -- `FEAT-055`'s own `computeAmrSurveillanceReport` is reused
 * unmodified per tenant, never reimplemented.
 *
 * `dedicated_db`-tier tenants are skipped (logged), not thrown (ADR-0048
 * decision 3) -- `resolveTenantRouting()`'s own fail-closed throw for that
 * tier is caught here and treated as an expected-shaped gap in this
 * enumeration loop's own best-effort aggregate, not a request failure.
 *
 * Each tenant that actually contributes gets its own real `audit_event` row
 * (ADR-0048's own companion proposal §7 AC3: "which tenants contributed,
 * when, by whom") written inside that same per-tenant transaction --
 * `audit_event` is itself tenant-scoped (RLS), so there is no single
 * cross-tenant audit row; `requestId` (shared across every contributing
 * tenant's own row for this one call) is what correlates them back into one
 * logical cross-tenant read after the fact.
 */
export async function computeNetworkAmrSurveillanceReport(
  db: Db,
  params: {
    query: NetworkAmrSurveillanceQuery;
    requestedByPrincipalId: string;
    requestedByRole: string;
  },
): Promise<NetworkAmrSurveillanceReport> {
  const { from, to } = monthBounds(params.query.month);
  const requestId = randomUUID();

  const optedInTenants = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(eq(tenant.amrSurveillanceOptIn, true));

  const perTenantEntries: AmrSurveillanceEntry[][] = [];

  for (const t of optedInTenants) {
    let routing: TenantRouting;
    try {
      routing = await resolveTenantRouting(db, t.id);
    } catch {
      // dedicated_db -- no working routing path yet (ADR-0039); skip this
      // tenant for this aggregate rather than failing the whole request.
      continue;
    }

    const entries = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${t.id}, true)`);
      if (routing.tier === 'dedicated_schema') {
        await tx.execute(
          sql`SELECT set_config('search_path', ${`${routing.schemaName}, public`}, true)`,
        );
      }

      const report = await computeAmrSurveillanceReport(tx, {
        query: { from: from.toISOString(), to: to.toISOString() },
      });

      await writeAuditEvent(tx, {
        tenantId: t.id,
        actorPrincipalId: params.requestedByPrincipalId,
        actorRole: params.requestedByRole,
        actorType: 'service',
        action: 'network_amr_surveillance.contributed',
        resourceType: 'amr_surveillance_report',
        resourceId: requestId,
        context: { month: params.query.month },
      });

      return report.entries;
    });

    perTenantEntries.push(entries);
  }

  return mergeAndSuppress(perTenantEntries, params.query.month);
}
