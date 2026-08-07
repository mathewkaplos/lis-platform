# Implementation Proposal: FEAT-021 Critical notification, read-back & escalation
Status: **APPROVED** — TASK-A scope only (TASK-065). TASK-066 (TASK-B) not yet started.
ADR: adr-0016 (accepted 2026-08-07 — see §10 Q1/Q2)    Date: 2026-08-07    Backlog ID: FEAT-021 (#30) / TASK-065 (#360) / TASK-066 (#361)

**Approved 2026-08-07** via the native options-prompt, recommended option chosen for all three §10
questions: ADR-0016 accepted as drafted (gate-widening deferred to TASK-B, Q1/Q2); `verify` reused
as the acknowledge capability, no new capability (Q3); TASK-065/TASK-066 created as real GitHub
issues now (Q4) — #360 and #361, both linked as sub-issues of FEAT-021 (#30).

## 1. Goal

M5's first feature (FEAT-018, QC materials & results as Observations) closed last session. Three
open M5 features carry Priority: Critical and have zero unmet dependencies today: FEAT-019
(Westgard engine, unblocked by FEAT-018), FEAT-021 (this proposal, unblocked since FEAT-015 closed
in M4), and FEAT-023 (Haematology CBC, unblocked since FEAT-014 closed in M4). FEAT-021 was chosen
over the other two because it closes a real, already-identified gap against **Constitution Law #3**,
rather than opening new domain breadth or continuing a multi-feature chain whose safety payoff
doesn't land until a later feature (FEAT-020) ships.

Law #3 reads as one sentence — "Critical values never auto-verify. They require human verification,
a documented notification with read-back, and block report finalization until acknowledged." — but
the backlog splits it across two milestones. FEAT-015 (M4, shipped) built detection + verification +
the finalization block (TASK-054/055/056/057). `domain/critical-values` Skill entry #5 records this
split explicitly and names FEAT-021 as the feature that must build the actual notification/read-back/
escalation machinery KB-34 describes — this proposal is that kickoff.

FEAT-021's own issue text names two ACs: "Critical detection triggers a notification with a
documented, audited read-back requirement" and "Unacknowledged criticals escalate on a timer to a
defined escalation contact." Its Tasks section is unstarted, same as every prior feature at kickoff.
**This proposal's own approvable scope is narrowed to the first task only** — the same narrowing
precedent every prior feature in this repo has used.

**Task decomposition (drafted this session, not yet created as GitHub issues — see §10 Q4):**
- **TASK-A — Critical notification record, read-back capture & query.** This proposal's scope.
  Delivers the `critical_notification` table ADR-0016 specifies, a creation hook inside `finalize()`,
  an audited acknowledge (read-back) action, and a query endpoint. Does **not** touch
  `FinalizationRollupInterceptor`'s existing gate.
- **TASK-B — Escalation timer & finalization-gate widening.** Depends on TASK-A. Adds a scheduled
  job (new dependency, `@nestjs/schedule` or equivalent — a real, human-approved decision at that
  point, not assumed here) that escalates unacknowledged notifications past a threshold, and widens
  `FinalizationRollupInterceptor`'s gate to also require `critical_notification.status =
  'acknowledged'`, closing the real gap ADR-0016 names explicitly (today, verification alone
  unblocks finalization — TASK-B is what makes Law #3's "documented notification with read-back"
  clause actually load-bearing on report release, not just recorded). Not this proposal's scope — to
  be specified once TASK-A is real, the same "TASK-064 specified once TASK-063 exists" precedent
  FEAT-018 used.

**Real, load-bearing finding from this proposal's own research, not present in FEAT-021's issue
text:** `finalize()` (`apps/api/src/observation/observation.controller.ts`) already computes and
returns `criticalDetected: row.flags.includes('HH') || row.flags.includes('LL')` (TASK-054) — so
critical *detection* is not this feature's gap, only the notification/read-back/escalation half is.
Separately, no scheduling library, queue client, or SMS/email/push provider dependency exists
anywhere in `apps/api`, and no clinician/on-call role exists in `apps/api/src/auth/capabilities.ts`
— KB-34's literal "notify responsible clinician... escalate to a defined escalation contact" both
presuppose channel/routing infra this repo does not have yet (`FEAT-038` Clinician portal is M8;
KB-34's own "Future considerations" already names on-call scheduling as unbuilt). This is exactly
the kind of schema/architecture-shape decision Rule #0 requires an ADR for — **ADR-0016** (drafted
alongside this proposal, Status: proposed) resolves it: a new, decoupled `critical_notification`
entity, not a change to `verify()`'s own shape, with the finalization-gate widening deliberately
sequenced to TASK-B rather than this proposal's own TASK-A.

## 2. Affected files

- `lis-engineering/adr/adr-0016-critical-notification-is-a-decoupled-entity-from-verification.md`
  (new, this session) — must be **accepted** before TASK-A's migration is written (§10 Q1).
- `packages/db/src/schema/critical-notification.ts` (new) — `critical_notification` table per
  ADR-0016: `id`, `tenantId`, `observationId` (FK → `observation.id`), `status` (text,
  CHECK-constrained `'pending' | 'acknowledged' | 'escalated'`), `createdAt`, `escalationLevel`
  (integer, default 0), `lastEscalatedAt` (nullable timestamptz), `acknowledgedAt`/
  `acknowledgedByUserId` (nullable), `readBack` (nullable text). Tenant-scoped, RLS via the standard
  local `tenantIsolation()` helper every tenant table in this schema repeats.
- `packages/db/src/index.ts` — export `critical_notification` schema.
- `db/migrations/00XX_critical_notification.sql` (new, hand-written per this repo's CHECK-constraint/
  RLS convention — `database-design` Skill's standing precedent) — creates `critical_notification`.
- `apps/api/src/observation/observation.controller.ts` (modify) — `finalize()`: after computing
  `criticalDetected`, if true and no existing `'pending'`/`'escalated'` row exists for this
  `observationId`, insert a `critical_notification` row in the same transaction and fold its id into
  the already-audited `observation.finalize` event's `after` payload
  (`criticalNotificationId: string | null`) — the same "fold into the existing event" precedent
  TASK-053/054 already established for this exact method. No new interceptor, no new audit call site
  for creation.
- `apps/api/src/critical-notification/critical-notification.controller.ts` (new) +
  `critical-notification.module.ts` (registered in `app.module.ts`) — `POST
  /v1/critical-notifications/:id/acknowledge` (`{ readBack: string }` required non-empty, gated by
  the existing `verify` capability, audited as `critical_notification.acknowledge`) and `GET
  /v1/critical-notifications` (optionally filtered by `status`, gated by `JwtAuthGuard` only — same
  read-route precedent as `observation.controller.ts`'s `list()`/`prior()`).
- `packages/domain/src/critical-notification.ts` (new) — `acknowledgeCriticalNotificationSchema`
  (`{ readBack: z.string().min(1) }`), `criticalNotificationSchema` (response shape).
- `apps/api/test/critical-notification.e2e-spec.ts` (new) — real-Postgres RLS isolation test, a
  `finalize()`-triggered creation test (including the no-duplicate-while-pending case), acknowledge
  (success + empty-`readBack` 400 + already-acknowledged 409 + cross-tenant 404), and the query
  endpoint's status filter.
- No change to `apps/api/src/observation/finalization-rollup.interceptor.ts` this task — ADR-0016
  §Decision, TASK-B's own scope.

## 3. Architecture consulted

- KB-34 Notification System — primary; the critical-value workflow diagram and its Design decisions
  table (notify → await read-back → escalate → block finalization).
- ADR-0016 (this session) — the concrete schema/sequencing mechanism.
- `domain/critical-values` Skill — entries #4 (no event bus/queue invented ahead of FEAT-028), #5
  (the FEAT-015/FEAT-021 split, and why FEAT-021 owns this half), #6/#7 (TASK-056's real shipped
  finalization-gate shape — the exact code this proposal deliberately does not touch in TASK-A).
- ADR-0015 — precedent for a similarly-shaped kickoff proposal (schema-first, ADR alongside it,
  narrowed to one task, capability-reuse reasoning).
- ADR-0011 — precedent for capability-grant reasoning (`resolveGrantingRole`'s deterministic,
  fail-closed lookup), consulted to confirm reusing `verify` needs no change there.

## 4. Skills loaded

- `domain/critical-values` — primary; entries #4-#7 all directly inform this proposal's scope and
  its explicit non-goals.
- `engineering/api-design` — action sub-resource convention (`/critical-notifications/:id/acknowledge`,
  matching `/results/:analyteId/verify`'s own slash-verb shape); `AuditInterceptor`'s
  `{ resourceId, before?, after? }` return-shape contract (entry #15) — the exact bug FEAT-018's
  TASK-064 hit and fixed; this proposal's acknowledge action returns that shape from the start.
- `engineering/database-design` — hand-written-migration/CHECK-constraint precedent for the new
  `status` column (bounded text CHECK, not a native enum, per ADR-0006's scoping).
- `engineering/rls-multi-tenancy` — new tenant-scoped table pattern.
- `engineering/testing` — real-Postgres RLS negative-test precedent.

## 5. Assumptions & autonomous decisions

- **Acknowledge reuses the existing `verify` capability, no new capability.** Per ADR-0016 — same
  real-world actor (a verifier is already trusted to clinically confirm a critical result); no
  clinician portal or on-call role exists yet to justify a dedicated capability. Matches ADR-0015's
  identical reasoning for QC result entry.
- **Creation is a plain synchronous insert inside `finalize()`'s existing transaction, not a new
  event/interceptor.** Per `domain/critical-values` Skill entry #4 — no event bus exists (FEAT-028
  unbuilt); this is the same "documented, audited signal" pattern the Skill itself prescribes as the
  correct alternative.
- **`critical_notification.status` is bounded text with a CHECK, not a native Postgres enum.**
  Matches `audit_event.actor_type`'s own precedent (ADR-0006 scopes this schema's one enum decision
  to `observation.data_type` only).
- **No duplicate `'pending'` notification per observation.** `finalize()`'s creation check queries
  for an existing `'pending'`/`'escalated'` row for the same `observationId` before inserting — a
  re-finalize of an already-critical, not-yet-acknowledged analyte (e.g., a corrected value that's
  still HH/LL) must not spawn a second, parallel notification the acknowledge flow would then have
  to disambiguate between.
- **The finalization-block gate (`FinalizationRollupInterceptor`) is deliberately NOT widened in
  this task.** Per ADR-0016's own Decision/Consequences — this is TASK-B's scope, sequenced after
  `critical_notification` exists as a real, tested table. Flagged explicitly as a real, temporary gap
  (§10 Q1), not silently accepted.
- **No escalation timer, no SMS/email/push channel, no on-call routing in this task.** KB-34 itself
  lists channel/provider selection and on-call scheduling as open/future items; TASK-B's own scope,
  gated on its own new-dependency decision (`@nestjs/schedule`).

## 6. Risks

- **ADR-0016 is not yet accepted.** This is the single blocking dependency for TASK-A entirely —
  raised explicitly as §10 Q1, not assumed approved by proceeding to write this proposal alongside
  it.
- **This task ships only half of Law #3's notification clause's real value.** A critical result can
  be `verified` (unblocking finalization today, per TASK-056's already-shipped gate) while its
  `critical_notification` remains `'pending'` — until TASK-B widens the gate. This is the same real
  risk ADR-0016's Consequences section names; it is the single most important thing to weigh in §10
  Q1 before approving this sequencing.
- **No real "responsible clinician" audience exists to notify.** The only roles that exist today
  (`technologist`, `verifier`) are lab-internal, not the external clinician KB-34's example describes.
  This task's "notification" is therefore an in-app, `verify`-capability-gated query endpoint, not an
  actual push/SMS/email alert to anyone external — a real, deliberate narrowing worth stating
  plainly rather than letting the AC's language ("notification") imply more than what's built.
- **`@nestjs/schedule` is a new dependency, deferred to TASK-B, not evaluated by this proposal.**
  Flagged here so it isn't a silent addition when TASK-B is specified.

## 7. Acceptance criteria

Narrowed to TASK-A's own scope (TASK-B will carry FEAT-021's full literal AC, including escalation):
- [ ] `critical_notification` exists, tenant-scoped, RLS-enforced (negative test: wrong-tenant
  session sees 0 rows via `lis_app`), with a real FK to `observation`.
- [ ] `finalize()` creates exactly one `'pending'` `critical_notification` row the first time an
  analyte is HH/LL-flagged, and creates no duplicate on a subsequent re-finalize while one is already
  `'pending'`/`'escalated'` for the same observation.
- [ ] `finalize()`'s existing audited event's `after` payload includes `criticalNotificationId`
  (null when no critical was detected) — no new, separate audit call site for creation.
- [ ] `POST /v1/critical-notifications/:id/acknowledge` requires a non-empty `readBack`; rejects an
  already-`'acknowledged'` notification (409); is gated by the `verify` capability; is audited
  (`{ resourceId, before, after }` shape, per `api-design` entry #15).
- [ ] `GET /v1/critical-notifications` (optionally `?status=pending`) is queryable independently of
  `observation.verify()`'s own state.
- [ ] Every existing patient-flow write path (`draft()`, `finalize()`, `verify()`) is unaffected —
  the full existing `apps/api` e2e suite passes unchanged; `FinalizationRollupInterceptor`'s existing
  gate and its own tests are untouched.
- [ ] Migration runs up **and** down cleanly on seeded data.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `critical-notification.ts` module.
2. `apps/api/test/critical-notification.e2e-spec.ts`, real Postgres, connected as `lis_app`:
   - RLS isolation: a `critical_notification` row created under tenant A is invisible to tenant B.
   - `finalize()` on an HH/LL-flagged analyte creates exactly one `'pending'` row; a second
     `finalize()` of the same still-critical analyte does not create a second row.
   - Acknowledge: valid `readBack` succeeds and is audited against a real persisted `audit_event`
     row; empty `readBack` is rejected 400; acknowledging an already-`'acknowledged'` row is
     rejected 409; a cross-tenant notification id is rejected 404 (per `api-design` entry #7).
   - Query: `GET /v1/critical-notifications?status=pending` returns only pending rows; an
     acknowledged row drops out of that filter.
3. The full existing `apps/api` e2e suite re-run and confirmed still green — proves zero regression
   to `finalize()`'s existing behavior and to `FinalizationRollupInterceptor`'s existing gate.
4. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root, including a real `next build`/`nest
   build`.
5. Migration down/up cycle run locally against seeded data, confirmed clean.

## 9. Rollback plan

Purely additive: `critical_notification` is a new table with no existing readers, and `finalize()`'s
own modification (the creation hook + one new field on an existing audit event's `after` payload) is
non-breaking for any existing consumer (the field is additive, not a rename). Reverting is dropping
the table and reverting the PR; no data-preservation concern, no production data exists at this
milestone.

## 10. Questions requiring human approval

1. **Is ADR-0016 (critical notification as a decoupled entity, finalization-gate widening deferred
   to TASK-B) approved as written?** This blocks TASK-A entirely. The load-bearing part to weigh:
   this task's own scope leaves a real, temporary gap where a verified critical can finalize a
   report without its read-back ever being captured — TASK-B is what closes that gap.
   **Recommended: accept as drafted, with the TASK-A/TASK-B sequencing.** Rationale: ships a real,
   independently-testable slice now rather than rushing a change into `FinalizationRollupInterceptor`
   (already working, already tested) blind to a table that doesn't exist yet — matches every prior
   feature's own "service first, consumer/integration later" precedent.
2. **Alternative to Q1: should the finalization-gate widening move into this same first task
   instead of TASK-B**, accepting a larger, slower-to-review slice in exchange for closing Law #3's
   gap in one PR rather than two? Not recommended by this proposal (see Q1), but a legitimate
   alternative given Law #3's patient-safety weight — flagged as its own explicit choice, not
   folded silently into Q1's framing.
3. **Is `verify` the right capability for acknowledging a critical's read-back, or should FEAT-021
   introduce a dedicated capability now, ahead of any stated clinician/on-call role?** Recommended:
   reuse `verify` (§5) — no real requirement for a separate capability exists anywhere in KB-34 or
   the FEAT-021 issue body today.
4. **Should TASK-A/TASK-B be created as real GitHub issues now**, or wait until this proposal itself
   is approved? Recommended: create them now, alongside proposal approval — matches how every prior
   feature's kickoff session in this repo has sequenced it. Note: this session's GraphQL rate-limit
   bucket is currently exhausted (`gh api rate_limit` showed `0/5000`, resets ~18:14 UTC) — issue
   creation will need the REST fallback (`gh api repos/.../issues -X POST`) per the breadcrumb's
   already-documented workaround, not `gh issue create` directly.
