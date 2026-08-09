import { outboxEvent } from "./schema/outbox-event";
import type { createDb } from "./client";

type Db = ReturnType<typeof createDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export interface OutboxEventInput {
  tenantId: string;
  eventType: string;
  payload: unknown;
}

/**
 * FEAT-028 (ADR-0028): writes a pending outbox row. Mirrors writeAuditEvent's
 * own shape (packages/db/src/audit.ts) -- accepts the caller's own open
 * transaction so the event and its triggering domain change commit
 * atomically or not at all (KB-25's own stated requirement, this feature's
 * literal AC). No hash chain (unlike audit_event) -- this table has no
 * Constitution Law #5 tamper-evidence requirement, it's an internal
 * delivery mechanism, not an audit trail.
 */
export async function writeOutboxEvent(db: DbOrTx, input: OutboxEventInput) {
  const [row] = await db
    .insert(outboxEvent)
    .values({
      tenantId: input.tenantId,
      eventType: input.eventType,
      payload: input.payload,
    })
    .returning();
  return row;
}
