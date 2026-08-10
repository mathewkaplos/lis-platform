# Implementation Proposal: FEAT-043 AI cumulative summaries
Status: APPROVED

**Approved 2026-08-10** via the native options-prompt (approved as drafted).
ADR: none — the provider approach (deterministic, no real LLM vendor) is the same decision the
human already made directly for FEAT-042 (§10 Q1 there), inherited here rather than re-asked: it is
if anything a clearer fit for this feature's own AC ("no unsupported claims") than it was for
FEAT-042, since deterministic prose generated only from real computed numbers cannot hallucinate by
construction. Flagged as an explicit assumption (§5), not silently assumed.
Date: 2026-08-10    Backlog ID: FEAT-043 (#52)

## 1. Goal
Literal AC (issue #52): "A generated summary correctly reflects the underlying structured data with
no unsupported claims."

Real, existing integration point (found by reading the actual code, same discipline FEAT-042
followed): FEAT-033's `CumulativeReportController`/`assembleCumulativeReport`
(`apps/api/src/report/cumulative-report*.ts`) already assembles a patient's full verified-result
history for one analyte — every entry's value/unit/flags/reference-range/critical-status/date, in
chronological order — and streams it as a PDF. **No web UI exists anywhere for this feature at all**
(grepped `apps/web` for `cumulative` — zero hits): it shipped API/PDF-only in FEAT-033 and stayed
that way. This feature adds a second, sibling read route on the same controller —
`GET .../summary` — that turns the same already-assembled data into a short prose summary via
`InferenceGatewayService`, matching FEAT-033's own precedent of being API-only. Adding a web viewer
for cumulative reports is a real, separate, pre-existing gap this feature doesn't create and isn't
obligated to close.

## 2. Affected files
- `apps/api/src/ai/providers/template-provider.ts` — a second capability,
  `summarization.cumulative-trend` (KB-45's own "summarisation" vocabulary, distinct from
  FEAT-042's "narrative-drafting" family). Deterministic: counts results, computes the date range,
  counts flagged/critical entries, and — only when every entry's `value` parses as a finite number —
  states the first/last value and a trend direction (up/down/stable). Never claims a trend for
  non-numeric (coded/text) analyte histories; states only what's true by construction (this is the
  literal mechanism by which "no unsupported claims" is satisfied, not a hope).
- `apps/api/src/report/cumulative-report.controller.ts` — new `GET :analyteId/summary` route.
  Reuses `assembleCumulativeReport` unchanged; pre-shapes a minimal `entries` array (only
  `value`/`unit`/`flags`/`isCritical`/`producedAt` — never `observationId`/`verifierUserId`, neither
  of which the summary needs) before calling the gateway, then allowlists `['analyteDisplay',
  'entries']` wholesale via the existing deny-by-default mechanism (FEAT-041) — belt-and-suspenders,
  not either/or. No `@Audit()`, no new capability — matches `generate()`'s own already-established
  "unmutating read" precedent on this exact controller (its own header comment).
  Deliberately does **not** use `TenantContextInterceptor`/`@DbTx()` for the same reason FEAT-042's
  `draftNarrative()` doesn't — nesting `InferenceGatewayService.invoke()`'s own transaction inside an
  already-open one deadlocks under `DB_POOL_MAX=1` (`engineering/database-design` entry #14, hit for
  real in FEAT-042, now the established fix pattern this route follows from the start rather than
  rediscovering).
- `apps/api/src/observation/observation.module.ts`-equivalent: `apps/api/src/report/report.module.ts`
  needs `AiModule` imported (mirrors FEAT-042's own `ObservationModule` change).
- `apps/api/test/cumulative-summary.e2e-spec.ts` (new) — real-Postgres e2e: a numeric-analyte
  history produces a trend-describing summary with the correct direction; a history with zero
  verified results produces a fixed "no verified results yet" summary with no fabricated trend; the
  underlying audit row's minimized context contains only `analyteDisplay`/`entries` (with each entry
  already stripped to its five safe fields), never patient name/MRN/DOB or `verifierUserId`.
- `~/work/lis-engineering/skills/ai/governed-inference/SKILL.md` — second capability entry, and the
  "pre-shape an array's own elements before allowlisting the array as a whole" pattern this feature
  establishes (phi-minimization.ts's dot-path allowlist doesn't recurse into array elements —
  documented so a future capability with the same shape doesn't rediscover it).

## 3. Architecture consulted
- KB-45 (AI Architecture) — "summarisation (cumulative summaries...)" named explicitly as one of
  the platform's advisory AI capabilities; hallucination controls ("grounding in the structured
  source, constrained outputs") are the literal design constraint this feature's deterministic
  approach satisfies by construction, not by review.
- KB-43 (Operational Reporting) — "cumulative/clinical reports are assembled from structured
  Observations... trends fall out of the structured model" — the same re-projection FEAT-033 already
  built, reused unchanged here.
- ADR-0037 (in-process AI module) — unchanged, no new deployment question.
- `engineering/database-design` entry #14 — the nested-transaction deadlock this route's own
  structure avoids from the start (FEAT-042 found it the hard way; this proposal applies the fix
  pattern proactively).
- FEAT-033's own Implementation Proposal — verified-only (`status = 'verified'`), snapshot values
  (never re-resolved against live ranges), the exact data this feature summarizes without touching.

## 4. Skills loaded
- `ai/governed-inference` — per-capability template dispatch (FEAT-042's own precedent), extended
  here to a second capability.
- `engineering/database-design` (entry #14, directly applied).
- `engineering/api-design` (entry #6 — only mutating actions are audited; this route makes no
  write, matching `generate()`'s own sibling precedent on the same controller).
- `engineering/testing` (entry #1 — real-Postgres e2e, not mocked).

## 5. Assumptions & autonomous decisions
- **Deterministic provider, not a real LLM** — inherited from FEAT-042's own decision (see header),
  and arguably a clearer fit here: a trend/count summary computed directly from real numbers cannot
  state anything the data doesn't support, which is this feature's own literal AC. If reviewed and
  rejected, flag it back — this is stated as an assumption specifically so it's visible to override,
  not buried.
- **No web UI.** Matches FEAT-033's own existing, unchanged precedent (API/PDF-only) — building a
  cumulative-report viewer page is a separate, real gap, not created or required by this feature.
- **No disposition tracking (no `notesAiOriginated`-style columns).** Unlike FEAT-042, this summary
  is never incorporated into a new persisted clinical field a technologist accepts/edits/rejects —
  it's a live, regenerated-on-every-request narrative over data that is *already* verified. KB-11's
  "accept/edit/reject" disposition concept applies to a suggestion that becomes part of a saved
  record; this one never does, so there's nothing to persist a disposition against.
- **No new capability/RBAC gate**, matching `generate()`'s own sibling route on this controller —
  any authenticated user who can already generate the PDF can already see everything this endpoint
  summarizes.
- **A zero-history analyte gets a fixed, honest "no verified results yet" summary** — still routed
  through the real gateway/template (for a uniform mental model and a real audit row), not
  special-cased in the controller.

## 6. Risks
- The deterministic trend logic (first-vs-last value comparison) is a simple heuristic — it doesn't
  detect a mid-series spike-then-recovery, only net direction. Stated plainly as a known limitation
  in the new Skill entry, not hidden; a richer trend description is a real future enhancement, not
  silently promised here.
- Same "not yet lab-reviewed" caveat as FEAT-042's own template sentences — the phrasing conventions
  (how to describe a trend/flag count in clinical prose) follow common reporting style but haven't
  had a design-partner lab review.

## 7. Acceptance criteria
- [ ] `GET .../summary` returns a real, data-grounded summary for a numeric-analyte history with 2+
      verified results, correctly stating the trend direction.
- [ ] A history of exactly one verified result never claims a "trend" (nothing to compare).
- [ ] A zero-history analyte gets the fixed "no verified results yet" summary, not an error and not
      a fabricated claim.
- [ ] A non-numeric (coded/text) analyte history's summary states count/flags/dates only, never a
      numeric trend claim.
- [ ] The underlying `ai_inference.invoke` audit row's minimized context contains no patient
      name/MRN/DOB and no `observationId`/`verifierUserId` — proven directly, not assumed.
- [ ] Full `apps/api` unit + e2e suites and repo-wide typecheck/lint pass.

## 8. Testing plan
- Unit: `template-provider.spec.ts` extended — trend-direction correctness (up/down/stable/single-
  result/zero-result), non-numeric-history behavior.
- Integration/e2e (real Postgres): seed a real multi-result verified history via the actual
  draft→finalize→verify flow (not a direct DB insert — matching `peripheral-film.e2e-spec.ts`'s own
  "prove it against the real write path" standard), then call the summary route and assert on both
  the response and the underlying audit row's minimized content.

## 9. Rollback plan
New route only, no schema change, no existing route touched — a plain revert with no data
implications.

## 10. Questions requiring human approval
1. **Approve this proposal as a whole** (scope: a new read-only `GET .../summary` route on the
   existing `CumulativeReportController`, deterministic trend summary, no web UI, no new
   capability/schema)?
