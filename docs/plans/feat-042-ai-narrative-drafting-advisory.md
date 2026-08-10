# Implementation Proposal: FEAT-042 AI narrative drafting (advisory)
Status: APPROVED

**Approved 2026-08-10** via the native options-prompt (approved as drafted; §10 Q1's provider
choice was itself already resolved via a prior options-prompt before this proposal was finalized).
ADR: none — the one genuinely load-bearing decision (provider approach) was resolved directly by
the human via the native options-prompt before this proposal was finalized (§10 Q1, decided:
deterministic template provider, no real LLM vendor). The `observation` schema addition (§2) is a
narrow, mechanical extension of KB-11's already-established AI-disposition concept, not a new
architectural choice needing its own trade-off record — same judgment FEAT-033's own proposal made
for its two non-architectural open questions.
Date: 2026-08-10    Backlog ID: FEAT-042 (#51)

## 1. Goal
Literal AC (issue #51): "An AI-drafted narrative is clearly labeled as AI-originated and requires
explicit human verification before release."

This is the first real consumer of FEAT-041's `InferenceGatewayService`. The concrete, real target
— found by reading the actual code, not inferring from the issue's generic title — is FEAT-024's
existing `observation.notes` field on `ordinal`-dataType (morphology) results: a technologist
already grades a peripheral-film analyte (`none`/`1+`/`2+`/`3+`, `morphologyGradeSchema`) and
optionally types a free-text `notes` narrative alongside it (`observation-write.service.ts:301-316`
— "narrative *in addition* to the graded value, never a substitute"). Today that narrative is
always hand-typed from scratch. This feature adds a "Draft with AI" action that proposes a starter
narrative from the structured grade, which the technologist reviews, edits or accepts, before
finalizing — reusing the *existing* draft/finalize/verification flow unchanged (KB-45's own
"reuses the same verification gate that governs all result release" invariant).

Real seeded surface to build against (`db/seed/haematology-catalog.sql`, FEAT-024/ADR-0025): 4
`ordinal` analytes on the `PBS` (Peripheral Blood Smear) test — Anisocytosis, Poikilocytosis,
Polychromasia, Platelet Estimate. WBC morphology is out of scope (deferred by FEAT-024's own
proposal — "larger, more varied vocabulary, no partner data to seed it responsibly"); this feature
doesn't reopen that deferral.

## 2. Affected files
- `apps/api/src/ai/providers/template-provider.ts` (new) — `TemplateProvider implements
  InferenceProvider`. Deterministic, rule-based: a small per-`capability` template registry,
  starting with exactly one entry, `narrative-drafting.peripheral-film-morphology`, composing a
  short standard-phrasing sentence from `{ analyteCode, grade }` (4 analytes × 4 grades = 16 fixed
  sentences, real hematology reporting language, not placeholder text). Any other `capability`
  falls back to `StubProvider`'s own canned message — no template exists for it yet, same
  "not yet covered" honesty this repo's Skills already practice.
- `apps/api/src/ai/provider-registry.ts` — add `template` to `PROVIDERS`; the default provider for
  this milestone becomes `AI_PROVIDER=template` (env default changes from `'stub'` to `'template'`
  — see §5). `stub` stays registered and selectable, unchanged.
- `apps/api/src/observation/observation.controller.ts` (or a new file in the same module, following
  existing route-per-concern layout) — new `POST /v1/ordered-tests/:orderedTestId/results/
  :analyteId/draft-narrative`. Capability: reuses `enter_result` (the same capability that already
  gates morphology grading — no new capability, matching FEAT-041's own "no new capability" pattern
  and API-design entry #6's "only mutating, clinically significant actions are audited" — this
  route doesn't mutate anything itself, see §5). Reads the ordered_test/analyte's current draft
  grade, calls `InferenceGatewayService.invoke()`, returns `{ narrative: string }`. No DB write of
  its own — nothing is persisted until the technologist actually finalizes/drafts through the
  *existing* endpoints with the (possibly edited) text, same as any hand-typed note today.
- `packages/db/src/schema/observation.ts` — two new nullable columns: `notesAiOriginated: boolean
  not null default false`, `notesAiDisposition: text` (CHECK constrained to `('accepted','edited')`
  when `notesAiOriginated` is true, `NULL` otherwise — same `check(...)` convention every other
  `observation` data-type constraint already uses). A new migration
  (`db/migrations/0035_*.sql`, drizzle-kit generated).
- `apps/api/src/observation/observation-write.service.ts` (`upsertObservation`, the one write path
  every ordinal caller already goes through) — accept and persist `notesAiOriginated`/
  `notesAiDisposition` alongside `notes`, following the exact `params.body.dataType === 'ordinal'`
  branch shape already there (line 301-316).
- `packages/domain/src/observation.ts` — extend the `ordinal` branch of `resultEntrySchema` with
  optional `notesAiOriginated`/`notesAiDisposition` fields (Zod), the one schema that already drives
  validation + OpenAPI docs (`engineering/api-design` entry #1).
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx` — a "Draft with AI" button next to the
  `notes` textarea for `ordinal` rows (only shown once a grade is selected — nothing to draft
  against otherwise), calling the new endpoint via a server action. Populates `notes` with the
  returned narrative and a client-side "AI draft — review before finalizing" indicator (`Badge`,
  matching `packages/ui`'s existing pattern, per `engineering/frontend-design` — no new primitive).
  Any keystroke in the textarea after a draft is inserted flips the pending disposition from
  `accepted` to `edited` client-side; both are sent through unchanged on draft/finalize.
- `apps/web/app/(app)/orders/[id]/results/actions.ts` — `draftMorphologyResult`/
  `finalizeMorphologyResult` server actions gain the two new optional fields, passed straight
  through to the existing API calls.
- `apps/api/test/peripheral-film-narrative.e2e-spec.ts` (new) — real-Postgres e2e: draft-narrative
  returns real template text for a known analyte/grade pair; the subsequent finalize call with that
  text (unedited) persists `notesAiOriginated: true, notesAiDisposition: 'accepted'`; finalizing
  with edited text persists `disposition: 'edited'`; finalizing with a hand-typed note (endpoint
  never called) persists `notesAiOriginated: false, notesAiDisposition: null`.
- `~/work/lis-engineering/skills/ai/governed-inference/SKILL.md` — first real capability entry
  (`narrative-drafting.peripheral-film-morphology`) and the per-capability template-registry pattern
  `TemplateProvider` establishes.
- `~/work/lis-engineering/skills/domain/haematology/SKILL.md` — the real template sentence library,
  its clinical sourcing, and the explicit "not yet lab-reviewed" flag (§6).

## 3. Architecture consulted
- KB-45 (AI Architecture) — advisory-only, human-in-the-loop via the *existing* verification gate
  (not a new one), labelled as AI-originated everywhere it appears, audited.
- KB-11 (Audit Logging) — "every AI suggestion and its human disposition (accept/edit/reject)" —
  the literal requirement `notesAiDisposition` implements. `reject` (the technologist discards the
  draft and types their own note without ever calling draft-narrative) leaves no trace in the final
  `notes` value, which is correct — there is nothing AI-originated left to label once rejected wholesale.
- ADR-0037 (in-process AI module) — `template-provider.ts` lives inside the same `apps/api/src/ai/`
  module FEAT-041 already established; no deployment-shape question reopened here.
- ADR-0033 (workflow engine's flat allowed-fields precedent) — `allowedContextFields` for this
  capability is `['analyteCode', 'grade']` only — no patient/order/specimen identifiers ever reach
  the provider or the audit log, enforced by `phi-minimization.ts`'s existing deny-by-default
  mechanism (FEAT-041, unchanged).
- FEAT-024's own Implementation Proposal / ADR-0025 — the exact `notes`-is-additive-not-substitute
  rule this feature must not violate; morphology grade stays the authoritative structured value
  (Constitution Law #1), the narrative is always secondary, human-reviewed prose.

## 4. Skills loaded
- `ai/governed-inference` — the gateway's own conventions (constructor-injected `db`, per-capability
  provider dispatch is new territory this feature establishes, documented back into the Skill per §2).
- `domain/haematology` (entries #2, #3 — morphology is `ordinal`, explicitly FEAT-024's own scope,
  not FEAT-023's differential; confirms this feature is extending the right, already-scoped surface).
- `engineering/frontend-design` (mandatory per `plan/SKILL.md` step 2 — this adds new `apps/web`
  surface). Entry #6 (function-valued props into Client Components) and entry #9 (route-group URL
  collisions) are the two most likely traps for a `results-grid.tsx` change; entry #7 (`flags` can
  hold more than one value) is a reminder to read the existing row-state shape fully before editing it.
- `engineering/api-design` (entry #6 — only mutating actions are audited; the new draft-narrative
  route makes no mutation itself, so its own `@Audit()` gating question is "does it need one at
  all" — resolved in §5: no, `InferenceGatewayService.invoke()` already audits the AI call itself;
  the *disposition* gets audited when the technologist's own existing finalize/draft call runs,
  which is already `@Audit()`-decorated).
- `engineering/database-design` (CHECK-constraint precedent for the new nullable-pair columns).

## 5. Assumptions & autonomous decisions
- **Provider: `TemplateProvider`, not a real LLM.** Decided directly by the human (§10 Q1, resolved
  before this proposal was finalized) — no new vendor/API key/cost commitment this feature. The
  16-sentence template library is real hematology-reporting language, sourced from standard
  morphology-grading phrasing, but is explicitly **not yet lab-reviewed** — flagged in the new
  Skill entry and in this proposal's own §6, same "real but unreviewed" pattern as the chemistry
  golden dataset (issue #171).
- **The draft-narrative route is not itself `@Audit()`-decorated.** It makes no database write — the
  AI call it triggers is already fully audited inside `InferenceGatewayService.invoke()`
  (`actorType: 'ai'`, unchanged from FEAT-041). The *human's disposition* of that draft becomes
  visible only through the existing `enter_result`/`verify` audit trail once the technologist
  actually finalizes — exactly matching `api-design` entry #6's "only mutating, clinically
  significant actions are audited" (a preview/draft-fetch is not one).
- **No new capability.** `draft-narrative` reuses `enter_result` — the same role (technologist) that
  can already grade and finalize a morphology result is the only one who should be able to ask for
  a draft of its narrative; no scenario needs "can draft but can't finalize" or vice versa.
- **Report-level "AI-assisted" labelling is explicitly out of scope.** Grepped `apps/api/src/report`
  for any existing rendering of `notes` at all — there is none; FEAT-024's morphology narrative
  isn't surfaced in a finalized report yet, a pre-existing gap this feature doesn't create and isn't
  the right place to fix. KB-45's "labelled... in the report" is satisfied everywhere notes *is*
  currently shown (the results-grid UI) and in the audit trail (`notesAiOriginated`/`disposition`
  persisted on the row, so a future report-rendering feature can pick it up with zero new plumbing).
- **`rejected` disposition is not a distinct persisted value.** If a technologist calls
  draft-narrative, dislikes the result, and types their own note instead (never touching the drafted
  text), the final `notes` value has no AI content in it at all — `notesAiOriginated` stays `false`.
  This is correct, not a gap: KB-11's "reject" case means the AI's suggestion left no trace in what
  was actually kept, so there is nothing to label.

## 6. Risks
- **Clinical accuracy of the 16 template sentences is not yet lab-reviewed.** They follow standard,
  widely-used hematology reporting phrasing (matching the *style* of real peripheral-film reports),
  but per this repo's own established discipline (issue #171's own unresolved chemistry sign-off),
  a design-partner lab review is a real prerequisite before this ships to any real patient workflow,
  not assumed satisfied by this proposal. Flagged explicitly, not silently shipped as "done."
- **A per-capability template registry is new territory** — FEAT-041 only proved the gateway with
  one generic stub. If a second, differently-shaped capability (FEAT-043's cumulative summaries)
  needs richer per-capability dispatch than a flat `Record<string, TemplateFn>`, that's a real
  design question for that feature's own proposal, not pre-solved here.
- **The 4-analyte/4-grade template library only covers exactly what's seeded today.** Adding a 5th
  morphology analyte later (e.g., if WBC morphology's own deferral is ever lifted) needs a
  corresponding template addition — not automatic, and not covered by any fallback beyond the
  generic stub message.

## 7. Acceptance criteria
- [ ] `POST .../draft-narrative` returns a real, grade-specific narrative for each of the 4 seeded
      morphology analytes at each of the 4 grades (16 combinations), never the generic stub message.
- [ ] The returned narrative is never persisted by the draft-narrative call itself — only the
      technologist's own subsequent draft/finalize call persists anything.
- [ ] Finalizing with the AI text unedited persists `notesAiOriginated: true, notesAiDisposition:
      'accepted'`; finalizing after editing it persists `disposition: 'edited'`; finalizing a
      hand-typed note (draft-narrative never called) persists `notesAiOriginated: false`.
- [ ] `allowedContextFields` for this capability never includes any patient/order/specimen
      identifier — proven by asserting the minimized context in the underlying `audit_event` row.
- [ ] The UI clearly marks an inserted draft as AI-originated before the technologist finalizes
      (KB-45's "labelled... in the UI").
- [ ] Full `apps/api` unit + e2e suites and repo-wide typecheck/lint pass.

## 8. Testing plan
- Unit: `template-provider.spec.ts` — all 16 analyte/grade combinations produce distinct, non-empty
  text; an unrecognized capability falls back to the stub message.
- Unit: `phi-minimization` already covers the allowlist mechanism generically (FEAT-041) — no new
  unit coverage needed there, only a real-Postgres assertion that this capability's own allowlist is
  actually narrow (below).
- Integration/e2e (real Postgres, `apps/api/test/peripheral-film-narrative.e2e-spec.ts`): draft →
  accept-unedited → finalize → disposition; draft → edit → finalize → disposition; hand-typed note,
  no draft call → no AI markers; the underlying `ai_inference.invoke` audit row's minimized context
  contains only `analyteCode`/`grade`, never `patientId`/`orderId`/etc.
- Manual: as a technologist, grade a PBS analyte in the real running app, click "Draft with AI",
  confirm the narrative appears with a visible AI-origin indicator, edit it, finalize, confirm the
  saved note is exactly the edited text (dark mode + keyboard-only pass, per this repo's own
  `/close` discipline).

## 9. Rollback plan
New route + two new nullable columns with a `DEFAULT false`/`NULL` — existing rows are unaffected,
and the columns can be dropped in a follow-up migration with no data loss for anything that never
used this feature. The route itself is additive; removing it (or reverting `AI_PROVIDER` to `stub`)
leaves the existing hand-typed-notes flow completely unaffected, since it was never touched.

## 10. Questions requiring human approval
1. **Provider approach — already resolved via the native options-prompt before this proposal was
   finalized:** deterministic `TemplateProvider`, no real LLM vendor this feature. Recorded here for
   traceability, not re-asked.
2. **Approve this proposal as a whole** (scope: FEAT-024's existing morphology `notes` field only,
   template-based drafting, new `notesAiOriginated`/`notesAiDisposition` columns, no report-level
   rendering change, no new capability)?
