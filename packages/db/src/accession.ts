import { sql } from "drizzle-orm";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>;
// Same DbOrTx convention as audit.ts: accepts either the top-level db handle
// or an open transaction, so a caller (TASK-047's future specimen-insert
// path) can generate the number and insert the specimen row as one unit.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

/**
 * TASK-045 (FEAT-013 proposal §10 Q1): diverges from
 * `engineering/api-design` Skill entry #9's retry-on-unique-violation
 * convention (used for patient MRN) deliberately -- `nextval()` is
 * lock-free and doesn't degrade under concurrent callers, where
 * retry-on-violation is fine for human-initiated, low-frequency writes but
 * not for the higher, less predictable write volume specimen accessioning
 * may see (KB-29 analyzer integration). Exactly `audit_event.sequence`'s
 * own already-shipped precedent (0010_audit_event.sql), reused directly.
 *
 * Global sequence, not per-tenant (per-tenant Postgres sequences aren't a
 * practical primitive for dynamically-created tenants) -- a global-unique
 * value trivially satisfies the per-tenant uniqueness
 * `ux_specimen_tenant_accession` actually requires. Does not reset
 * daily/yearly (FEAT-013 proposal §5): the date component below is a
 * cosmetic prefix for human legibility, not derived from or gating the
 * sequence itself.
 *
 * Format (FEAT-013 proposal §10 Q2): `YYMMDD-NNNNNN` -- UTC date generated
 * + the global sequence value zero-padded to 6 digits, e.g.
 * `260805-000123`.
 */
export async function generateAccessionNumber(db: DbOrTx): Promise<string> {
  const result = await db.execute<{ nextval: string }>(
    sql`SELECT nextval('accession_number_seq')`,
  );
  const sequenceValue = result.rows[0].nextval;

  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const datePrefix = `${yy}${mm}${dd}`;

  return `${datePrefix}-${sequenceValue.padStart(6, "0")}`;
}
