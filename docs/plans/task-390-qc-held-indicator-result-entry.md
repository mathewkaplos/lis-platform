# Implementation Proposal: QC-held indicator on the result-entry screen
Status: **APPROVED**
ADR: none — consumes ADR-0021's already-accepted `panel_hold`/`reason` mechanism; no new architectural
decision is introduced by this task    Date: 2026-08-09    Backlog ID: #390

**Approved 2026-08-09**, same session — §10 Q1 resolved: recommended option chosen (link-only caption,
no inline rule code/severity). **Not yet implemented — no code written.**

Drafted during `/orient` session 27, immediately after M5's milestone check found #390 was now
materially cheaper than when it was filed (TASK-400/PR #401, merged session 26, already made the
backend emit exactly the signal this task needs). Recommended over kicking off any of M5's three
unstarted features (FEAT-022/024/025 — each still needs its own multi-step research → proposal →
ADR cycle with no ready task yet) per this session's Session Report §2.

## 1. Goal

Close lis-platform issue #390: a technologist finalizing a panel whose analyte has an unresolved,
rejection-severity `qc_rule_violation` sees only a generic held caption, with no indication that the
hold is QC-specific or any pointer to `/qc-violations` (TASK-070's existing list screen, folding in
#381) — they'd need to already know that screen exists.

**Root cause, confirmed by reading the current code, not assumed from the issue text alone:**
ADR-0021/TASK-400 (merged, PR #401) already made `FinalizationRollupInterceptor` throw
`PanelHoldException` with a body carrying `code: 'panel_hold'` **and** `reason: 'unacknowledged_critical'
| 'qc_violation'` for both post-commit hold branches. But `apps/web`'s consumption of that body never
kept up: `actions.ts`'s `PanelHoldProblem` interface (L56-61) declares only `code`, `detail`,
`heldObservation`, `heldCalculatedDependents` — `reason` is parsed by nothing and silently dropped.
`results-grid.tsx`'s held-caption rendering (L391-395) renders the same generic
`Saved — {state.heldMessage}` text (`heldMessage` = the free-text `detail` field) for both hold
flavors, with no branch and no link anywhere. #390's own gap is real, but the backend side of the fix
already shipped last session (see ADR-0021 Consequences: "Does not itself resolve issue #390 ... but
establishes the `panel_hold`/`reason` signal #390's own indicator would consume"); this proposal is
the frontend-only follow-up that consumes it.

**Scope is deliberately limited to the `qc_violation` reason.** #390's own filed text is specifically
about the QC-hold branch's 409 having no pointer to `/qc-violations`; the `unacknowledged_critical`
branch's own UI gap was already closed by TASK-400 (real value + informational caption), and its
actionable next step (verifying the earlier critical) is already on the same results grid via the
existing Verify affordance — no cross-page pointer is needed for that case. This task changes nothing
about the `unacknowledged_critical` caption.

## 2. Affected files

- `apps/web/app/(app)/orders/[id]/results/actions.ts`
  - `PanelHoldProblem` (L56-61): add `reason: 'unacknowledged_critical' | 'qc_violation'` (already
    present on the real API response per ADR-0021 Decision 1; simply never declared here).
  - `ResultActionOutcome` (L25-44): add `heldReason?: 'unacknowledged_critical' | 'qc_violation'`.
  - `finalizeResult()`'s held branch (L141-159): thread `problem.reason` through into the returned
    outcome's new `heldReason` field.
- `apps/web/app/(app)/orders/[id]/results/results-grid.tsx`
  - `RowState` (L57-71): add `heldReason: 'unacknowledged_critical' | 'qc_violation' | null`.
  - `handleKeyDown`'s held branch (L268-277): set `heldReason: outcome.heldReason ?? null` alongside
    the existing `heldMessage` assignment.
  - The held-caption cell (L391-395): branch on `state.heldReason === 'qc_violation'` — render the
    existing warning-colored caption text plus a `next/link` `<Link href="/qc-violations">` pointer
    (e.g. "Saved — held on a QC violation. See QC violations →"). The `unacknowledged_critical` case
    (and the `null`/legacy fallback) keeps today's exact caption unchanged.
- No backend, schema, ADR, or `packages/domain`/`packages/sdk` changes — `reason` is already on the
  wire (ADR-0021 Decision 1/2); this task only starts reading it on the frontend.
- `apps/api/test/qc-gate.e2e-spec.ts` — no change expected (TASK-400 already extended this file's
  body-shape assertions to cover `reason: 'qc_violation'` at the API level); confirm at implementation
  start rather than assume, since this proposal's own research didn't re-read that spec file in full.

## 3. Architecture consulted

- **ADR-0021** — the accepted mechanism this proposal consumes (`code`/`reason`/`heldObservation` on
  the panel-hold 409); its own Consequences section names this exact follow-up.
- **ADR-0019** — the QC gate (`FinalizationRollupInterceptor`'s QC-hold branch) whose 409 this task's
  new caption responds to; also the source of `resolve_qc`/`qa`-role scoping consulted below.
- `docs/plans/feat-020-qc-gating-of-result-release.md` §6 — names this exact usability gap explicitly
  ("this feature ships a real safety gate with no way for a QA user to discover why an analyte is
  stuck... short of a direct API call") as a known, accepted risk at FEAT-020's own approval time.
- `docs/plans/task-400-finalize-panel-hold-response.md` — the proposal that shipped the backend half;
  its own §10 Q2 explicitly deferred #390 as a separate, later task rather than bundling it.
- `apps/web/app/(app)/qc-violations/page.tsx` and `apps/api/src/qc-rule-violation/
  qc-rule-violation.controller.ts` L146-149 — confirmed the list route (`GET /v1/qc-rule-violations`)
  has **no capability gate** ("any authenticated tenant user may read", per that route's own header
  comment) — a technologist-roled session can reach and view `/qc-violations` today, even though only
  a `qa`-roled session can resolve a violation there (`resolve_qc`, gated separately). This makes
  linking a technologist there safe and useful (they can see what's blocking release and that it's
  tracked) even though they can't act on it directly.
- `engineering/frontend-design` Skill entry #5 (client-side `next/link` navigation leaves the previous
  page's RSC payload, including any PHI it fetched, in the DOM) — considered explicitly: `/qc-violations`
  is not a route whose entire design point is being provably PHI-free (unlike the specimen-label route
  entry #5 documents), so the entry's own carve-out applies — "ordinary navigation between pages that
  each already show their own legitimate data... is fine with client-side routing." A plain `next/link`
  `<Link>` is used, matching the existing precedent elsewhere in `apps/web` (`reception/page.tsx`,
  `patients/[id]/not-found.tsx`), not a forced full-page `<a>`.

## 4. Skills loaded

`domain/critical-values` (entry #8, the origin of #390/#400's shared "409 aftermath has no good UX"
family), `domain/qc-westgard` (entries #4/#9, the QC gate and its resolve lifecycle), `domain/
result-verification` (for the existing Verify-affordance precedent this task deliberately does not
duplicate for the critical case), `engineering/frontend-design` (entry #5, `next/link` PHI
consideration, addressed above).

## 5. Assumptions & autonomous decisions

- **Only the `qc_violation` caption changes; `unacknowledged_critical` is untouched.** Per #390's own
  filed scope (Goal, above) — not re-litigating TASK-400's already-shipped critical-hold UI.
- **A real `next/link` `<Link>`, not a full-page `<a>`.** Per `engineering/frontend-design` entry #5's
  own carve-out (Architecture consulted, above) — `/qc-violations` isn't a PHI-minimization-critical
  route.
- **No new visual language.** Reuses ADR-0021/TASK-400's existing warning-colored caption styling
  (`text-warning`, `role="status"`) — only the text and the added link change. Matches TASK-400's own
  explicit "no new visual 'held' badge/color token invented" decision.
- **No capability/role check gating the link itself.** Confirmed `/qc-violations`' read is open to any
  authenticated tenant user (Architecture consulted, above) — no `isQa`/`hasQaRole` check needed before
  rendering the link.
- **No backend change.** `reason` is already shipped and already asserted at the API/e2e level by
  TASK-400 — this is a pure frontend consumption task.

## 6. Risks

- **Reproducing a live QC-violation hold for manual verification is more setup than the critical-hold
  case.** Unlike TASK-073's already-known critical-panel repro, this needs an actual unresolved
  rejection-severity `qc_rule_violation` for an analyte a real ordered test also uses. Per
  `domain/qc-westgard` entries #6/#8/#9, reuse a synthetic, non-seeded analyte fixture (the same
  precedent `qc-gate.e2e-spec.ts` itself already established) rather than an arbitrary real seeded
  chemistry analyte, to avoid the exact cross-file CI contamination entry #9 documents.
- **`reason` being silently absent on an older/unexpected 409 shape.** `finalizeResult()`'s parsing
  must not throw if `reason` is missing from a `panel_hold` body (defensive default to the existing
  generic caption) — low risk since ADR-0021 guarantees the field on both hold branches, but the
  frontend should degrade gracefully rather than assume the field is always present.
- **Low overall risk otherwise** — additive-only change to two already-small, already-reviewed files
  from TASK-400; no route, schema, or capability surface is touched.

## 7. Acceptance criteria

- [ ] Finalizing an analyte whose panel is held on an unresolved rejection-severity QC violation shows
  a warning-colored caption distinguishable from the critical-hold caption, naming the QC violation and
  linking to `/qc-violations`.
- [ ] The link is a real, working `next/link` navigation to `/qc-violations`, reachable from a
  technologist-roled session (not just a `qa`-roled one).
- [ ] The `unacknowledged_critical` hold caption is pixel-for-pixel unchanged from its current
  (TASK-400-shipped) rendering.
- [ ] `loadWriteContext`'s pre-write 409 (the non-`panel_hold` control case) is unaffected.
- [ ] Existing `apps/api` e2e suite remains green, unmodified by this task (backend is untouched).

## 8. Testing plan

1. `web-verify` pass: reproduce a QC-violation hold live (synthetic analyte fixture, an unresolved
   rejection-severity violation, a technologist-roled session finalizing that analyte's panel) —
   confirm the new caption text, the link, and that clicking it lands on `/qc-violations` showing the
   corresponding violation. Light and dark mode, zero console errors — same discipline TASK-400 used
   for its own live verification.
2. Re-run the existing TASK-073 critical-hold repro (or `web-verify`'s saved script from TASK-400, if
   still present) to confirm the `unacknowledged_critical` caption is unchanged.
3. No new e2e body-shape assertions expected (TASK-400 already covers `reason` at the API level) —
   confirm `qc-gate.e2e-spec.ts` already asserts `reason: 'qc_violation'` at implementation start; add
   the assertion only if it turns out missing.
4. `pnpm typecheck` / `pnpm lint` on the two modified files.

## 9. Rollback plan

Purely additive, two-file frontend change (plus one now-widened shared interface field) — revert is a
clean file-level revert, no migration, no schema, no backend involvement.

## 10. Questions requiring human approval — resolved 2026-08-09

1. **Caption wording and link placement.** **Resolved: link only, recommended option.** Caption text
   "Saved — held on a QC violation. See QC violations →", `next/link` inline in the same `role="status"`
   span the existing caption already uses. No inline violation detail (rule code, severity) on the
   results grid itself — that detail already lives on `/qc-violations`, matching ADR-0021's own
   short-caption + navigation precedent rather than an inline data dump.
