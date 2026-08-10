# Implementation Proposal: Serialize `writeAuditEvent` per tenant to close a real audit-chain race
Status: APPROVED
ADR: adr-0036    Date: 2026-08-10    Backlog ID: issue #459 (lis-platform)

**Approved 2026-08-10** via the native options-prompt (accepted as drafted, including the local DB
reset). Both questions in §10 answered: proceed with implementation, and reset the local Postgres
container as part of this work.

## 1. Goal
Fix a genuine, previously-unknown TOCTOU race in `packages/db/src/audit.ts`'s `writeAuditEvent`:
two concurrent writers for the same tenant can both read the same "last row" before either
commits, corrupting the hash chain (Constitution Law #5). Root-caused live this session against
this repo's own local dev Postgres container — see ADR-0036's Context for the full trace
(`SlaBreachDetectorService` and `CriticalNotificationEscalationService`, two independent
`@Interval` background jobs, racing on tenant `00000000-0000-0000-0000-000000000001` at
`2026-08-10 14:20:50`, sequence 1176's `prev_hash` pointing at sequence 1171 instead of the true
immediate predecessor 1175).

Separately, this proposal also covers the local-environment cleanup issue #459 also surfaced:
`worklist.e2e-spec.ts`'s failures are **not a bug** — confirmed to be accumulated local Postgres
residue (380+ pre-existing `ordered_test` rows for tenant A crowding a freshly created fixture out
of `GET /v1/worklist`'s default `ORDER BY created_at ASC LIMIT 100` view). No code change addresses
this; a local container reset does.

## 2. Affected files
- `packages/db/src/audit.ts` — add the advisory-lock statement to `writeAuditEvent`, per ADR-0036.
- `packages/db/test/audit.spec.ts` (new, or added to an existing `packages/db` test file if one
  already covers `audit.ts`) — the two new concurrency tests ADR-0036's acceptance criteria
  require (same-tenant serialization, cross-tenant non-blocking).
- No schema migration, no API route, no frontend change.
- `~/work/lis-engineering/skills/engineering/testing/SKILL.md` — new entry documenting this as a
  second, *different* root cause under the same "intermittent-looking failure" heading entry #8
  already opened, so a future session doesn't waste time re-disproving entry #8's own theory
  against a genuinely different bug.
- `~/work/lis-engineering/adr/adr-0036-...md` — already drafted alongside this proposal
  (Status: proposed).

## 3. Architecture consulted
- KB-11 (Audit Logging) — record shape, hash-chain tamper-evidence design; does not itself specify
  concurrent-writer serialization, which is the gap this proposal closes.
- Constitution Law #5 (audit) and Law #4 (tenant isolation — the lock is tenant-scoped, never
  cross-tenant).
- ADR-0017 (critical-notification escalation job's own RLS/tenant-enumeration precedent) — same
  family of background-job caller, confirms `actorType: 'service'` and per-tenant transaction shape
  are already established conventions this fix does not change.
- `engineering/database-design` Skill entry #14 — confirms an advisory lock taken on the caller's
  own already-open transaction (not a new nested `db.transaction()`) cannot trigger the
  `DB_POOL_MAX=1` e2e deadlock that entry documents for a genuinely different pattern (a handler
  opening its *own* transaction while the caller's is still open). This proposal's lock is a plain
  statement inside the existing transaction, not a new transaction.

## 4. Skills loaded
- `engineering/testing` (entries #8, #13, #14 — the exact "trace the actual data" discipline this
  investigation followed, and the established "long-lived local Postgres container accumulates
  real residue" pattern that explains the worklist half).
- `engineering/database-design` (entry #14 — nested-transaction deadlock hazard, confirmed not
  applicable here).
- `engineering/rls-multi-tenancy` (confirms tenant-scoped locking doesn't interact with RLS policy
  evaluation — the lock is orthogonal to `SET LOCAL app.tenant_id`).

## 5. Assumptions & autonomous decisions
- **`hashtext(tenant_id)` collision risk is accepted, not engineered around.** A 32-bit hash of a
  UUID could in principle collide between two unrelated tenants, causing occasional unnecessary
  serialization (never a missed lock — a false positive, not a false negative). At this product's
  realistic tenant count this is judged an acceptable, explicitly-documented trade-off (ADR-0036)
  rather than justifying a more complex 64-bit split-key scheme.
- **The historical corruption in the shared local dev Postgres container is not retroactively
  repaired by this fix.** It only prevents new corruption going forward. The existing corrupted
  chain for tenant `…0001` needs a data reset (`scripts/db-reset.sh`) to unblock local e2e runs —
  proposed as a one-time environment action alongside this code change, not as part of the fix
  itself.
- **No retry/backoff logic is added.** The advisory-lock approach blocks the second writer until
  the first's transaction ends, rather than aborting either — no caller needs new error-handling
  for a lock-related failure mode, so none is added.

## 6. Risks
- Any future audited write that itself calls `writeAuditEvent` from inside a transaction that is
  *already* holding the advisory lock for that same tenant (e.g., a caller that somehow invoked
  `writeAuditEvent` twice within one transaction for the same tenant) would self-block only if a
  *different* connection tried to acquire the same key — `pg_advisory_xact_lock` is re-entrant
  within the same session/transaction, so this is not actually a hazard, but worth stating since it
  wasn't true of every locking primitive considered.
- Two-connection production `DB_POOL_MAX` (unlike the e2e `=1` config) means this fix changes real
  runtime behavior under load, not just test behavior: concurrent audited writes to the *same*
  tenant will now genuinely wait on each other rather than racing. This is the correct behavior per
  ADR-0036, but is a real latency-under-contention change worth calling out, not just a test fix.
- The two new concurrency tests (acceptance criteria in ADR-0036) need to genuinely start both
  `writeAuditEvent` calls before either resolves (not sequential `await`s) to prove the lock, not
  just assert the eventual chain is valid — a test that accidentally serializes at the JS level
  would pass without proving anything.

## 7. Acceptance criteria
See ADR-0036's own Acceptance criteria section — reused verbatim here as this proposal's AC, not
duplicated with different wording.

## 8. Testing plan
- Unit/integration: the two new concurrency tests against a real Postgres instance (per
  `engineering/testing` entry #1 — this is exactly the "real-Postgres integration check" class,
  though these specifically test `packages/db`'s own writer function directly rather than going
  through `apps/api`'s HTTP layer, so a `tsx`-script shape is not required here — a Vitest test
  calling `writeAuditEvent`/`verifyAuditChain` directly against a real `db` connection matches how
  `packages/db`'s other unit tests are already structured).
- Regression: rerun `capability-check.e2e-spec.ts` and `worklist.e2e-spec.ts` together after a
  local `scripts/db-reset.sh`, confirming both pass clean on a fresh chain/fixture set.
- Manual: no user-facing surface to manually verify (no API contract change, no UI).

## 9. Rollback plan
Revert the one-line addition to `writeAuditEvent`; no migration, no data shape change, so rollback
is a plain code revert with no data migration needed either direction.

## 10. Questions requiring human approval
1. **Approve ADR-0036 and this proposal (Status: DRAFT → APPROVED) to proceed with implementation?**
2. **Reset the local dev Postgres container (`scripts/db-reset.sh`) now, to clear the existing
   corrupted chain and worklist residue?** This discards all locally accumulated dev/test data in
   this container (638 accumulated `ordered_test` rows, the corrupted audit chain, everything
   else) — confirming explicitly before running it, since it's a destructive local action.
