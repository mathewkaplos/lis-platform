# Implementation Proposal: FEAT-015 Verification & criticals
Status: **IMPLEMENTED** — merged PR #320 (`f311a2e`), closing #113 (TASK-054); merged PR #322
(`9fb5f42`), closing #114 (TASK-055, verification action + append-only versioning). TASK-056
(finalization block) is FEAT-015's next task, not yet specified.
§10's open questions were resolved by the human as follows:
Q1: **Option B** (persist a documented critical-detection audit signal). Q2: the signal is a new
field on the existing `observation.finalize` audit event's `after` payload, not a second
`writeAuditEvent()` call site — matches TASK-053's own "fold into the same event" precedent. Q3:
**no ADR** — this extends an already-approved audit mechanism (FEAT-009) with one new field, not
new infrastructure; recorded as a same-proposal assumption instead, same precedent as TASK-049/050's
own resolved open questions. Q4: the new unit-mismatch-for-critical test cases are synthetic
fixtures (matching TASK-049's own age/method precedent) — the golden dataset's four real critical
analytes are not fabricated a fifth, incompatible-unit threshold that doesn't exist in real seed
data.
ADR: none — see Q3 above.
Date: 2026-08-06    Backlog ID: FEAT-015 (#24) / TASK-054 (#113)

## 1. Goal

FEAT-014 (Result entry engine, #23) is fully merged — all five tasks (TASK-049 through TASK-053)
closed, `docs/plans/feat-014-result-entry-engine.md` archived with real merge SHAs. FEAT-015
(Verification & criticals, #24, M4, EPIC-004) is next, its stated dependency (FEAT-014) satisfied.
FEAT-015 names four tasks (TASK-054 detection, TASK-055 verification action + versioning, TASK-056
finalization block, TASK-057 verification UI). **This proposal's approvable scope is TASK-054
only** — the same scope-narrowing precedent every prior feature in this repo has used (FEAT-011's
four revisions, FEAT-012's three, FEAT-013's four, FEAT-014's five). TASK-055–057 will be specified
as revisions to this same file once TASK-054's real output exists.

TASK-054's own issue text (#113): "Critical detection + CriticalValueDetected event." Its one
dependency, TASK-050 (flagging service), is merged. Its one AC: "Golden dataset passes for HH/LL
detection including boundary and unit-conversion cases." Its "Expected output": "Critical detection
in the result pipeline."

**Real, load-bearing finding #1 — critical detection, in the narrowest literal sense, already
exists and is already merged.** `packages/db/src/flagging.ts`'s `computeFlags` (TASK-050, merged PR
#311) already returns `HH`/`LL` as part of its one-element severity array, and
`apps/api/src/observation/observation.controller.ts`'s `draft()`/`finalize()` (TASK-051, merged PR
#313) already call it on every write and persist the result into `observation.flags` (a
GIN-indexed `text[]` column, `ix_obs_flags`) — live, on both draft and finalize, for every
`quantity`-type result. A caller today can already find every critical observation with
`WHERE flags && ARRAY['HH','LL']`. TASK-050's own already-merged e2e suite
(`apps/api/test/flagging.e2e-spec.ts`) already proves HH/LL boundary correctness for all four
golden-dataset critical analytes (Glucose 40/500, Sodium 120/160, Potassium 2.5/6.5, Calcium
6.0/13.0), exactly at, and one unit either side of, each real threshold. **The "boundary" half of
TASK-054's own AC is therefore already satisfied by already-merged, already-tested code, before
this task starts.**

**Real, load-bearing finding #2 — "unit-conversion cases" is the one genuinely new AC ingredient,
and it does not mean what it might sound like.** `domain/reference-ranges` Skill entry #5 (from
TASK-049) is explicit: no UCUM unit-conversion engine exists anywhere in this repo, and every
seeded chemistry analyte has exactly one unit — `resolveReferenceRange`'s `compatible()` check
excludes any candidate `reference_range` row whose `unitId` doesn't exactly equal the Observation's
own `unitId`, for *either* `rangeType`. This exclusion is already implemented and already
unit-tested — but only for `rangeType = 'normal'`
(`apps/api/test/reference-range-resolution.e2e-spec.ts:453`, "a unitId mismatch excludes the
candidate row -> no_range"). **No existing test proves the same exclusion for a `critical` row**,
i.e. that a value which would be `HH`/`LL` under one unit is never fabricated as critical when the
candidate critical row is for a different, incompatible unit. This is the concrete, honestly
buildable reading of "unit-conversion cases" available today: proving critical detection never
silently crosses a unit boundary — not building real cross-unit numeric conversion (e.g. mg/dL ↔
mmol/L), which no ADR, KB entry, or prior task has ever scoped or approved building. Framed this
way, matching TASK-049's own §10 Q2 precedent (state the literal-AC-vs-buildable-reality gap
plainly, narrow the AC, don't fabricate scope to paper over it).

**Real, load-bearing finding #3 — no schema change is needed under any plausible reading of this
task, following the exact "table exists, unused" pattern TASK-049/050/053 already established.**
`observation.flags` already carries the detection signal (finding #1); `audit_event` (FEAT-009,
already RLS'd, hash-chained) already exists as the append-only record store if a documented
signal beyond the flags array turns out to be wanted (§10 Q1). Neither reading requires a new
table, column, or migration.

**Real, load-bearing finding #4 — the notification/read-back/escalation half of Constitution Law
#3 is explicitly a *later*, separate, already-backlogged feature, not this task's job.**
`github/issues/features/FEAT-021-critical-notification-read-back-escalation.md` exists already:
"Critical notification, read-back & escalation," M5, depends on FEAT-015, Required Skill
`domain/critical-values` (the same Skill this proposal also drafts), AC "Critical detection
triggers a notification with a documented, audited read-back requirement" / "Unacknowledged
criticals escalate on a timer." FEAT-015 itself names no notification/escalation task — TASK-055 is
verification + versioning, TASK-056 is the finalization block, TASK-057 is the verification UI.
This means TASK-054's "CriticalValueDetected event" language most plausibly names a *trigger point*
that FEAT-021 will eventually subscribe to — not a request to build actual delivery, escalation, or
read-back capture now, none of which any task in FEAT-015 scopes. This materially narrows finding
#2's ambiguity but does not resolve it (see §10 Q1): a future FEAT-021 consumer still needs
*something* concrete to key off, and there is more than one honest candidate for what that
something is.

**Real, load-bearing finding #5 — no event bus exists to emit a real domain event onto.**
FEAT-028 ("Transactional outbox + event bus") is an unbuilt, future M6 feature. KB-34's own
"Architecture: Event-driven... subscribes to domain events — `CriticalValueDetected`,
`ReportFinalized`, `SpecimenRejected`..." describes the target-state design this repo has not yet
built any part of. Inventing an ad hoc event-bus mechanism now, ahead of FEAT-028's own scoping,
would be exactly the kind of un-approved architectural surface Rule #0 says to stop and ask about
rather than build. This proposal does not propose one.

## 2. Affected files

Per §10's resolution (Option B, folded into the existing finalize event), no file below requires a
migration.

- `apps/api/test/flagging.e2e-spec.ts` (extend, not new) — the new unit-mismatch-for-critical-rows
  case (finding #2): a synthetic critical-rangeType row on an incompatible unit must not produce
  `HH`/`LL` for a value that would be critical under the matching unit.
- `apps/api/test/reference-range-resolution.e2e-spec.ts` (extend, not new) — a `resolveObservationRange`-level
  companion to the above, confirming `critical.matched === false` on a unit mismatch, mirroring the
  existing `normal`-only assertion at line 453 exactly, for the `critical` rangeType.
- `domain/critical-values` Skill (new, this proposal) and `domain/result-verification` Skill (new,
  this proposal) — drafted alongside this proposal per FEAT-015's own "Required Skills" list (#24),
  loaded by whoever implements TASK-054 once this proposal is approved.
- `apps/api/src/observation/observation.controller.ts` — `finalize()`'s existing audited event
  gains a new field on its `after` payload (e.g. `criticalDetected: boolean`, or the observation's
  own `flags` echoed onto the audit payload — exact key decided during implementation, not
  prescribed here) whenever the just-written observation's `flags` includes `HH` or `LL`. No second
  `writeAuditEvent()` call site — folds into the same already-audited transaction, matching
  TASK-053's own precedent.
- `apps/api/test/observation.e2e-spec.ts` (extend) — a real finalize of a golden-dataset critical
  value (e.g. Sodium at 115, below its 120 critical-low threshold) produces the new field on the
  existing audit event, proven the same "exact before/after `tenant-audit-count` delta" way
  TASK-051's own audit tests already prove `observation.finalize`'s audit behavior — the delta stays
  the same (still exactly one audit row per finalize), only its payload shape gains the new field.
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` — regenerate only if the audit event's
  payload shape is itself part of a public Zod schema; if it's internal to `writeAuditEvent`'s own
  untyped `after` JSON, no regeneration is needed. Confirm which during implementation.

**Not affected under either reading:**
- `packages/db/src/flagging.ts` / `packages/db/src/reference-range.ts` — both already correctly
  implement the detection logic this task's AC asks to prove (findings #1–#2); this proposal finds
  no bug in either to fix.
- `packages/db/src/schema/*` — no new table or column (finding #3).
- Anything under `apps/web` — FEAT-015's own "Google Stitch prompts required" section says
  explicitly "not applicable... no new UI" for the feature as a whole; TASK-054 in particular has
  no UI component (detection is a pipeline concern, TASK-057 is the UI task).

## 3. Architecture consulted

- KB-14 Result Engine — step 3 of its five-step validation pipeline ("Critical-value detection —
  values beyond critical thresholds set HH/LL and trigger a mandatory notification/acknowledgement
  workflow... block finalization until satisfied") — confirms detection and the
  notification/acknowledgement/block machinery are named as adjacent but distinct concerns, matching
  finding #4's reading that TASK-054 owns only the first.
- KB-34 Notification System — "Critical detection itself happens in the result engine ([14]); this
  system handles delivery, escalation, and acknowledgement" (its own explicit scope line) and its
  "Architecture: Event-driven... subscribes to domain events — `CriticalValueDetected`..." section —
  the direct source of the "event" name in TASK-054's own title, and of finding #5's "no event bus
  exists yet to emit this onto" gap.
- Constitution Law #3 ("Critical values never auto-verify... require human verification, a
  documented notification with read-back, and block report finalization until acknowledged") and
  Law #5 ("every clinically significant action is audited") — both directly inform §10 Q1's two
  candidate readings (a bare flags-column read vs. a documented audit-event signal).
- `domain/reference-ranges` Skill, entries #3, #5, #9, #10 — the existing critical-row modeling
  (separate rows, unit-exact-match exclusion, the low/high inversion) this task's tests must respect
  and extend, not re-derive.
- `docs/plans/feat-014-result-entry-engine.md`'s TASK-050 revision — direct precedent for
  golden-dataset boundary-case testing of `computeFlags`, and TASK-053's revision — direct
  precedent for folding a derived write into an existing audited call rather than inventing a new
  `writeAuditEvent()` call site.

## 4. Skills loaded

- `domain/reference-ranges` (existing) — entries #3 (criticals as separate rows), #5 (no UCUM
  conversion engine, exact-`unitId` equality), #9/#10 (one-sided critical row merge, the
  low/high inversion) — all directly load-bearing for the new unit-mismatch-on-critical-rows test.
- `domain/critical-values` (new, drafted this session as part of this proposal) — the primary Skill
  for TASK-054 and every later FEAT-015/FEAT-021 task touching criticals.
- `domain/result-verification` (new, drafted this session) — loaded for context on where TASK-054's
  detection output feeds into TASK-055's verification action, even though this proposal's own scope
  doesn't implement verification.
- `domain/clinical-chemistry` — confirms only 4 of 14 seeded chemistry analytes have any critical
  row at all (same limitation already documented for TASK-050); this task's golden-dataset coverage
  is bounded by that same real data limit, not a new gap.
- `engineering/testing` — golden-dataset/real-Postgres e2e precedent this task's own tests follow.

## 5. Assumptions & autonomous decisions

- **The literal AC's "boundary" half is treated as already satisfied by TASK-050's own merged test
  suite, not re-proven from scratch.** Re-running `pnpm --filter api test:e2e` to reconfirm it's
  still green is part of §8's testing plan, but no new boundary-case test is proposed — writing one
  would duplicate already-passing, already-reviewed coverage for no new signal.
- **"Unit-conversion cases" is read as "critical detection must never fabricate a match across an
  incompatible unit," not as "build real UCUM numeric conversion."** Finding #2 states the honest
  reasoning; no ADR or KB entry authorizes building a conversion engine, and no seeded data would
  let one be tested against anything but synthetic fixtures even if built.
- **No new capability or authorization check is proposed.** Detection is a pure computation over an
  already-authorized write path (`enter_result`, already required by `draft`/`finalize`); nothing in
  this task's scope introduces a new HTTP surface or a new class of actor.
- **Whether to persist a new audit signal at all (§10 Q1) is explicitly left undecided in this
  document**, per this task's own framing as proposal-drafting, not implementation — no default or
  "recommended" option is chosen here.

## 6. Risks

- **The central risk is scope ambiguity itself, not a technical one.** TASK-054's title
  ("...+ CriticalValueDetected event") reads, on a shallow pass, as calling for real event-emission
  infrastructure this repo doesn't have (finding #5) and no other task in this milestone needs
  (finding #4). Implementing the heavyweight reading would be real, unapproved, speculative
  architecture; implementing only the narrowest reading (re-affirm existing flags) risks leaving
  FEAT-021 (M5) with nothing more concrete to build against than a bare flags-column read, when a
  documented audit trail entry (Constitution Law #5's own "clinically significant action" framing
  arguably already covers "a critical value was detected") is a small, honestly-scoped increment.
  This is exactly why §10 Q1 is raised rather than picked.
- **If the "documented audit signal" option is later chosen, folding it into the existing
  `finalize()` audit event (rather than a second, independent `writeAuditEvent()` call) repeats
  TASK-053's own precedent, but stacks a second conditional payload shape onto an already-conditional
  one** (`finalize()`'s response already varies its `calculatedDependent` field per TASK-053) — worth
  a reviewer's explicit attention if it's the path taken, not a reason to avoid it.
- **Only 4 of 14 seeded chemistry analytes have any critical row** — this task's own AC can only be
  golden-dataset-proven for Glucose/Sodium/Potassium/Calcium, the same real, pre-existing limit
  TASK-050 already documented, not a new gap this task introduces.

## 7. Acceptance criteria

TASK-054's literal AC, narrowed per findings #1–#2:
- [ ] Golden dataset HH/LL boundary detection re-confirmed green via the existing, already-merged
  `apps/api/test/flagging.e2e-spec.ts` suite (no regression — proof, not a new assertion).
- [ ] A new e2e case proves a `critical`-rangeType candidate row with a mismatched `unitId` is
  excluded from resolution (`critical.matched === false`) and `computeFlags` therefore does not
  emit `HH`/`LL` for a value that would be critical under the matching unit — the concrete,
  honestly-buildable form of "unit-conversion cases" (finding #2).
- [ ] The new field on the existing `observation.finalize` audit event (§10 Option B) is proven
  present exactly when `flags` includes `HH`/`LL`, and absent otherwise, via a new e2e case —
  the audit-row *count* delta stays identical to TASK-051's own already-proven "exactly one row per
  finalize" behavior; only the payload shape is new.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build — no source change expected in `flagging.ts`/
   `reference-range.ts` themselves (finding #1–#2 found no bug in either), so this step is a
   regression check, not a change-verification step.
2. Full existing `apps/api` e2e suite (`pnpm --filter api test:e2e`) re-run and confirmed still
   green — proves the "boundary" half of the AC is intact, unchanged.
3. New case(s) in `apps/api/test/reference-range-resolution.e2e-spec.ts` and
   `apps/api/test/flagging.e2e-spec.ts`: a synthetic critical-rangeType row on an incompatible unit,
   asserting `no_range` on the critical side and no `HH`/`LL` fabrication.
4. A new case in `apps/api/test/observation.e2e-spec.ts` finalizing a real golden-dataset critical
   value (e.g. Sodium 115, Potassium 7.0) and asserting the new field appears on the existing
   finalize audit event's payload, with the audit-row count delta unchanged (still exactly one).
5. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive-only under either reading of §10 Q1: new e2e test cases, and (if option B) one new
`writeAuditEvent` call site inside an already-existing, already-audited `finalize()` transaction —
no new table, column, or migration under any resolution. Rollback is reverting the PR; no other
feature or shipped screen depends on this task's output yet (TASK-055–057 are FEAT-015's own next
tasks, not yet started).

## 10. Open questions — resolved 2026-08-06 via the native options-prompt

1. **What does "CriticalValueDetected event" concretely mean as this task's deliverable?**
   **Resolved: Option B** — persist a documented critical-detection audit signal, not a bare read of
   `observation.flags`. Gives Constitution Law #5 a literal answer and gives FEAT-021 (M5) a
   concrete, already-audited thing to build its notification trigger against later.
2. **If Option B, what exact shape?** **Resolved: a new field on the existing
   `observation.finalize` audit event's `after` payload** — not a second `writeAuditEvent()` call
   site, not a new `audit_event.action` value. Matches TASK-053's own "fold into the same event"
   precedent exactly.
3. **Does this warrant ADR-0011?** **Resolved: no.** This extends an already-approved audit
   mechanism (FEAT-009) with one new payload field, not new infrastructure — recorded here as a
   same-proposal assumption, same precedent as TASK-049/050's own resolved open questions.
4. **Synthetic fixtures or real golden-dataset data for the new unit-mismatch-for-critical test
   cases?** **Resolved: synthetic fixtures** — matches TASK-049's own age/method precedent; the
   golden dataset's four real critical analytes are not fabricated a fifth, incompatible-unit
   threshold that doesn't exist in real seed data.

---

# Revision: TASK-055 — Verification action + append-only versioning

Status: **IMPLEMENTED** — merged PR #322 (`9fb5f42`), closing #114. Shipped exactly per this
revision's own resolved §10: `POST /v1/ordered-tests/:id/results/:analyteId/verify` (bare, no
body), gated by the existing `verify` capability, audited (`observation.verify`); `verify()`
transitions `'preliminary'` → `'verified'` and sets `verifierUserId`/`verifiedAt`; any other
current status is rejected 409; `upsertObservation` gained a pre-check turning a would-be
append-only-trigger `500` into a proper 409 for `draft()`/`finalize()`/the calculated-dependent
write alike; `observationStatusSchema` widened to include `'verified'`; no public amendment
endpoint was built (Q3) — a new e2e "trigger proof" describe block instead directly inserts an
`amendment_of`-linked row via `@lis/db` and proves `result_history`/`supersededBy` behave
correctly. `apps/api/openapi.json`/`packages/sdk/src/schema.ts` regenerated. Full e2e suite: 135
green (127 pre-existing + 8 new). One real, unplanned finding surfaced only by CI (not this task's
own local `pnpm typecheck`, which false-passed due to `@lis/sdk`'s stale `dist/` — see `testing`
Skill entry #9 in `lis-engineering`): the shared status-enum widening flowed through
`@lis/sdk`'s `ObservationDto` into `apps/web`'s TASK-052 result-entry grid, which hardcoded a
narrower status union in three files — widened to match, no new UI treatment added (TASK-057's
own scope). §10's open questions were resolved by the human as follows:
Q1: bare `POST .../results/:analyteId/verify`, no request body — mirrors `finalize()`'s own
bare-action shape exactly. Q2: reuse the existing `verify` capability (already granted to
`verifier`, not `technologist`) — no new capability or ADR. Q3: **trigger-only proof** — no public
amendment/correction endpoint in this task; a direct-insert e2e test proves
`amendmentOf`/`result_history`/`supersededBy` work correctly, and a real public amendment endpoint
is deferred as an explicitly separate future task. Q4: verifying a critical observation needs
nothing different from verifying a non-critical one for this task's own scope — TASK-056 inherits
the open question of whether this verify action counts as sufficient acknowledgement for
Constitution Law #3.
Date: 2026-08-06    Backlog ID: FEAT-015 (#24) / TASK-055 (#114)

## 1. Goal

TASK-054 (critical detection) is merged (PR #320/#321, `f311a2e`/`a310968`), closing #113.
FEAT-015's next task per its own ordering is **TASK-055 — verification action + append-only
versioning** (#114). Its one dependency, TASK-051 (Result entry API), is merged. Its literal AC:
"A verified row is immutable; amendment correctly creates a new version." Its "Expected output":
"Verification action sub-resource."

**Real, load-bearing finding #1 — the append-only trigger machinery this task depends on is not
just reviewed DDL; it has already been exercised once, successfully, end-to-end, in a non-business
context.** `domain/result-verification` Skill entry #2 states "zero real hits outside
schema/migration/comment text" for `amendment_of` — this is **not fully accurate** and this
proposal corrects it: `packages/db/src/rls-isolation-check.ts` (lines ~161–171) already inserts a
second observation with `amendmentOf: obs.id` set, specifically to exercise the real
`fn_observation_link_created_at` + `fn_observation_supersede` chain "entirely in SQL, at full
precision, exactly as any real correction would in production" (the file's own comment). This is a
genuinely useful, real data point: the trigger chain is proven to run correctly under Postgres,
not just reviewed as SQL text. It does **not** change the core Skill finding — no business code
anywhere sets `status = 'verified'` or calls `amendment_of` from a real write path — TASK-055 is
still the first task to make `'verified'` reachable through the API and the first to make
`amendment_of` a real, user-triggered outcome rather than a one-off isolation-check fixture.

**Real, load-bearing finding #2 — the schema already carries everything "who verified this and
when" needs; no migration is required under any reading of this task.** `packages/db/src/schema/
observation.ts` (read in full) already has `verifierUserId: uuid("verifier_user_id")` (line 87,
"no FK: no user table exists yet (M2)") and `verifiedAt: timestamp("verified_at", { withTimezone:
true })` (line 89) as real, already-migrated columns — not something TASK-020/021 left as a TODO.
Confirms `domain/result-verification` Skill entry #5's implicit premise. Following the same
"additive, no rewrite" precedent as every prior migration in this repo (0007's trigger, 0011's FK
integrity), no new migration is proposed for verification's own "who/when" — the columns are
sitting there, unused (same "built, unused" shape as `reference_range` before TASK-049 and the
append-only trigger before this task). What is genuinely absent, confirmed by the same read: no
`acknowledgedAt`/`readBackAt` pair exists (Skill entry #5's own finding, re-confirmed here) — that
remains TASK-056's own open question, not this task's to resolve or build around.

**Real, load-bearing finding #3 — `fn_observation_append_only`'s exact reject condition, read
directly, confirms entry #3's design point is correct and load-bearing, not a simplification.**
`db/migrations/0007_observation_append_only_trigger.sql`'s `fn_observation_append_only`: `IF
OLD.status = 'verified' THEN` — any `UPDATE` to a row already in that status raises unless
`pg_trigger_depth() > 1 AND OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL AND
(to_jsonb(NEW) - 'superseded_by') = (to_jsonb(OLD) - 'superseded_by')`, i.e. the *only* legal
mutation to a verified row, ever, is `fn_observation_supersede`'s own nested `superseded_by`
backfill — not a top-level UPDATE with any other field changed alongside it. Confirms
`observation.controller.ts`'s existing `upsertObservation` (its single `UPDATE ... WHERE id =
existing.id` on `sharedFields`, used unconditionally today by both `draft()` and `finalize()`) must
never be called again for a row whose current `status` is `'verified'` — calling it would hit this
exact exception and surface as an unhandled 500 today (`upsertObservation` has no try/catch around
its `.update()` call). TASK-055 must branch before calling `upsertObservation` at all once a
prior-verified row is found for the same `(orderedTestId, analyteId)`.

**Real, load-bearing finding #4 — a `verify` capability already exists, already granted to exactly
one of the two seeded roles, structurally proven by a demo route, never yet used by a real business
endpoint.** `apps/api/src/auth/capabilities.ts`'s `Capability` union already includes `'verify'`
(not `'verify_result'`) alongside `'enter_result'`, and `ROLE_CAPABILITIES` grants it only to
`verifier` — **not** to `technologist`, unlike every other existing capability in that file, all of
which are granted to both seeded roles. `apps/api/src/auth/capability-check.controller.ts`'s
`POST /auth/capability-check/verify` route (`@RequireCapability('verify')`, audited) already proves
the guard mechanism works for this capability, the same "prove ahead of a real feature needing it"
precedent TASK-032/033 used for `enter_result` before TASK-051 became its first real consumer
(FEAT-014 proposal's TASK-051 revision, finding #1, cited verbatim: "an `enter_result` capability
already exists... exercised by a demo-only route... No new capability or ADR is needed for
authorization — this task is that capability's first real consumer"). The same sentence applies to
`verify` and TASK-055, with one addition worth a reviewer's attention: `verify`'s grant is already
role-asymmetric (verifier-only), which is itself a real, already-made separation-of-duties decision
— nothing in TASK-032/033's own history explains *why* `technologist` was excluded, but the effect
already matches clinical-lab convention (the person who entered a result should not be the same
person capability-gated to verify it). This proposal treats that asymmetry as intentional,
already-approved infrastructure, not a gap to fix.

**Real, load-bearing finding #5 — the domain Zod schema, not just the DB schema, currently hard-
excludes `'verified'` as a writable/representable status, and will need to widen.**
`packages/domain/src/observation.ts`'s `observationStatusSchema` is `z.enum(["registered",
"preliminary"])`, with its own comment: "`'verified'`/`'reported'`/etc. are TASK-055+'s own scope,
never written here." `observationSchema.status` (the response shape TASK-052's grid UI reads) is
typed against that same narrow enum. TASK-055 cannot leave this schema as-is — the verify action's
response (and the grid's subsequent read) needs `'verified'` to type-check, or `ZodResponse`
validation on the existing `list()`/`draft()`/`finalize()` routes would need a second, divergent
status type. This is a real, load-bearing implementation detail (which schema file the value lives
in, and that widening it is shared surface touching three already-shipped routes), not a new
finding about architecture — flagged here so it isn't missed as "just add a new route."

## 2. Affected files

- `apps/api/src/observation/observation.controller.ts` — a new action sub-resource (exact shape
  per §10 Q1) alongside `draft()`/`finalize()`; `upsertObservation` gains a pre-check (finding #3)
  so it is never called against an already-`'verified'` row; a new, separate insert path for the
  amendment case (per §10 Q3's resolution) if TASK-055 itself exposes one.
- `packages/db/src/schema/observation.ts` — **no migration** (finding #2); read-only for this task.
- `packages/domain/src/observation.ts` — `observationStatusSchema` widens to include `'verified'`
  at minimum (finding #5); whether it also needs `'amended'`/`'corrected'` (both named in
  `observation.status`'s own DB comment, `packages/db/src/schema/observation.ts:82`) depends on
  §10 Q3's resolution — an amendment's *new* row is created with status `'preliminary'` or
  `'verified'` depending how far the amendment flow goes, and its *old* row's status is left alone
  by the trigger (only `superseded_by` changes) per finding #3's exact read, so `'amended'`/
  `'corrected'` may turn out not to be needed as literal `observation.status` values at all —
  confirm during implementation, not prescribed here.
- `apps/api/src/auth/capabilities.ts` — **no change** under finding #4's reading (reuse `verify`,
  already granted to `verifier`); would change only if §10 Q2 is resolved toward a new capability.
- `apps/api/test/observation.e2e-spec.ts` (extend) — new cases: a `verifier`-roled caller can call
  the new action on a `'preliminary'` observation and the row's `status`/`verifierUserId`/
  `verifiedAt` are set correctly; a `technologist`-roled caller is rejected (403, exercising
  finding #4's role asymmetry for the first time against a real business route, not just the demo
  route); a direct `UPDATE` attempt against an already-verified row (via a raw query in the test,
  mirroring `rls-isolation-check.ts`'s own "exercise the real trigger" style) is rejected, proving
  finding #3's negative case end-to-end through this task's own fixtures, not only through the
  pre-existing isolation-check script.
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` — regenerate; the new route and the
  widened `status` enum are both public response-shape changes.
- `domain/result-verification` Skill — this proposal's research corrects entry #2 (finding #1) and
  adds capability/schema-widening findings (#2, #4, #5) not previously captured; updating the Skill
  file itself is implementation-adjacent housekeeping, not prescribed as a file this proposal edits.

**Not affected under any reading:**
- `db/migrations/*` — no new migration under finding #2 (verifier/timestamp columns already exist)
  or under any resolution of §10 Q2 that reuses `verify` (finding #4). Only a resolution that
  invents a genuinely new column (e.g. a critical-specific acknowledgement field, which finding #2
  confirms does not exist) would require one — and that is TASK-056's question (Skill entry #5),
  not this task's.
- `db/migrations/0007_observation_append_only_trigger.sql` — the trigger itself needs no change
  (finding #3); this task is a consumer, not a maintainer, of it.

## 3. Architecture consulted

- Constitution Law #2 (append-only verified data) and Law #5 (audit on clinically significant
  writes) — the two invariants this task's entire AC exists to make real for the first time.
- `db/migrations/0007_observation_append_only_trigger.sql` (ADR-0007) — read directly, in full,
  for finding #3's exact reject condition.
- `packages/db/src/schema/observation.ts` (TASK-020) and `packages/db/src/schema/
  result-history.ts` (TASK-021) — read directly for findings #2 and the "no new history table"
  confirmation carried over from `domain/result-verification` Skill entry #4.
- `apps/api/src/auth/capabilities.ts` / `capability-check.controller.ts` (TASK-032/033) — read
  directly for finding #4.
- `packages/domain/src/observation.ts` — read directly for finding #5.
- `docs/plans/feat-014-result-entry-engine.md`'s TASK-051 revision — direct precedent for (a) how
  an already-existing-but-unused capability gets treated as a finding, not an open question, once
  confirmed to already exist and already fit (finding #1's own citation), and (b) the two-route
  action-sub-resource shape (`PUT` draft / `POST .../finalize`) this proposal's §10 Q1 weighs a
  third route against.
- `domain/result-verification` Skill (entries #1–#6) and `domain/critical-values` Skill (entries
  #2, #6) — both loaded per this revision's own brief; entry #2 corrected by finding #1 above.

## 4. Skills loaded

- `domain/result-verification` (existing, TASK-054's proposal) — all six entries; entry #2 updated
  by this revision's finding #1 (see §1).
- `domain/critical-values` (existing) — entry #2 (low/high inversion, relevant if a verifier-facing
  read ever needs to re-derive criticality rather than trust the already-persisted `flags` column
  — this proposal does not propose such a re-derivation) and entry #6 (TASK-056 depends on this
  task's real, shipped output, not a guess — flagged here so this proposal's own resolution of
  §10 Q3 is written with TASK-056's real future dependency in mind, not just TASK-055's own AC).
- `engineering/api-design` — action-sub-resource-per-audited-verb precedent (`enter_result`'s two
  routes), capability-guard/audit-interceptor pairing convention, and the "every `@Body()` gets its
  own explicit `ZodValidationPipe`" convention this task's new route(s) must also follow.
- `engineering/testing` — real-Postgres e2e precedent (no mocked trigger behavior) for proving
  finding #3's negative case.

## 5. Assumptions & autonomous decisions

- **No migration is proposed.** Findings #2 and #4 together mean every column and every capability
  this task's literal AC needs already exists. This is treated as a finding, following TASK-051's
  own precedent for `enter_result`, not left open for a human to re-confirm — unless §10 Q2 or Q4
  is resolved toward inventing something new, in which case this assumption is void for that path
  only.
- **`amendment_of`'s target row is looked up by `(orderedTestId, analyteId)` the same way
  `upsertObservation` already finds "the existing row" today** — an amendment corrects *the*
  current observation for that analyte on that ordered test, not an arbitrary historical id passed
  by the caller. No endpoint is assumed to accept an arbitrary `observationId` to amend; the target
  is always resolved server-side from the same identity `draft`/`finalize` already use.
- **Verifying a critical (`HH`/`LL`-flagged) observation is assumed, for this task's own narrow AC,
  to need nothing different from verifying a non-critical one** — same action, same capability,
  same state transition. This is an explicit assumption, not a finding: `domain/result-verification`
  Skill entry #5 names the adjacent open question (is TASK-055's verify sufficient acknowledgement
  for Law #3's purposes) as real and unresolved, and this proposal does not resolve it — it is
  named again in §10 below specifically so TASK-056's own proposal inherits it explicitly rather
  than re-discovering it.
- **This proposal does not choose between "amendment is TASK-055's own new endpoint" and
  "amendment is proven only via a direct-insert test"** (§10 Q3) — per this task's own instruction
  to surface, not resolve, scope questions touching a new HTTP surface.

## 6. Risks

- **The central risk is the same shape as TASK-054's own: the AC's second half ("amendment
  correctly creates a new version") is more expansive to build a full public endpoint for than to
  prove at the trigger level**, and the issue text alone does not say which reading FEAT-015's
  authors intended. Building a full amendment endpoint this task does not need yet risks scope
  creep into what could be a distinct, later task; proving only the trigger risks leaving "verified
  row is immutable" as the only half with a real public API surface, with "amendment" remaining a
  capability visible only in the database, not to any real user — worth the reviewer's explicit
  attention (§10 Q3).
- **The `verify` capability's existing verifier-only grant (finding #4) has never been tested
  against a real, non-demo route.** If the intent behind that asymmetry was ever documented
  somewhere this research didn't find, this task's own e2e test (a `technologist` getting 403 on
  the new route) is the first real proof either way — a reviewer should treat a first-time failure
  of that assertion as a signal the intent may differ from what finding #4 assumes, not a bug in
  the test.
- **Widening `observationStatusSchema` (finding #5) is shared surface** — `draft()`, `finalize()`,
  and `list()` all currently type-check against the narrow two-value enum; widening it is a small,
  additive change in isolation, but touches three already-shipped, already-tested routes' response
  types. Low risk (additive to a `z.enum`, not a narrowing), but not zero-touch.
- **No new risk to `result_history` or the partitioning scheme (ADR-0008)** — this task exercises
  already-built machinery (finding #1), it does not modify it.

## 7. Acceptance criteria

TASK-055's literal AC, read directly, pending §10's resolution:
- [ ] A `verifier`-roled caller can transition a `'preliminary'` observation to `'verified'` via
  the new action sub-resource (exact route per §10 Q1), with `verifierUserId`/`verifiedAt` set
  correctly on the row.
- [ ] A `technologist`-roled caller (lacking `verify`) is rejected with 403 on the same route,
  real-route proof of finding #4's existing role asymmetry.
- [ ] Any direct `UPDATE` attempt against an already-`'verified'` row is rejected by
  `fn_observation_append_only` (finding #3), proven via this task's own e2e fixtures.
- [ ] "Amendment correctly creates a new version" is proven per §10 Q3's resolution: either (a) a
  new amendment endpoint correctly inserts a new row with `amendmentOf` set and the trigger's
  archival/supersession fires (`result_history` gains a row, the old row's `supersededBy` is set),
  or (b) a direct-insert test proves the same trigger behavior without a new public endpoint, if
  Q3 resolves that a public amendment surface is out of this task's own scope.
- [ ] The verify action is audited (`@Audit`), matching `finalize()`'s own precedent — a bare read
  of `observation.flags` is not audited (per `engineering/api-design` entry #6), but this is a
  mutating, clinically significant action and Law #5 applies unambiguously here, unlike TASK-054's
  own genuinely ambiguous "is a flags-column already sufficient" question.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build — regression check; finding #2 means no schema file
   changes are expected here.
2. `pnpm --filter api test:e2e` full suite re-run, confirming no regression to `draft()`/
   `finalize()`/`list()` from the `observationStatusSchema` widening (finding #5).
3. New e2e cases in `apps/api/test/observation.e2e-spec.ts`: verify success (verifier role),
   verify rejection (technologist role, 403), append-only rejection (direct UPDATE against a
   verified row), and the amendment case per §10 Q3's resolution.
4. A `result_history` row-count and `supersededBy`-linkage assertion on the amendment case, the
   same "exact before/after delta" discipline TASK-051's own audit-count tests already established
   for `observation.finalize`.
5. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive under every reading that reuses the existing `verify` capability and existing
`verifierUserId`/`verifiedAt` columns (findings #2, #4): a new route (and, per §10 Q3, possibly a
second new route for amendment), a widened `z.enum`, and new e2e tests — no migration, no trigger
change. Rollback is reverting the PR. TASK-056 (finalization block) is the first task with a real
dependency on this one's shipped output (per `domain/critical-values` Skill entry #6) and has not
started; no other feature or shipped screen depends on this task's output yet.

## 10. Open questions — resolved 2026-08-06 via the native options-prompt

1. **HTTP shape / body.** **Resolved: bare `POST .../results/:analyteId/verify`, no request
   body** — mirrors `finalize()`'s own bare-action shape exactly. No verifier free-text comment
   field in this task.
2. **Capability reuse vs. new capability.** **Resolved: reuse the existing `verify` capability**
   (already granted to `verifier`, not `technologist`) — same "already-fitting capability" pattern
   TASK-051 used for `enter_result`. No new capability or ADR.
3. **Public amendment endpoint vs. trigger-only proof.** **Resolved: trigger-only proof.** No public
   amendment/correction endpoint is built in this task. A direct-insert e2e test proves
   `amendmentOf`/`result_history`/`supersededBy` behave correctly, matching this task's own narrow
   "Expected output: Verification action sub-resource" (singular). A real public amendment endpoint
   is deferred as an explicitly separate future task, not silently folded into TASK-055.
4. **Critical-value verification.** **Resolved: no difference from ordinary verification** for this
   task's own scope. TASK-056's own proposal inherits, explicitly, the open question of whether this
   verify action is sufficient acknowledgement for Constitution Law #3, or whether a distinct
   acknowledgement step is needed later.

Note on the schema/column question and the capability question named in this revision's own task
brief: both were addressed above as **findings (#2, #4), not left open** — real code inspection
found the verifier/timestamp columns and the `verify` capability already exist and already fit,
the same way TASK-051's own proposal resolved its equivalent `enter_result` question via a finding
rather than a human decision.
either resolution via the options-prompt if this research missed something.
