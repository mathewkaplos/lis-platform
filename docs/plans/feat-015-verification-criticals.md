# Implementation Proposal: FEAT-015 Verification & criticals
Status: **IMPLEMENTED** — merged PR #320 (`f311a2e`), closing #113. TASK-055 (verification action +
append-only versioning) is FEAT-015's next task, to be specified as a revision to this same file.
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
