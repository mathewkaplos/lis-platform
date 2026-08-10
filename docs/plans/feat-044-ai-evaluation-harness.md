# Implementation Proposal: FEAT-044 AI evaluation harness
Status: **IMPLEMENTED** — merged PR #480 (`9b6e680`), closing #53.

**Approved 2026-08-10** via the native options-prompt (approved as drafted).
ADR: none — the harness's shape (plain Vitest suite, no new CI step, tests `TemplateProvider`
directly rather than the full gateway) is a scoping/engineering choice within this proposal's own
authority, not a load-bearing architectural decision or a product/vendor commitment (contrast
FEAT-042's real ADR-worthy provider question). Reasoning shown in §5.
Date: 2026-08-10    Backlog ID: FEAT-044 (#53)

## 1. Goal
Literal AC (issue #53): "A regression suite of known-good/known-bad prompts runs in CI and flags
drift or unsafe output."

KB-45's own Open Questions section lists "Evaluation/validation framework — the standard each
capability must pass before release" as explicitly *unresolved* in the architecture doc itself — no
prescribed shape exists to follow, unlike FEAT-042/043 where a real, existing integration point
(FEAT-024's `notes` field; FEAT-033's cumulative report) was found by reading the actual code. This
proposal designs the shape directly, scoped to what actually exists today: two real capabilities
(`narrative-drafting.peripheral-film-morphology`, `summarization.cumulative-trend`), both served by
the same deterministic `TemplateProvider` (FEAT-042/043, no real LLM vendor).

**What this harness is not duplicating:** `template-provider.spec.ts` already exact-match-tests every
known input → known output pair (all 16 morphology combinations; trend-direction correctness). This
proposal's own distinguishing job, per the issue's literal framing, is different: **output-safety and
grounding invariants** that hold across *every* known-good case (not exact-match), plus explicit
**known-bad/adversarial input** cases proving the provider degrades safely rather than crashing or
producing something unbounded/unsafe. Exact-match correctness and safety/grounding invariants are
two different kinds of check; this proposal adds the second, not a copy of the first.

## 2. Affected files
- `apps/api/src/ai/evaluation.spec.ts` (new) — the regression suite itself. Two corpora:
  - **Known-good** (every real capability's own realistic input shape): asserts *invariants* that
    must hold regardless of the specific input — non-empty, a sane length ceiling (catches a
    runaway/malformed generation), the output actually names the analyte it's about (grounding —
    proves the text isn't generic boilerplate unrelated to its own input), and never contains a raw
    interpolation artifact (`"undefined"`, `"NaN"`, `"[object Object]"` — a real, mechanical class of
    bug for string-interpolation-based generation, not a hypothetical one).
  - **Known-bad** (malformed/edge-case input fed directly to `TemplateProvider.complete()`, bypassing
    the controller's own request validation — this harness evaluates the *AI layer itself*, not the
    already-separately-tested API validation layer): `NaN`/`Infinity` numeric values in a cumulative
    entry, a 10,000-entry history (no hang/crash), an `analyteDisplay` containing script-like content
    (`<script>...`) — proves the provider itself never throws or produces something structurally
    unbounded; front-end output-escaping (React's own default) is a separate, already-existing
    safety layer this harness doesn't re-prove — an unrecognized capability string, and an empty/
    missing `minimizedContext`.
- No production code changes — this is a test-only feature, per its own literal AC ("a regression
  suite... runs in CI").
- `~/work/lis-engineering/skills/ai/governed-inference/SKILL.md` — a short pointer to this harness
  and the invariant-vs-exact-match distinction, so a future capability's own proposal knows to add
  its known-good/known-bad cases here rather than re-deriving the pattern.

## 3. Architecture consulted
- KB-45 (AI Architecture) — "capabilities are evaluated against curated datasets before and during
  use," "hallucination controls (grounding in the structured source, constrained outputs, human
  review)." This proposal implements the grounding/constrained-output half directly; "before and
  during use" and human-review are already covered elsewhere (CI runs this on every PR; every real
  capability already requires human review via its own consuming feature's UI/verification gate).
- `ai/governed-inference` Skill — the two real capabilities' own input/output shapes, sourced
  directly rather than re-derived.
- `engineering/testing` entry #1 — real-Postgres checks are `tsx` scripts; this harness has **no**
  Postgres dependency (`TemplateProvider` is a pure function of its input), so that convention's own
  reasoning doesn't apply here — a plain Vitest suite is the right fit, not a script needing its own
  new CI wiring (§5).

## 4. Skills loaded
- `ai/governed-inference` (the two real capabilities this harness evaluates).
- `engineering/testing` (entry #1, to confirm the tsx-script convention doesn't apply here and why).

## 5. Assumptions & autonomous decisions
- **Plain Vitest suite, not a new tsx script or new CI step.** `pnpm test` (unit) already runs in
  CI's `build-and-test` job and already "flags" a failure the same way any other spec file's failure
  does — the literal AC ("runs in CI and flags drift or unsafe output") is satisfied with zero new
  CI wiring. A dedicated script (matching `rls-check`/`golden-check`'s own convention) is the right
  shape for a *real-Postgres* proof: this harness has no such dependency, so following that
  convention here would add ceremony (a new `package.json` script, a new `pr.yml` step) with no
  corresponding benefit.
- **Tests `TemplateProvider` directly, not the full `InferenceGatewayService.invoke()` pipeline.**
  The plumbing (PHI minimization, audit-write correctness) is already covered by `phi-minimization
  .spec.ts`, `inference-gateway.service.spec.ts`, and each feature's own real-Postgres e2e spec —
  re-proving it here would duplicate existing coverage, not add new coverage, and would reintroduce
  a Postgres dependency this harness doesn't otherwise need. "The AI layer" this feature evaluates is
  the provider's own output, which is exactly what direct testing proves.
- **Known-bad inputs are constructed directly (TypeScript object literals), not sourced from any
  external "prompt injection corpus."** No such corpus exists in this repo, and neither capability
  takes free-text user input today (morphology is a validated grade enum; cumulative-trend is
  server-computed structured data) — the realistic "bad input" surface for *this* milestone's actual
  capabilities is malformed/edge-case structured data, not adversarial natural-language prompts. A
  future capability that does accept free-text user input (if one is ever built) would need its own,
  different known-bad corpus in this same file — noted as a real limitation, not silently assumed
  covered.

## 6. Risks
- This harness proves today's deterministic provider is safe/grounded by construction — it does
  **not** yet prove anything about hallucination for a real model, since none is integrated. The
  moment a real LLM provider is ever added (a future ADR, per ADR-0037/FEAT-042 §10 Q1's own stated
  reversal condition), this harness's "grounding" checks (does the output name the analyte, is it
  bounded in length) become meaningfully harder to guarantee and worth substantially expanding —
  flagged explicitly as future work, not implied to already be solved for that case.
- A regression suite is only as good as its corpus. Two capabilities' worth of known-good/known-bad
  cases is a real starting point, not exhaustive — the Skill entry this proposal adds explicitly asks
  future capabilities to extend this same file, so the corpus grows with real capabilities rather
  than being invented speculatively now for capabilities that don't exist yet.

## 7. Acceptance criteria
- [ ] Every known-good case (both capabilities, a representative sample of realistic inputs) passes
      all four invariants: non-empty, bounded length, names the analyte, no interpolation artifact.
- [ ] Every known-bad case completes without throwing and without producing unbounded output.
- [ ] The suite runs as part of the existing `pnpm test` (unit) command — no new CI step.
- [ ] Repo-wide typecheck/lint pass; no production code changed.

## 8. Testing plan
This *is* the testing plan — the feature itself is a test suite. No further real-Postgres e2e is
needed (§5's own reasoning: `TemplateProvider` has no DB dependency, and the plumbing around it is
already e2e-covered by FEAT-042/043's own specs).

## 9. Rollback plan
A new test file only — a plain revert with zero runtime/data implications.

## 10. Questions requiring human approval
1. **Approve this proposal as a whole** (scope: a new `apps/api/src/ai/evaluation.spec.ts` testing
   `TemplateProvider` directly for output-safety/grounding invariants across known-good cases plus
   explicit known-bad/adversarial cases, no new CI step, no production code change)?
