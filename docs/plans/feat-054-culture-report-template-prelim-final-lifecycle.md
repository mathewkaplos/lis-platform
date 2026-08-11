# Implementation Proposal: FEAT-054 Culture report template & preliminary/final lifecycle
Status: APPROVED
ADR: adr-0047 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-054 (#504)

**Approved 2026-08-11** via the native options-prompt: all three §10 questions accepted as drafted
— including §10 Q1's own "build now, independent of the breakpoint-data wait" option. `/develop`
may proceed immediately on §2's mechanism; §7 AC #1 (authoring a real culture template) remains
blocked on FEAT-051/052/053's real data, tracked separately, not gating this feature's own merge.

## 1. Goal
Let a culture panel be reported before every result is verified (KB-21: culture is genuinely
provisional for days), then re-issued final once it is — without re-typing anything or losing the
preliminary version's own audit trail — using the existing visual designer (FEAT-047) and template
engine (FEAT-032) unmodified for authoring.

**Real finding, worth surfacing plainly: unlike FEAT-053, this feature's own core mechanism has no
hard technical dependency on FEAT-051/FEAT-052/FEAT-053's actual implementation at all.** The
preliminary/final lifecycle (§2 below) is generic report-generation infrastructure — it operates on
whatever `ordered_test`/`observation` rows already exist for any panel, chemistry or haematology
included, and can be built, tested, and demoed today with the existing seeded catalog (e.g. a CMP
panel with 2 of 14 analytes verified). Only issue #504's own AC #1 ("author a culture/antibiogram
report layout... through the existing designer") is genuinely microbiology-specific, and that's
authoring/content work against FEAT-053's real analytes once they exist, not code this feature
needs to write. **This proposal's own §2/§8 can be implemented and merged now, independent of the
breakpoint-data wait** — flagged explicitly in §10 Q1 as a real choice for the human, not assumed.

**Central finding (ADR-0047):** `report` currently has no status/lifecycle concept at all
(`report-assembly.ts`'s own header comment: "no `report.status`, no draft/preliminary concept of
its own" — a deliberate FEAT-016 scope cut) and hard-requires every analyte on a panel to be
`'verified'` before generating anything, rejecting with 409 otherwise. Read directly before
designing anything (not assumed from the issue's own KB references) — this is why a genuinely new,
additive mechanism is needed, not a small tweak to the existing one.

## 2. Affected files
- `db/migrations/00XX_report_type.sql` (new) — `report.report_type` column (`text`, NOT NULL,
  `'final' | 'preliminary'`), backfilled `'final'` for every existing row.
- `packages/db/src/schema/report.ts` (extends) — the new column.
- `apps/api/src/report/report-assembly.ts` (extends, existing function untouched) — a new
  `assembleAndPersistPreliminaryReport()`, mirroring `assembleAndPersistReport()`'s own shape with
  a relaxed precondition: at least one analyte has a current observation (any status), not every
  analyte need be verified. Included analytes without a current, verified observation render an
  explicit "Pending" placeholder (never a fabricated value) in the results table. The verifier
  block (currently assumes "the most-recently-verified analyte") degrades honestly: shows the
  most-recently-verified analyte's own verifier if at least one exists, or an explicit "Pending
  verification" state if none do yet — never a fabricated name/timestamp.
- `apps/api/src/report/report.types.ts` (extends) — `ChemistryReportInput` gains `reportType:
  'final' | 'preliminary'`, the render-time flag driving the new banner (fixed chrome, not a
  template-configurable field — same "patient/specimen/order header stays fixed regardless of
  template" precedent `report-template.ts`'s own header comment already establishes).
- `apps/api/src/report/report-render.ts` (extends) — draws a "PRELIMINARY REPORT" banner when
  `input.reportType === 'preliminary'`; final reports render exactly as they do today (byte-
  identical for every existing discipline, proven by the unmodified existing e2e suite still
  passing).
- `apps/api/src/report/report.controller.ts` (extends) — new `POST
  /v1/ordered-tests/:id/report/preliminary` (action sub-resource, per `standards/api-design.md`'s
  own convention, matching the issue's own checklist item), same `verify`-capability gate as the
  existing final route (§10 Q2 — a real judgment call: should a `technologist` also be able to
  issue a preliminary report without a verifier's sign-off? Flagged, not assumed).
- `apps/web/(app)/orders/[id]/report/...` (extends) — a preliminary-issue action alongside the
  existing final-report link, once the FEAT-047 designer has a real culture template to render
  (content/config work, not new code — see §1's own finding).

## 3. Architecture consulted
- KB-21 Microbiology (the provisional-for-days need this feature exists to serve).
- KB-13 Report Designer, KB-12 Template Engine — both already fully implemented (FEAT-047/032);
  this feature reuses them unmodified, no new authoring machinery.
- ADR-0047 — the `reportType` decision this proposal's own design follows, and its own explicit
  resolution of the issue's flagged "two lifecycles must not be conflated" risk.
- `apps/api/src/report/report-assembly.ts`, `report-render.ts`, `report.controller.ts`,
  `packages/db/src/schema/report.ts` — all read in full, the direct precedent every piece of this
  proposal extends rather than reinvents.
- `packages/domain/src/report-template.ts` — confirms the fixed-chrome-vs-template-configurable
  boundary the new PRELIMINARY banner follows (§2).
- `domain/result-verification` Skill.

## 4. Skills loaded
- `engineering/frontend-design` (required per the `plan` Skill's own rule — this feature adds a new
  `apps/web` action).
- `engineering/api-design` (required per the same rule — this feature adds a new `apps/api` route).
- `domain/result-verification`.

## 5. Assumptions & autonomous decisions
- **`reportType` is set by which endpoint was called, never auto-computed from observation
  completeness** — ADR-0047's own central decision, not re-litigated here.
- **A preliminary report requires at least one analyte with a current observation** (not zero) —
  a report with literally nothing to show isn't a real preliminary report, it's an empty error
  state; this bar is deliberately much lower than the existing all-verified one, not absent.
- **The PRELIMINARY banner is fixed chrome** (rendered by `report-render.ts` directly), not a
  template field type — not treated as an open question; matches the existing header/footer
  precedent exactly, the same reasoning already applied to every other piece of "always present
  regardless of template" content.
- **No new report.status query/list endpoint in this feature's own scope** — a report viewer
  showing "this order has a preliminary report on file" is a real, useful follow-up but not named
  by issue #504's own AC; flagged as deferred scope, not silently built.

## 6. Risks
- **The verifier-block "pending verification" degradation (§2) is a new UX shape no existing
  report has ever shown** — worth a real look during manual verification, not just unit-tested;
  a half-populated results table with some "Pending" rows and no verifier name is a genuinely new
  reading experience for a lab user, more so than any other change in this proposal.
- **Who may issue a preliminary report (§10 Q2) is a real clinical-workflow judgment**, not
  something safe to default silently — a wrong default here (too permissive) could let unverified,
  provisional-looking-but-actually-final-sounding content reach a clinician without appropriate
  sign-off; flagged explicitly rather than assumed.
- **FEAT-054's own e2e/manual proof for the actually-microbiology-shaped scenario (a real culture
  panel with a real preliminary → final transition) is still blocked on FEAT-051/052/053's real
  data**, even though the underlying mechanism itself isn't (§1). The chemistry-panel-based e2e
  proof this proposal's own §8 describes is real and sufficient for merging this feature, but the
  literal "demoed on a real culture" milestone-completion bar still waits on the same data chain.

## 7. Acceptance criteria
(unchanged from issue #504, restated for traceability)
- [ ] A lab admin can author a culture/antibiogram report layout entirely through the existing
      designer UI, no code change
- [ ] A culture report can be issued preliminary, then re-issued final, without re-typing or
      losing the preliminary version's own audit trail

## 8. Testing plan
- Unit: `report-render.ts`'s new banner-rendering branch; the preliminary-path verifier-block
  degradation logic.
- Integration (real Postgres, existing seeded chemistry catalog — no microbiology data needed): a
  panel with some but not all analytes verified generates a `'preliminary'` report (200, not 409);
  the SAME panel, once fully verified, generates a `'final'` report via the existing unmodified
  route; both `report` rows and both `report.generate` audit events remain independently queryable
  afterward. A panel with zero current observations is rejected (409) from the preliminary path too.
- Regression: the full existing report/report-template e2e suite passes completely unmodified —
  proves the existing final path's own behavior is untouched by this feature.
- Manual test: performed as the real `verifier` role once a culture-shaped fixture is available
  (blocked on FEAT-051/052/053's real data, per §6 — the chemistry-based automated proof above is
  what actually gates merging this feature).

## 9. Rollback plan
Additive: one new NOT-NULL column (safely backfilled), one new function, one new route, one new
render branch. No existing function, route, or rendered byte output changes for any existing
discipline. Rollback is dropping the column and removing the new function/route/branch.

## 10. Questions requiring human approval
1. **Approve ADR-0047** — `report.reportType` ('final'|'preliminary') is a new, endpoint-selected
   field, orthogonal to `report_template_version`'s own authoring lifecycle, not a new report
   state machine — and approve building/merging this mechanism now, independent of the
   FEAT-051/052/053 breakpoint-data wait (§1), rather than waiting to build it alongside FEAT-053?
2. **Who may issue a preliminary report** — the same `verify` capability the existing final-report
   route already requires (a verifier's own judgment call, even for a provisional issue), or a
   lower bar (e.g. `enter_result`, letting a technologist issue one without a verifier)?
3. **A preliminary report's verifier block, when literally nothing on the panel is verified yet**
   — show an explicit "Pending verification" state (no name/timestamp at all), or omit the
   verifier block from the rendered PDF entirely in that specific case?
