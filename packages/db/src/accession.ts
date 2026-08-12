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

/**
 * FEAT-057 (ADR-0049, proposal §5): a Case is the real accessioning event for
 * anatomic pathology -- its own accessionNumber comes from
 * generateAccessionNumber() above, unchanged. Specimen/part rows under a case
 * do NOT call generateAccessionNumber() a second time; their (still NOT NULL,
 * still per-tenant-unique) accessionNumber is this derived suffix instead --
 * satisfies specimen's existing constraint without consuming a second global
 * sequence value per part. `partNumber` is 1-indexed, assigned in-memory from
 * the create-case request's own part array (all parts for a case are created
 * together in one transaction, so no count query is needed here).
 */
export function deriveCaseSpecimenAccessionNumber(caseAccessionNumber: string, partNumber: number): string {
  return `${caseAccessionNumber}-P${partNumber}`;
}

/**
 * KB-24: hierarchical codes encode case -> block -> slide (not
 * case -> part -> block -> slide) -- read as intentional, since 2D Data
 * Matrix surfaces (slides) are explicitly space-constrained. `blockNumber` is
 * case-scoped (not part-scoped, proposal §5), 1-indexed, computed as a
 * max-plus-one count of existing blocks under the case at insert time.
 */
export function deriveBlockCode(caseAccessionNumber: string, blockNumber: number): string {
  return `${caseAccessionNumber}-B${blockNumber}`;
}

/** `slideNumber` is block-scoped, 1-indexed, same max-plus-one convention as deriveBlockCode. */
export function deriveSlideCode(blockCode: string, slideNumber: number): string {
  return `${blockCode}-S${slideNumber}`;
}
