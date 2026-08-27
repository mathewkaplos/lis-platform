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
 *
 * Pilot-readiness audit follow-up (docs/pilot/PILOT-USER-GUIDE.md §0):
 * `sla-targets.sql` and `default-report-templates.sql` added -- both are
 * genuinely tenant-scoped tables (`sla_target`/`report_template`, both RLS-
 * enabled, confirmed by schema inspection), and a fresh self-signup tenant
 * had neither before this: the worklist's own TAT/SLA-status computation
 * had nothing to compare against, and a signed-out case had no template to
 * render a PDF report from. **Deliberately NOT added**: the seven
 * `db/seed/synoptic-protocol-*.sql`/`concept-block-*.sql`/`synoptic-
 * response-option-terminology.sql` files, and `microbiology-catalog.sql`/
 * `culture-report-template.sql` -- `synoptic_protocol` and its supporting
 * tables (confirmed by schema inspection: no `tenant_id` column, no RLS
 * policy) are genuinely GLOBAL reference data, not tenant-scoped, so they
 * need seeding exactly once per database, not once per tenant; re-running
 * them here on every signup would be redundant at best (their own
 * `WHERE NOT EXISTS`/`ON CONFLICT` guards make it harmless, just pointless
 * work on every single signup) and is out of this fix's actual scope, which
 * was "what's missing for THIS tenant," not "reseed global data." A genuine
 * fresh deployment (not this dev box, where `db-reset.sh` already seeded
 * these once) still needs a separate one-time global seed step for them --
 * a real, distinct gap from the one this function closes, worth its own
 * follow-up if a real multi-tenant production deployment is ever planned.
 * Microbiology's mixed global/tenant-scoped content was left out rather
 * than risk a partially-correct substitution without individually auditing
 * every INSERT in that file first.
 */
const FIXED_SEED_TENANT = "00000000-0000-0000-0000-000000000001";
interface SeedFile {
  file: string;
  // Whether this file's tenant-scoped INSERTs use the fixed literal above
  // and need it substituted for the new tenant's real id. `false` for a
  // file whose tenant scoping instead comes from the RLS `app.tenant_id`
  // already bound above (e.g. a query that derives `tenant_id` from an
  // already tenant-scoped table via `SELECT DISTINCT ... FROM <table>`,
  // rather than a literal `INSERT ... VALUES ('<fixed-uuid>', ...)`) --
  // substituting a literal that was never there would be a silent no-op,
  // not a safety net, so this is tracked explicitly per file rather than
  // inferred.
  substituteTenant: boolean;
}
// Issue #705 (EPIC #697): anatomic-pathology-catalog.sql added -- a real,
// orderable/billable AP procedure menu, same starter-catalog standing as
// the other two files (a fresh self-signup tenant gets it too, not just
// the fixed dev/CI tenant).
const SEED_FILES: SeedFile[] = [
  { file: "chemistry-catalog.sql", substituteTenant: true },
  { file: "haematology-catalog.sql", substituteTenant: true },
  { file: "anatomic-pathology-catalog.sql", substituteTenant: true },
  { file: "sla-targets.sql", substituteTenant: true },
  // Must run after the three discipline catalogs above -- it seeds one
  // report_template per test_definition already visible under this
  // request's own `app.tenant_id` (RLS-scoped, not a literal-tenant
  // INSERT), so re-running this file's unmodified text is exact for
  // whichever tenant's context it runs under, no substitution needed.
  { file: "default-report-templates.sql", substituteTenant: false },
];

export async function seedStarterCatalog(pool: Pool, tenantId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    for (const { file, substituteTenant } of SEED_FILES) {
      const sqlText = readFileSync(join(__dirname, "../../../db/seed", file), "utf-8");
      if (!substituteTenant) {
        await client.query(sqlText);
        continue;
      }
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
