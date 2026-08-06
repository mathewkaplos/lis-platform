# Implementation Proposal: FEAT-015 Verification & criticals
Status: **FULLY IMPLEMENTED** — all four tasks merged. TASK-054 (PR #320, `f311a2e`, closing #113,
critical-value detection), TASK-055 (PR #322, `9fb5f42`, closing #114, verification action +
append-only versioning), TASK-056 (PR #324, `6b9488f`, closing #115, finalization block on
unacknowledged critical), TASK-057 (PR #328, `dd9b8f7`, closing #116, verification UI). FEAT-015
(#24) itself still needs its own manual-comment close — bare `Closes` lines don't auto-close a
parent feature issue, the same recurring gotcha every prior feature in this repo has hit.
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

---

# Revision: TASK-056 — Finalization block on unacknowledged critical (409)

Status: **IMPLEMENTED** — merged PR #324 (`6b9488f`), closing #115. Shipped exactly per this
revision's own resolved §10: the `ordered_test.status → 'resulted'` roll-up inside `finalize()`
(not the per-analyte write itself, which would reintroduce the detection/block paradox) is guarded,
returning 409 when completing the panel would leave an observation with `HH`/`LL` flags whose
`status <> 'verified'`; TASK-055's `verify()` alone counts as acknowledgement — no new column, no
new endpoint, reuses the already-GIN-indexed `flags` column; the 409's `detail` string carries a
generic, formatted count of pending criticals — no `ProblemDetailsFilter`/`ProblemDetails` shape
change.

**Real, load-bearing finding from implementation, directly answering §10 Q1's own transactional
sub-question:** the analyte's own observation write and its `observation.finalize` audit event
needed to commit even when the `finalize()` call itself returns 409 — achieved with a new
`FinalizationRollupInterceptor`, layered *outside* `TenantContextInterceptor` in the interceptor
chain, so its post-handler roll-up check only runs after that inner `db.transaction()` has already
committed (a drizzle `db.transaction()` promise only resolves after a real Postgres `COMMIT`). A
409 thrown from the new interceptor can therefore never unwind an already-committed write, unlike a
409 thrown from inside the same transaction as the write, which the approved proposal explicitly
rules out.

**A second, unplanned finding, surfaced only by the positive-path test itself** (verify a critical
analyte, then finalize a different, later analyte on the same panel): the roll-up's own
pre-existing "is every required analyte finalized" check only ever matched `status = 'preliminary'`,
so a panel could never reach `'resulted'` once one of its analytes had already been verified ahead
of the rest — legal under `verify()`'s own design, which has no ordered-test-status gate of its own.
Fixed by counting `'preliminary'` and `'verified'` both as "finalized." A synthetic two-analyte
(Sodium + BUN) `test_definition` fixture was added to the e2e spec to exercise this case, since no
seeded multi-analyte panel pairs a golden-dataset critical analyte with another analyte on the same
panel.

Verified end-to-end: `pnpm --filter api test:e2e` 138/138 (135 baseline + 3: the existing
unverified-blocks-finalize test updated to assert 409 semantics, a new positive-path
verified-before-last-finalize case, and a new non-critical-panel regression case); repo-wide
`typecheck`/`lint`/`build` green; no `openapi.json`/SDK regeneration needed (`finalize()`'s response
shape is unchanged; the 409 uses the existing generic `ProblemDetails.detail` string convention).
`#115` auto-closed via PR #324's bare `Closes #115` line.

§10's open questions were resolved by the human as follows:
Q1: **candidate (b)** — the `ordered_test.status → 'resulted'` roll-up is the finalization being
guarded, and the finalize() call **itself returns 409** when it would complete a panel that still
has an unacknowledged critical (not a silent 200 non-advance). Q1's transactional sub-question: the
analyte's own just-entered observation write is **persisted** even though the call returns 409 —
only the `ordered_test.status` roll-up to `'resulted'` is blocked, so a technologist never loses a
real typed value because the panel can't yet close out. Q2/Q3: **`verify()` alone is sufficient**
acknowledgement for Constitution Law #3 — no new column, no new acknowledgement action; FEAT-021
(M5, not started) still owns the richer notification/read-back/escalation delivery separately. Q4:
the 409's `detail` string carries a generic, formatted message (e.g. naming how many criticals are
pending) — no change to `ProblemDetailsFilter`/`ProblemDetails` itself.
Date: 2026-08-06    Backlog ID: FEAT-015 (#24) / TASK-056 (#115)

## 1. Goal

TASK-055 (verification action + append-only versioning) is merged (PR #322/#323, `9fb5f42`),
closing #114. FEAT-015's next task per its own ordering is **TASK-056 — finalization block on
unacknowledged critical (409)** (#115). Its stated dependency, read directly from the issue, is
**TASK-054** (critical detection, #113) — not TASK-055, even though TASK-055's `verify()` action is
obviously the only mechanism in this codebase that could plausibly satisfy "acknowledged." Its
literal AC: "Integration test proves finalization returns 409 while any critical is unacknowledged."
Its "Expected output": "Finalization guard."

**Real, load-bearing finding #1 — this repo has no single thing called "finalization"; there are
three distinct, already-shipped candidates, and only one is honestly buildable without contradicting
TASK-054's own shipped mechanism.** Read directly, in full, from
`apps/api/src/observation/observation.controller.ts`:

1. **`observation.finalize()` (TASK-051, `POST .../results/:analyteId/finalize`)** — the per-analyte
   action that transitions one `observation` row `'registered'`/absent → `'preliminary'`. This is
   the literal call inside which `computeFlags` runs and `row.flags` gets `HH`/`LL` written
   (TASK-054's own `criticalDetected` audit field, line 748, reads exactly this call's own
   just-written `row.flags`). **Blocking this call outright whenever a critical is unacknowledged is
   the paradox the task brief names**: the very call that would first make a value's criticality
   knowable to the system is the same call a naive reading of the AC would reject with 409, and
   `criticalDetected` could then never be set for the first, defining case (a *newly*-critical
   value). No test or Skill entry suggests this reading is intended.
2. **`ordered_test.status` → `'resulted'` (also inside `finalize()`, lines 691–720)** — once every
   analyte named by the ordered test's own `test_analyte` rows has a `'preliminary'` observation, the
   *same* `finalize()` call that completes the panel flips `ordered_test.status` to `'resulted'`.
   This is a real, already-shipped state transition distinct from the per-analyte write above, and
   the only other status-advancing write in this file (`draft()`'s `'received'` → `'in_process'` is
   the sole other one; neither `order.controller.ts` nor any other file writes `ordered_test.status`
   forward — confirmed by a direct grep, see §3). It is the load-bearing candidate this proposal's
   own research finds most consistent with what already exists: it represents "this panel is done,"
   is literally reachable only via the code path named `finalize()`, and — critically — **does not
   need to block the per-analyte write that detects the critical**, only the roll-up that follows it
   in the same function, which avoids finding #1's paradox by construction (see finding #2 below for
   the residual ambiguity this still leaves).
3. **Report finalization** — Constitution Law #3's own literal text ("...block **report**
   finalization until acknowledged") and KB-34's own worked example ("...only then can the report
   finalize," `/mnt/d/LIS/research/34-notification-system.md:90-91`). Confirmed directly:
   `github/issues/features/FEAT-016-minimal-report.md` (dependencies: `[FEAT-015]`, status "Not
   Started," tasks TASK-058/059/060 all unstarted) — **no report-finalization endpoint exists
   anywhere in this codebase to block.** This is a real, load-bearing tension between the
   Constitution's literal wording and what is actually buildable today: FEAT-016 depends on FEAT-015
   completing, so TASK-056 cannot literally implement "block report finalization" without either (a)
   building report finalization itself (wildly out of scope — FEAT-016 is a separate, 5-day, M4
   feature with its own unstarted tasks) or (b) treating candidate 2 as what Law #3 actually means
   *right now*, with FEAT-016 expected to consult/re-check this same guard once it exists. KB-34's
   own line 57 supports reading (b) directly: "the result engine enforces the finalization block on
   unacknowledged criticals" — naming the *result engine* (this repo's `observation`/`ordered_test`
   machinery, KB-14), not the not-yet-built report/notification systems, as the owner of the block
   itself.

**Real, load-bearing finding #2 — even scoped to candidate 2 (the `ordered_test` → `'resulted'`
roll-up), the exact point of insertion still has a real, unresolved sub-ambiguity the AC's own
wording does not settle.** `loadWriteContext`'s `ENTERABLE_ORDERED_TEST_STATUSES` guard
(`['received', 'in_process']`) already rejects any `draft()`/`finalize()` call once
`ordered_test.status` is `'resulted'` — traced directly, this means **no `finalize()` call ever
reaches the roll-up logic except the one call that would itself be the last analyte to complete the
panel**. There is no separate "close out the order" action to gate independently; the roll-up
check and the last analyte's own per-analyte write happen inside one HTTP request. This produces two
materially different implementations, both consistent with candidate 2 but reading the literal AC's
"finalization returns 409" two different ways:
- **(a) Silent non-advancement, 200 returned.** The last analyte's own observation write still
  succeeds (still 200, same response shape as today); the guard only suppresses the
  `ordered_test.status = 'resulted'` update when an unacknowledged critical exists anywhere on the
  panel (including the one just written this call, since its own flags are already known by the time
  the roll-up check runs — after `upsertObservation`, not before). Under this reading, **no caller
  of `finalize()` ever actually receives a 409** — the guard is invisible to the AC's own literal
  "integration test proves finalization returns 409" wording, which this reading does not satisfy
  literally, only in spirit.
- **(b) The finalize call itself throws 409.** The same check instead throws `ConflictException`
  before (or instead of) committing the roll-up, and the surrounding transaction is rolled back —
  meaning the analyte's own result entry (which this same call was trying to finalize) is discarded
  along with the status advancement, or the check runs *after* the observation commit but the HTTP
  response is still a 409 with the observation already persisted underneath it (an unusual shape:
  "the write happened, but you get an error"). Reading (b) satisfies the AC's literal wording but
  reintroduces a milder version of finding #1's paradox for the *specific* analyte that is itself
  newly critical and is also the panel's last analyte: that call both detects the criticality and is
  rejected because of it, in the same request.

This proposal does not resolve which of (a)/(b) is intended — see §10 Q1. Neither is a technical
gap; both are one afternoon's implementation once chosen.

**Real, load-bearing finding #3 — "unacknowledged" has no dedicated column, and TASK-055's own
`verify()` (read directly, not from its proposal's description) is the only candidate mechanism that
exists.** `apps/api/src/observation/observation.controller.ts`'s real `verify()` handler (lines
772–831): a bare `POST .../results/:analyteId/verify`, gated by the `verify` capability
(verifier-only), transitions `observation.status` `'preliminary'` → `'verified'` and sets
`verifierUserId`/`verifiedAt` — nothing else. It has **no ordered-test-status gate of its own** (an
analyte can be verified whether its panel is `'in_process'` or already `'resulted'`) and **no
critical-specific branch at all** — verifying a critical observation is byte-for-byte identical to
verifying a non-critical one (TASK-055 proposal §10 Q4, its own resolved assumption). There is no
`acknowledgedAt`/`readBackAt` column anywhere on `observation` (confirmed again here by re-reading
`packages/db/src/schema/observation.ts` in full — only `verifierUserId`/`verifiedAt` exist, both
from TASK-020, both unrelated in original intent to Law #3's specific "documented notification with
read-back" language). TASK-055's own proposal explicitly deferred this exact question to TASK-056
(§10 Q4: "TASK-056 inherits the open question of whether this verify action counts as sufficient
acknowledgement for Constitution Law #3"); `domain/critical-values` Skill entry #6 and
`domain/result-verification` Skill entry #5 both independently flag the identical gap. This
proposal likewise does not resolve it — see §10 Q2/Q3.

**Real, load-bearing finding #4 — KB-34's own architecture split assigns "read-back" to a different,
later feature, but its own worked example still says finalization waits for it, which is a genuine
tension, not a clean separation.** `/mnt/d/LIS/research/34-notification-system.md`, read in full
around the critical-value section: line 19–21 ("All outbound notifications and acknowledgement
tracking [belongs to KB-34/FEAT-021]... Critical detection itself happens in the result engine
([14])"), line 39–47 (the documented **read-back** — "the clinician repeats the value to confirm
correct receipt" — is captured as part of the notification workflow's own acknowledgement step, not
named as something the result engine itself performs), and line 57 ("the result engine enforces the
finalization block on unacknowledged criticals" — i.e., FEAT-015/TASK-056's own codebase is where the
*block* lives, even though the *acknowledgement capture* KB-34 describes as "read-back" is FEAT-021's
job). Read together, this supports treating TASK-056 as the consumer of *whatever* acknowledgement
signal exists at the time it ships (today: only TASK-055's `verify()`), with FEAT-021 (M5,
`github/issues/features/FEAT-021-critical-notification-read-back-escalation.md`, dependency
`[FEAT-015]`, still "Not Started") expected to either (a) layer a richer, distinct
acknowledgement/read-back capture on top later, which TASK-056's guard would then need to be updated
to also check, or (b) treat `verify()` as already satisfying "acknowledged" and scope its own
"read-back" language to notification delivery/escalation only, never touching TASK-056's guard
again. Both are legitimate readings of KB-34's own text; this proposal does not pick between them
(§10 Q2).

**Real, load-bearing finding #5 — the global error shape has no field today that could name "which
analyte(s) blocked this," and adding one would be a shared-surface change, not a local one.**
`apps/api/src/common/problem-details.filter.ts` (ADR-0013 §2, RFC 9457 `problem+json`, the sole
global exception filter) builds its `ProblemDetails` response from exactly `type`/`title`/`status`/
`detail`/`instance`/`code`, plus an `errors` array populated **only** for `ZodValidationException`
(line 62–74) — any other `HttpException` (including every existing `ConflictException` in this
controller) only ever contributes a string into `detail` (line 76–83, reading `.message` off the
exception body). There is no existing precedent anywhere in this repo for a `ConflictException`
carrying structured data (e.g., a list of blocking analyte IDs) through to the client — doing so
would mean either (a) encoding it as a formatted string inside `detail` (zero-touch, matches every
existing `ConflictException` in this file), or (b) extending `ProblemDetails`/the filter itself to
pass through an exception's own extra fields generically, which is shared surface touching every
route in the API, not just this one guard. Neither is prescribed here (§10 Q4).

## 2. Affected files

Exact files depend on §10's resolution (which finalization point, and the response shape); the
following are affected under every resolution that keeps the guard inside the existing
`finalize()` handler (the only reading this research finds buildable without inventing a new HTTP
surface, per finding #1):

- `apps/api/src/observation/observation.controller.ts` — `finalize()` gains a query (whether it
  runs before or after `upsertObservation`'s own write, and whether it inspects only *other*
  analytes' persisted flags or also the just-written one, is exactly §10 Q1's undecided sub-case)
  for "does this ordered test have any `observation` with `flags && ARRAY['HH','LL']` and
  `status <> 'verified'`?" — reusing the already-GIN-indexed `ix_obs_flags` column (TASK-050), no new
  index needed. The roll-up block at lines 715–720 (`if (allFinalized) { ...status: 'resulted' }`)
  is the literal insertion point under candidate 2's reading (finding #1).
- `apps/api/test/observation.e2e-spec.ts` (extend) — the literal AC's own integration test: finalize
  a golden-dataset critical value (e.g., Sodium 115) as a panel's last remaining analyte, with no
  prior `verify()` call on it, and assert the resolution chosen for §10 Q1's (a)/(b) split
  (`ordered_test.status` still `'in_process'` and 200 returned, or a 409 on the call itself,
  depending which is picked) — plus a positive case, the same panel completing normally once the
  critical analyte has been verified first.
- `domain/critical-values` and `domain/result-verification` Skills — both already carry entries
  (#6 and #5 respectively) anticipating this exact gap; this proposal's findings extend, not
  contradict, either — see §10's own notes on what remains genuinely open versus what this research
  newly confirmed (finding #2's (a)/(b) split, and finding #5's error-shape gap, are new; neither
  Skill entry named them).
- `packages/db/src/schema/observation.ts` — **only** if §10 Q3 resolves toward a new
  `acknowledgedAt`-style column; otherwise unaffected (no migration under the "verify() is
  sufficient" reading).
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` — regenerate only if `finalize()`'s response
  shape changes (e.g., a 200-but-non-advancing reading under §10 Q1(a) needs no shape change at all;
  a 409 body naming blocking analytes under §10 Q4's option (b) would).

**Not affected under any reading:**
- `apps/api/src/observation/observation.controller.ts`'s `verify()` handler itself — no finding here
  suggests `verify()` needs to change; it is TASK-056's dependency to *read*, not to modify (its own
  finding #3 confirms it already sets everything TASK-056 could plausibly check today).
- `db/migrations/0007_observation_append_only_trigger.sql` — unrelated; that trigger enforces
  append-only on already-verified rows, a different invariant (Law #2) than this task's (Law #3).
- `apps/api/src/order/order.controller.ts` — confirmed by direct grep (§3) that no other file writes
  `ordered_test.status` forward; this task's guard belongs solely inside `finalize()`.
- FEAT-016 (`github/issues/features/FEAT-016-minimal-report.md`) and its TASK-058/059/060 — confirmed
  "Not Started," depends on FEAT-015; this proposal does not build any part of it (finding #1,
  candidate 3).

## 3. Architecture consulted

- Constitution Law #3 ("Critical values never auto-verify... require human verification, a
  documented notification with read-back, and block report finalization until acknowledged") — the
  literal source of this task's own ambiguity (finding #1, candidate 3).
- KB-14 Result Engine — its five-step pipeline names detection and the
  notification/acknowledgement/finalization-block machinery as adjacent, and (per the FEAT-015
  proposal's own §3, cited again here) assigns the *block* itself to the result engine, matching
  finding #4's reading.
- KB-34 Notification System, read in full around its critical-value section
  (`/mnt/d/LIS/research/34-notification-system.md` lines 12–99) — direct source of "documented
  read-back" (finding #3/#4), and of the specific line ("the result engine enforces the finalization
  block on unacknowledged criticals," line 57) this proposal leans on to scope TASK-056 to the result
  engine rather than to a not-yet-built report/notification surface.
- `apps/api/src/observation/observation.controller.ts` (`finalize()`, lines 618–751; `verify()`,
  lines 753–831) — read in full for findings #1–#3; the only file in this repo where "finalization"
  and "verification" both concretely exist as code today.
- `packages/db/src/schema/order.ts` (the `ordered_test` table) — read in full for its own `status`
  CHECK constraint (`'ordered'|'collected'|'received'|'in_process'|'resulted'|'verified'|'reported'
  |'cancelled'|'rejected'`) and its header comment confirming only `'ordered'`/`'in_process'`/
  `'resulted'`/`'cancelled'` are written by any code today — `'verified'`/`'reported'` at the
  *ordered_test* level (as distinct from `observation.status`'s own, unrelated `'verified'` value)
  are reserved, unwritten future states per KB-03's own state machine, not something this task
  should assume it can or should start writing.
- `apps/api/src/common/problem-details.filter.ts` (ADR-0013 §2) — read in full for finding #5.
- `github/issues/features/FEAT-016-minimal-report.md` and
  `github/issues/features/FEAT-021-critical-notification-read-back-escalation.md` — both read for
  their own dependency/status fields, confirming finding #1 (candidate 3) and finding #4.
- `docs/plans/feat-015-verification-criticals.md`'s own TASK-054 and TASK-055 revisions (this file)
  — direct precedent for this task's own §10 Q4 (TASK-055's Q4 explicitly deferred the
  acknowledgement-sufficiency question to this proposal) and for the "surface, don't resolve" §10
  convention this revision follows.

## 4. Skills loaded

- `domain/critical-values` — all 6 entries; entry #6 (updated post-TASK-055) is the direct precedent
  for this proposal's finding #3, and is itself extended by this proposal's finding #2 (the (a)/(b)
  roll-up-timing split, which entry #6 does not name) and finding #5 (the error-shape gap, also not
  previously named).
- `domain/result-verification` — all 7 entries; entry #5 is the direct precedent for finding #3's
  "no acknowledgement-specific column" finding, and entry #7 (verifier identity not exposed by any
  read route) is relevant to §10 Q4 if a 409 body ever needs to name *who* still needs to verify, not
  just *which analyte*.
- `engineering/api-design` — entry #2 (RFC 9457 `problem+json`, the direct source of finding #5),
  entry #7 (cross-tenant 404 convention, relevant if this task's own `NotFoundException`/
  `ConflictException` choice needs to follow existing precedent), and entry #11 (slash-verb
  action-sub-resource convention — not directly load-bearing here since this task extends an
  existing route rather than adding a new one, but confirms no new route is the expected shape).
- `engineering/testing` — entry #1 (real-Postgres e2e precedent, not mocked trigger/flag behavior)
  and entry #4 (golden-dataset boundary framing) — this task's own integration test needs a real
  critical golden-dataset value (Sodium/Potassium/Glucose/Calcium, per `domain/critical-values`
  entry #3's "only 4 of 14" limit, re-cited here since it still applies to whatever value is chosen
  for the new test case).

## 5. Assumptions & autonomous decisions

- **The guard belongs inside `finalize()`, not a new endpoint.** No finding above surfaces a need
  for a new HTTP surface; `loadWriteContext`'s own `ENTERABLE_ORDERED_TEST_STATUSES` guard already
  means no other call site could reach a "close out this order" moment even if one wanted to add a
  separate action (finding #2). This is treated as settled, following TASK-051/054/055's own
  precedent for not inventing new architecture ahead of a real need — but see §10 Q1 for what
  *inside* `finalize()` remains open.
- **Report finalization (Constitution Law #3's own literal words) is explicitly out of this task's
  scope**, per finding #1 candidate 3 — FEAT-016 does not exist yet, and TASK-056 cannot honestly
  block an endpoint that has not been built. This proposal treats KB-34's own "the result engine
  enforces the finalization block" (line 57) as authorizing this narrowing, not as this proposal's
  own invention.
- **No event bus, notification, or escalation mechanism is proposed** — same reasoning as
  `domain/critical-values` entry #4 and the TASK-054 proposal's own finding #5; FEAT-021 (M5) still
  owns all of that, unstarted.
- **This proposal does not choose an answer to any of §10's four questions.** Unlike TASK-054's
  Q3 (ADR necessity) or TASK-055's Q1/Q2 (HTTP shape, capability reuse), which had one honestly
  buildable answer each once researched, all four of TASK-056's own open questions have at least two
  live, defensible readings this research could not collapse to one without a human decision —
  the same discipline TASK-054/055's own §10 sections used for their genuinely ambiguous questions
  (TASK-054 Q1, TASK-055 Q3).

## 6. Risks

- **The central risk is, again, scope/reading ambiguity, not a technical one** — but here it is
  sharper than TASK-054/055's own versions: picking the wrong one of finding #1's three candidates
  would mean either reintroducing the exact paradox the task brief warns about (candidate 1),
  building a feature this repo has explicitly not started yet (candidate 3), or shipping a guard
  that never actually returns a 409 to any real caller (candidate 2, reading (a)) against an AC that
  literally says "returns 409."
- **Reading (b) of finding #2 (finalize-call itself 409s) has a real transactional consequence worth
  a reviewer's explicit attention**: if the observation write and the roll-up check share one
  transaction (as `finalize()` does today for every other check inside it), a 409 thrown after
  `upsertObservation` has already run means either the whole transaction rolls back (the analyte's
  result entry is silently lost from the caller's perspective — a technologist who just typed in a
  critical value would see it rejected, which may or may not be the intended UX) or the check must
  run and fail *before* `upsertObservation` is called at all (meaning the critical value is never
  detected or persisted for that attempt, closer to finding #1's paradox again, just scoped to the
  last-analyte-of-a-panel case specifically rather than every finalize call).
- **If Q3 resolves toward a new `acknowledgedAt` column, this becomes a real migration** — the first
  new column FEAT-015 would introduce (TASK-054/055 both found no migration was needed); worth
  flagging since every prior task in this feature has been additive-only against already-migrated
  structure.
- **Only 4 of 14 seeded chemistry analytes have any critical row** (re-cited from
  `domain/critical-values` entry #3) — this task's own integration test is bounded by the same real
  data limit as TASK-054's.

## 7. Acceptance criteria

TASK-056's literal AC, pending §10's resolution — cannot be finalized (no pun intended) into
checkable items until Q1/Q2/Q3/Q4 are answered:
- [ ] Integration test proves finalization returns 409 while any critical is unacknowledged — exact
  meaning of "finalization" (§10 Q1), "critical" (already well-defined per TASK-054), and
  "unacknowledged" (§10 Q2/Q3) must be settled first.
- [ ] A positive-path test proves the same panel completes normally (whatever "completes" means
  under the chosen §10 Q1 reading) once the critical analyte has been verified/acknowledged first.
- [ ] No regression to `draft()`/`finalize()`/`verify()`'s existing behavior for panels with no
  critical analytes at all (the overwhelming majority of golden-dataset analytes, per
  `domain/critical-values` entry #3).

## 8. Testing plan

1. `pnpm --filter api test:e2e` full suite re-run before any change, confirming the current 135-test
   baseline (per TASK-055's own revision) is the correct starting point.
2. New e2e case(s) in `apps/api/test/observation.e2e-spec.ts`: finalize every analyte on a
   golden-dataset panel containing one critical analyte (e.g., Sodium at 115) as the last remaining
   write, without a prior `verify()` call, and assert the outcome §10 Q1 resolves to (either a 409 on
   that call, or a 200 with `ordered_test.status` still not `'resulted'`).
3. A companion case: the same panel, but the critical analyte is `verify()`'d before the last
   analyte's finalize call — assert normal completion (whatever "normal" means under the chosen
   reading), proving the guard is not permanently stuck once acknowledged.
4. A non-critical-panel regression case, confirming no behavior change for the common case.
5. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive under every reading that does not require a new column (§10 Q3's "verify() is sufficient"
option): a new conditional check inside `finalize()`'s existing roll-up branch, plus new e2e tests —
no migration, no new route. Rollback is reverting the PR. TASK-057 (verification UI) is FEAT-015's
next and final named task, and per finding #5 above may need whatever error shape this task chooses
in order to show something useful to a user blocked by this guard — a real, not yet started,
downstream dependency worth naming even though TASK-057 has not begun.

## 10. Open questions — resolved 2026-08-06 via the native options-prompt

1. **Which finalization is actually being blocked?** **Resolved: candidate (b)** — the
   `ordered_test.status → 'resulted'` roll-up already inside `finalize()`, not the per-analyte write
   itself (candidate (a), which would reintroduce the detection/block paradox) and not report
   finalization (candidate (c), unbuildable today — FEAT-016 not started). Within (b): **the
   `finalize()` HTTP call itself returns 409** when it would complete a panel that still has an
   unacknowledged critical — a silent 200 non-advance was rejected as not literally satisfying the
   AC's own "returns 409" wording. Transactional sub-question: **the analyte's own observation write
   is persisted** even though the call returns 409 — only the `ordered_test.status` roll-up is
   blocked, so a technologist's real typed value is never lost just because the panel can't yet
   close out.
2. **What counts as "acknowledged"?** **Resolved: TASK-055's `verify()` alone is sufficient** —
   `observation.status = 'verified'` is the acknowledgement signal this guard checks. No distinct
   acknowledgement action or column. FEAT-021 (M5, not started) still owns the richer notification/
   read-back/escalation delivery separately, per KB-34's own architecture split.
3. **Does a new column need to be added on `observation`?** **Resolved: no** — follows directly from
   Q2; checking `status <> 'verified'` on any `flags && ARRAY['HH','LL']` observation reuses
   already-shipped TASK-054/055 columns entirely.
4. **What is the exact response/error shape for the 409?** **Resolved: a generic, formatted message
   in the existing `detail` string** (e.g., naming how many criticals are pending, not which specific
   analyte) — no change to `ProblemDetailsFilter`/`ProblemDetails`. A richer, structured shape
   (naming specific blocking analytes) is deferred until TASK-057's own UI genuinely needs one.

---

# Revision: TASK-057 — Verification UI (delta/QC/prior context, verify+next)

Status: **IMPLEMENTED** — merged PR #328 (`dd9b8f7`), closing #116. Shipped exactly per this
revision's own resolved §10: a "Verify" affordance added to the existing TASK-052 results grid,
visible only to `verifier`-roled sessions (`apps/web/auth/roles.ts`'s new `hasVerifierRole`, this
repo's first frontend role-visibility check, fails closed on a missing/malformed session);
`isVerifiable`/`focusNextVerifiable` mirror `isEnterable`/`focusNextEnterable` exactly, giving
verify+next auto-advance keyboard-only; a verified row now shows verifier identity/timestamp
(`observationSchema` widened for the already-existing `verifierUserId`/`verifiedAt` columns); a new
`GET .../results/:analyteId/prior` read path surfaces the patient's own prior result for the same
analyte, no computed delta, no QC context.

**Real, load-bearing finding from implementation, smaller than the proposal's own framing
anticipated:** the prior-result query needs no join through `order`/`ordered_test` at all.
`observation.patientId` is already a real, non-null column set directly by `upsertObservation` at
write time (not derived through a join), and `ix_obs_trend` (`packages/db/src/schema/
observation.ts`) is already a composite index on exactly `(tenantId, patientId, analyteId,
producedAt)` — built ahead of this task's own need. `prior()` only joins `orderedTest` -> `order` to
resolve the *current* ordered test's own `patientId`; the actual prior-result lookup is a single,
already-indexed, single-table `observation` read.

**A second, unplanned finding, caught only by attempting a real compiled-server boot for
`web-verify` verification, not by any automated check:** a stale `apps/api/tsconfig.build.tsbuildinfo`
made `nest build` report success while writing zero files to `dist/` — `tsc`'s own incremental cache
doesn't notice `deleteOutDir` removed the output directory it thinks is already up to date. Deleting
the stray `.tsbuildinfo` fixed it. Written up as `engineering/testing` Skill entry #10 (pushed to
`lis-engineering`).

Verified end-to-end: `pnpm --filter api test:e2e` 140/140 (138 baseline + 2: a dedicated-patient
two-order prior-result scenario proving order2 correctly surfaces order1's finalized result as its
own prior, and a 404 case for an unknown ordered-test id); repo-wide `typecheck`/`lint`/`build`
green (including a real `next build`/`nest build`); `openapi.json`/`packages/sdk/src/schema.ts`
regenerated for the widened domain schema and the new route. Real headless-browser verification
(`web-verify` Skill): a `verifier`-roled session verified a 4-analyte panel keyboard-only (Tab+Enter,
a realistic ~900ms human read-pause per row) in **5.88s**, well under the AC's 30-second target; a
`technologist`-roled session rendered zero Verify controls anywhere on the page; prior-result context
and verifier identity/timestamp both displayed correctly; dark mode confirmed; zero console/page
errors across every session driven. `#116` auto-closed via PR #328's bare `Closes #116` line.

**FEAT-015 (#24) is now fully implemented — all four named tasks (TASK-054/055/056/057) merged.**
See this file's own top-level status line for the feature-level close-out.

§10's open questions were resolved by the human as follows:
Q1: **prior result only, no computed delta** — show the patient's previous result for the same
analyte during verification (a small new backend query); no delta computation, since nothing like
that exists anywhere in this repo yet. "QC" context is not a decision point — it is fully unbuildable
today (finding #2: zero QC data model exists anywhere, a separate unstarted M5 feature) and is out of
this task's scope unconditionally. Q2: **additive to the existing TASK-052 results grid**, not a
standalone cross-patient queue — needs zero new backend query surface beyond the small prior-result
lookup from Q1, and matches this feature's own shipped, per-order shape so far. Q3: **hide the
"Verify" control from technologist-roled sessions** — this repo's first frontend role-visibility
check, avoiding a control that always fails for the wrong-roled user. Q4: **yes, show verifier
identity and timestamp** — widen `observationSchema` to expose the already-existing
`verifierUserId`/`verifiedAt` columns. Q5 (timing verification for the "under 30 seconds" AC): an
informal, manual timing check during this task's own `web-verify` pass, not a new scripted/automated
timing harness — matches this repo's existing "boot the real thing" verification discipline rather
than inventing new test infrastructure for a single UX claim.
Date: 2026-08-06    Backlog ID: FEAT-015 (#24) / TASK-057 (#116)

## 1. Goal

TASK-056 (finalization block) is merged (PR #324/#325, `6b9488f`/`832e39b`), closing #115. FEAT-015's
next and final named task is **TASK-057 — verification UI** (#116). Its one dependency, TASK-055
(verification action), is merged. Its literal AC: "A verifier can review and release a panel in under
30 seconds." Its "Expected output": "Verification screen."

The task's own title names three context ingredients ("delta," "QC," "prior context") plus a UX
shape ("verify+next"). This proposal's research (conducted in parallel with TASK-056's own
implementation) checked each directly against what exists in this codebase today, not assumed from
the title.

**Real, load-bearing finding #1 — "delta" has no supporting computation anywhere in this codebase.**
A repo-wide grep for delta/percent-change/trend-comparison logic in `packages/db`, `packages/domain`,
and `apps/api` returns zero hits outside test-harness prose and the schema comment describing the
column itself. `observation.previousObservationId` (`packages/db/src/schema/observation.ts:91`,
"delta/trend chain") exists as a real, migrated column — but is **never set by any INSERT or UPDATE
in any business code path**, confirmed by grep. `domain/result-verification` Skill entry #6's "not
yet built by any task" is independently reconfirmed here, unchanged by TASK-054/055/056 shipping
since that entry was written.

**Real, load-bearing finding #2 — "QC" has no supporting data model anywhere in this codebase; it
names a separate, unstarted, two-features-away milestone of work.** `github/issues/features/
FEAT-018-qc-materials-results-as-observations.md` ("QC materials & results as Observations," M5,
`status: Not Started`, `dependencies: [FEAT-016]` — itself Not Started) is the feature that would
create a QC data model at all. Its own Required Skill, `domain/qc-westgard`, does not exist. A
repo-wide grep for `qc`/`quality control`/`control material`/`controlLot` across `packages/db`,
`packages/domain`, and `apps/api` returns **zero hits**. "QC context" cannot be literally built into
this screen today under any reading — there is nothing to query. This finding is not a decision
point; it is unconditionally out of scope.

**Real, load-bearing finding #3 — "prior context," read narrowly as "the patient's previous result
for this analyte, no comparison computed," is a genuinely distinct, smaller gap than delta/QC, and
was the human's chosen scope (§10 Q1).** `GET /v1/ordered-tests/:id/results` (TASK-051's `list()`) is
scoped strictly to one ordered test's own observations; `GET /v1/orders` (TASK-040's `search()`)
never joins into `observation`. No route anywhere in `apps/api` joins by `(patientId, analyteId)`
ordered by time across a patient's multiple orders. This is real, small, new backend work: a query
joining `order` → `ordered_test` → `observation`, filtered by the current observation's own
`analyteId` and the order's `patientId`, ordered by `producedAt`/`createdAt` descending, capped at a
small N (e.g. 1-3 most recent prior results) — technically a single indexed join, not a large lift.

**Real, load-bearing finding #4 — TASK-052's results grid already built the exact "verify+next" UX
shape this task's title names, for finalize; the pattern transfers but is not a copy-paste.**
`results-grid.tsx`'s `handleKeyDown` (Enter key) calls `finalizeResult()`, then `focusNextEnterable()`
scans forward for the next enterable row and focuses it via the `inputRefs` ref map. A verify+next
flow needs an analogous `isVerifiable(row)` predicate (`observationStatus === 'preliminary'` and the
caller holding the `verify` capability) and a new `verifyResult()` Server Action calling TASK-055's
already-shipped `POST .../verify`, then a `focusNextVerifiable` scan reusing the same index-walk. The
row-cell markup itself needs new UI (a verify action is a button/keyboard shortcut, not a text field)
— only the focus-management *mechanism* transfers directly.

**Real, load-bearing finding #5 — no existing endpoint could support a standalone cross-patient
verification queue; the additive-to-existing-grid reading (the human's chosen scope, §10 Q2) needs no
new backend query surface beyond finding #3's small prior-result lookup.** `GET /v1/orders`'s
`search()` has no filter on `ordered_test.status` and no join to `observation.status`/
`observation.flags` at all — there is no way today to ask the API "which panels, across which
patients, have a finalized-but-unverified analyte." Building that would be real, non-trivial new
backend scope, well beyond a 1-day task. By contrast, `GET /v1/ordered-tests/:id/results` already
returns every observation's current `status`, including `'preliminary'` — exactly what a verify
affordance needs to decide visibility, with zero new backend surface beyond the prior-result query.
This also matches TASK-055/056's own shipped shape (both per-analyte/per-ordered-test, never
cross-patient), and `results-grid.tsx`'s own existing code comment (`// No new UI treatment for
'verified' is added here -- that's TASK-057's own scope`) already anticipates the verified-row
treatment landing inside this same grid.

**Real, load-bearing finding #6 — `apps/web` already carries the session data a role-gated UI would
need, but has never once used it for a UI-visibility decision; TASK-057 (per the human's chosen scope,
§10 Q3) is the first frontend consumer of role/capability.** `apps/web/auth/session.ts`'s
`SessionPayload` already includes `roles: string[]` (raw Keycloak realm roles), populated at
callback time and readable server-side. A repo-wide grep confirms **zero existing usage** of
`session.roles` anywhere in `apps/web` for a UI-gating decision — every write path built so far
(`enter_result`) is granted to both seeded roles, so no screen has ever needed to branch UI by role
before. `verify` is verifier-only (TASK-055), making this the first case that needs it. Separately,
`observationSchema` (`packages/domain/src/observation.ts`) still does not expose
`verifierUserId`/`verifiedAt` (`domain/result-verification` Skill entry #7) — the human's chosen scope
(§10 Q4) widens it to show who verified a result and when.

## 2. Affected files

- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` (extend) — a "Verify" affordance per row
  where `observationStatus === 'preliminary'` AND the session holds the `verifier` role (§10 Q3); a
  `'verified'` status treatment in the existing status column (currently renders nothing for
  `'verified'`, per the file's own TASK-055 comment); an `isVerifiable`/`focusNextVerifiable` pair
  mirroring `isEnterable`/`focusNextEnterable` (finding #4); a small prior-result display per row
  (finding #3, §10 Q1); a verifier/timestamp display once available (§10 Q4).
- `apps/web/app/(app)/orders/[id]/results/actions.ts` (extend) — a new `verifyResult()` Server Action
  calling `POST /v1/ordered-tests/{id}/results/{analyteId}/verify` (already shipped, TASK-055), same
  shape as `finalizeResult()`.
- `apps/web/app/(app)/orders/[id]/results/page.tsx` (extend) — read the caller's session role and pass
  it down to the grid (§10 Q3), and fetch the new prior-result data alongside the existing results
  fetch (§10 Q1).
- `apps/web/auth/*` — a new, small frontend capability-mapping helper (this repo's first) exposing
  whether the current session holds the `verifier` role, per §10 Q3.
- `packages/domain/src/observation.ts` — `observationSchema` widens to add `verifierUserId`/
  `verifiedAt` (§10 Q4) — both already-existing, nullable DB columns, additive, not a migration.
- `apps/api/src/observation/observation.controller.ts` — a new small read path (or an extension of the
  existing `list()`) for the prior-result query (§10 Q1/finding #3): join `order` → `ordered_test` →
  `observation` by `(patientId, analyteId)`, ordered by time, capped at a small N.
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` — regenerate for the widened domain schema and
  the new/extended read path.

**Not affected under this scope:**
- `apps/api/src/observation/observation.controller.ts`'s `verify()` handler itself — this task's
  dependency to *call*, not to modify.
- Any QC-related table, route, or Skill — finding #2 confirms none exists to touch; unconditionally
  out of scope.
- Any delta/percent-change computation — finding #1, §10 Q1 explicitly excludes it.
- A standalone cross-patient verification queue endpoint — §10 Q2 explicitly excludes it.
- `db/migrations/*` — no reading of this task's approved scope requires a new migration.

## 3. Architecture consulted

- KB-14 Result Engine and Constitution Law #3/Law #5 — re-cited from the TASK-054/055/056 revisions;
  this screen is where a technologist/verifier will actually see TASK-056's 409 guard in practice,
  though rendering that error usefully is not itself required by this task's own narrow AC.
- `docs/plans/feat-015-verification-criticals.md`'s TASK-054/055/056 revisions (this file) — direct
  precedent for structure, and for TASK-056's real shipped 409 `detail` string shape, now available
  (TASK-056 merged after this proposal's own research began).
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` and `actions.ts` (TASK-052) — direct
  precedent for finding #4's verify+next mechanics and finding #5's "additive to an existing grid"
  reading.
- `apps/api/src/order/order.controller.ts`'s `search()` and `apps/api/src/observation/
  observation.controller.ts`'s `list()` — read for finding #3/#5's "no existing route supports this
  query" confirmations.
- `apps/web/auth/session.ts`, `get-session.ts` and `apps/api/src/auth/capabilities.ts` — read for
  finding #6's session-shape and `ROLE_CAPABILITIES` confirmations.
- `github/issues/features/FEAT-018-qc-materials-results-as-observations.md` and
  `FEAT-020-qc-gating-of-result-release.md` — read for finding #2's status/dependency confirmation.

## 4. Skills loaded

- `domain/result-verification` — entry #6 (delta/trend vs. amendment distinction, finding #1) and
  entry #7 (verifier identity not exposed by any read route, finding #6/§10 Q4).
- `domain/critical-values` — entry #6 (TASK-056's own dependency chain, context for what this screen
  may render once a technologist hits TASK-056's 409).
- `engineering/frontend-design` — entry #1 (`StatusPill`/`FLAG_META`, relevant to the new `'verified'`
  status treatment) and entry #5 (RSC-payload-retention gotcha — not obviously triggered by this
  additive, single-patient-page reading, since this screen already shows this patient's own data).
- `engineering/api-design` — entry #6 (only mutating actions are audited — `verifyResult()` is already
  audited server-side by TASK-055) and entry #11 (slash-verb convention, relevant to the new
  prior-result read path if it becomes its own route rather than a query param on `list()`).

## 5. Assumptions & autonomous decisions

- **The prior-result query returns only the same analyte's own most recent prior result(s), capped at
  a small N** — exact N (e.g. 1 vs. 3) is an implementation detail, not elevated to a §10 question.
- **The frontend capability-mapping helper (§10 Q3) checks `session.roles.includes('verifier')`
  directly** — this repo's `apps/api` capability model (`ROLE_CAPABILITIES`) is not duplicated
  frontend-side as a general system; this task adds only the one specific check it needs, following
  the same "don't build ahead of a real need" precedent as every prior task in this feature.
- **`amendmentOf`/`previousObservationId` are not conflated** (per `domain/result-verification` entry
  #6) — the prior-result query joins `observation` by `(patientId, analyteId)` directly, never via the
  unused `previousObservationId` column.

## 6. Risks

- **The AC's own 30-second target is verified only informally** (§10 Q5) — a real manual timing check
  during this task's own `web-verify` pass, not a scripted/repeatable test. If this ever regresses,
  nothing in CI would catch it; acceptable for now, matching this repo's existing verification
  discipline for UX-shape claims elsewhere (e.g. TASK-052's own "without touching the mouse" AC).
- **The new frontend role-visibility helper (§10 Q3) is this repo's first of its kind** — a reviewer
  should confirm it fails closed (hides the control) rather than open if `session.roles` is ever
  malformed or missing, matching this repo's general security posture.
- **Only 4 of 14 seeded chemistry analytes have any critical row** (re-cited from `domain/
  critical-values` entry #3) — this task's own manual/e2e verification of the TASK-056 interaction
  (a verifier resolving a 409-blocking critical) is bounded by the same real data limit as TASK-054's.

## 7. Acceptance criteria

- [ ] A `verifier`-roled caller sees and can act on a "Verify" affordance for a `'preliminary'`
  observation in the existing `/orders/[id]/results` grid; a `technologist`-roled caller does not see
  the control at all (§10 Q3).
- [ ] Calling verify from the UI transitions the row to a `'verified'` state, showing verifier identity
  and timestamp (§10 Q4), without a full page reload.
- [ ] After verifying one row, focus moves to the next verifiable row without a mouse action
  (verify+next, finding #4).
- [ ] The patient's prior result for the same analyte is visible during verification (§10 Q1) — no
  computed delta, no QC context (both out of scope).
- [ ] A real, informal manual timing check (§10 Q5) supports the "under 30 seconds" claim for a
  small multi-analyte panel.

## 8. Testing plan

1. `pnpm --filter api test:e2e` full suite re-run before any change, confirming the current 138-test
   baseline (per TASK-056's own revision) is the correct starting point.
2. New e2e case(s) for the prior-result read path (finding #3): a patient with two orders for the same
   analyte, asserting the second order's result correctly surfaces the first as "prior."
3. `pnpm --filter @lis/domain typecheck`/build for the `observationSchema` widening (§10 Q4); confirm
   `apps/api/test/observation.e2e-spec.ts`'s existing assertions are unaffected (additive field).
4. Frontend: a real headless-browser check (`web-verify` Skill) exercising the actual verify+next flow
   as both a `verifier` and a `technologist` session, confirming the control's visibility differs
   correctly between them, and performing the informal timing check (§10 Q5).
5. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive under this approved scope: new grid cells/status treatment, one new Server Action, one new
small backend read path (prior-result query), one small domain-schema widening, one new frontend
role-visibility helper — no migration. Rollback is reverting the PR. This is FEAT-015's last named
task; once merged, FEAT-015 (#24) itself is ready for its own manual-comment close (bare `Closes`
lines don't auto-close a parent feature issue, the same recurring gotcha as `#99`/`#265`/`#74`/`#93`/
`#94`/`#105`/`#107`/`#112` before it).

## 10. Open questions — resolved 2026-08-06 via the native options-prompt

1. **Delta/prior-context scope.** **Resolved: prior result only, no computed delta.** "QC" is not a
   decision point — unconditionally out of scope (finding #2).
2. **Screen surface.** **Resolved: additive to the existing TASK-052 results grid**, not a standalone
   cross-patient verification queue.
3. **Role visibility.** **Resolved: hide the "Verify" control from technologist-roled sessions** —
   this repo's first frontend role-visibility check.
4. **Verifier identity display.** **Resolved: yes** — widen `observationSchema` to expose
   `verifierUserId`/`verifiedAt`.
5. **Timing verification for the "under 30 seconds" AC.** **Resolved: an informal, manual timing
   check during this task's own `web-verify` pass**, not a new scripted/automated timing harness.
