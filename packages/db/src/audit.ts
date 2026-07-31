import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { createDb } from "./client";
import { auditEvent } from "./schema/audit";

type Db = ReturnType<typeof createDb>;
// The transaction-scoped query builder db.transaction(async (tx) => ...)
// hands its callback — same select/insert builder API as Db itself, so it
// is accepted here too. Required so a caller can pass its own open
// transaction (Constitution Law #5: "written in the same transaction as
// the change") instead of always opening a second, unrelated one.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export interface AuditEventInput {
  tenantId: string;
  actorPrincipalId: string;
  actorRole: string;
  actorType: "human" | "service" | "ai";
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  context?: unknown;
}

interface CanonicalEnvelope {
  tenantId: string;
  occurredAt: string;
  actorPrincipalId: string;
  actorRole: string;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  context: unknown;
}

// Recursively sorts object keys before stringifying. Required because
// Postgres jsonb does not preserve original key insertion order (it's a
// decomposed binary format) — without this, re-hashing a row after it's
// been written and read back from jsonb columns (before/after/context)
// could produce a different string, and therefore a different hash, than
// the one computed at write time, with zero actual tampering. Sorting keys
// on both the write path and the verify path guarantees both sides always
// serialize identically for the same logical content.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
  return `{${entries.join(",")}}`;
}

function canonicalize(envelope: CanonicalEnvelope): string {
  return stableStringify(envelope);
}

function computeHash(canonical: string, prevHash: Buffer | null): Buffer {
  return createHash("sha256")
    .update(canonical)
    .update(prevHash ?? Buffer.alloc(0))
    .digest();
}

/**
 * Writes one audit_event row per KB-11: hash = sha256(canonical(record) ||
 * prev_hash), chained to the immediately preceding event *for this tenant*
 * (KB-11: "forming a chain per tenant"). `reason` is required by KB-11 for
 * amendments/break-glass actions but is not a blanket NOT NULL at the
 * schema level (many actions legitimately have none) — callers making an
 * amendment/break-glass call are responsible for passing one; this function
 * doesn't yet enforce that per-action-type rule (no caller exists yet at
 * this milestone to enforce it against — see FEAT-006 proposal §2).
 *
 * Known limitation, not fully closed: jsonb also normalizes some numeric
 * literal formatting on storage (e.g. exponent notation), which could in
 * principle cause a recomputed hash to disagree with the stored one for
 * unusual numeric values in before/after/context even without tampering.
 * Not hit by any value shape this function or its tests currently produce;
 * flagged here rather than silently assumed away.
 */
export async function writeAuditEvent(db: DbOrTx, input: AuditEventInput) {
  const [prev] = await db
    .select({ hash: auditEvent.hash })
    .from(auditEvent)
    .where(eq(auditEvent.tenantId, input.tenantId))
    .orderBy(desc(auditEvent.sequence))
    .limit(1);

  const prevHash = prev?.hash ?? null;
  const occurredAt = new Date();
  const canonical = canonicalize({
    tenantId: input.tenantId,
    occurredAt: occurredAt.toISOString(),
    actorPrincipalId: input.actorPrincipalId,
    actorRole: input.actorRole,
    actorType: input.actorType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    context: input.context ?? null,
  });
  const hash = computeHash(canonical, prevHash);

  const [row] = await db
    .insert(auditEvent)
    .values({
      tenantId: input.tenantId,
      occurredAt,
      actorPrincipalId: input.actorPrincipalId,
      actorRole: input.actorRole,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
      context: input.context ?? null,
      prevHash,
      hash,
    })
    .returning();

  return row;
}

/**
 * Re-derives every event's hash from its own stored content and confirms it
 * matches the stored hash, and that prev_hash correctly points to the
 * preceding event's stored hash. Any historical tampering — a changed
 * before/after/reason/actor/etc., or a deleted-and-reinserted row — breaks
 * this chain and is detected, per KB-11's "altering or deleting any
 * historical event breaks the chain and is detectable" (TASK-025's literal
 * AC: "tampering with an audit row is detected by chain verification").
 */
export async function verifyAuditChain(db: DbOrTx, tenantId: string): Promise<{ valid: boolean; brokenAtId?: string }> {
  const rows = await db.select().from(auditEvent).where(eq(auditEvent.tenantId, tenantId)).orderBy(auditEvent.sequence);

  let expectedPrevHash: Buffer | null = null;
  for (const row of rows) {
    const canonical = canonicalize({
      tenantId: row.tenantId,
      occurredAt: row.occurredAt.toISOString(),
      actorPrincipalId: row.actorPrincipalId,
      actorRole: row.actorRole,
      actorType: row.actorType,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      before: row.before,
      after: row.after,
      reason: row.reason,
      context: row.context,
    });
    const recomputed = computeHash(canonical, row.prevHash);

    const prevMatches =
      (row.prevHash === null && expectedPrevHash === null) ||
      (row.prevHash !== null && expectedPrevHash !== null && Buffer.compare(row.prevHash, expectedPrevHash) === 0);
    const hashMatches = Buffer.compare(recomputed, row.hash) === 0;

    if (!prevMatches || !hashMatches) {
      return { valid: false, brokenAtId: row.id };
    }
    expectedPrevHash = row.hash;
  }
  return { valid: true };
}
