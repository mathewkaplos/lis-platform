import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

/**
 * FEAT-049: seeds a brand-new tenant's starter test catalog by re-running
 * the exact same seed SQL `db-reset.sh` already runs for the fixed
 * placeholder tenant (`db/seed/chemistry-catalog.sql`,
 * `db/seed/haematology-catalog.sql`, and -- issue #705 -- `db/seed/
 * anatomic-pathology-catalog.sql`), with that fixed tenant literal
 * text-substituted for the new tenant's real id.
 *
 * Deliberately NOT a hand-ported, parameterized re-implementation of those
 * files' ~300 lines of joins/ON CONFLICT handling: both files' global-table
 * inserts (`code_system_value`/`unit`/`analyte`, ADR-0004) already carry
 * `ON CONFLICT ... DO NOTHING` (confirmed by reading them), and every
 * tenant-scoped insert is keyed on `(tenant_id, ...)`, so re-running the
 * unmodified file text under a different tenant literal is exactly as
 * correct as the original, tested script -- and stays correct automatically
 * if those files are ever revised, instead of drifting from a hand-ported
 * copy. The fixed tenant UUID is confirmed (by search) to be the only
 * UUID-shaped literal in either file, so a plain string substitution is
 * exact, not a heuristic.
 *
 * Runs as `lis_app` (never the migrations role) inside one transaction with
 * `app.tenant_id` bound first -- narrower privilege than `db-reset.sh`'s own
 * bootstrap-time `postgres` role, and correct for this call site: this runs
 * live, mid-request, against a real already-running server, not a one-shot
 * bootstrap script with no tenant context to bind yet.
 */
const FIXED_SEED_TENANT = "00000000-0000-0000-0000-000000000001";
// Issue #705 (EPIC #697): anatomic-pathology-catalog.sql added -- a real,
// orderable/billable AP procedure menu, same starter-catalog standing as
// the other two files (a fresh self-signup tenant gets it too, not just
// the fixed dev/CI tenant).
const SEED_FILES = [
  "chemistry-catalog.sql",
  "haematology-catalog.sql",
  "anatomic-pathology-catalog.sql",
];

export async function seedStarterCatalog(pool: Pool, tenantId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    for (const file of SEED_FILES) {
      const sqlText = readFileSync(join(__dirname, "../../../db/seed", file), "utf-8");
      if (!sqlText.includes(`'${FIXED_SEED_TENANT}'`)) {
        throw new Error(
          `${file} no longer contains the expected fixed-tenant literal '${FIXED_SEED_TENANT}' -- tenant-catalog-seed.ts's substitution would silently no-op. Update this function if the seed file's tenant-literal convention changed.`,
        );
      }
      const parameterized = sqlText.replaceAll(`'${FIXED_SEED_TENANT}'`, `'${tenantId}'`);
      await client.query(parameterized);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
