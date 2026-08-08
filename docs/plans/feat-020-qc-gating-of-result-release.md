# Implementation Proposal: FEAT-020 QC gating of result release
Status: **APPROVED**
ADR: adr-0019 (accepted 2026-08-08)    Date: 2026-08-08    Backlog ID: FEAT-020 (#29) / TASK-070 (#384)

Drafted during `/orient` session 24, immediately after FEAT-019 closed and #372/#373 (TASK-067/068,
stuck open on GitHub despite merged PRs — same root-cause pattern as session 22, fixed manually) were
closed. **Approved 2026-08-08**, same session, recommended option chosen for each of §10's four
questions (see their own resolutions, inline, for detail) — ADR-0019 accepted as drafted; issue #381's
QC-list-screen gap folded into this task's own frontend scope; TASK-070 (#384) created as a single,
undivided task (the gate and resolve halves are small and tightly coupled — splitting them would be
artificial, superseding this proposal's own earlier "TASK-070" placeholder framing, which is now the
real issue number); the `resolve_qc` capability/role mapping deferred to implementation-start research,
not decided here. **Not yet implemented — no code written.**

## 1. Goal

M5 continues after FEAT-019 (Levey-Jennings + Westgard engine) closed this session. Of M5's four
currently-unblocked open features (FEAT-020, FEAT-022, FEAT-023, FEAT-025 — FEAT-024 remains blocked
on FEAT-023), FEAT-020 was chosen: it is Critical priority, its sole dependency (FEAT-019) just
closed, and it is the direct payoff KB-27 and `domain/qc-westgard` Skill entry #4 have named since
FEAT-018's own kickoff — "no result releases from an out-of-control run" is a Constitution-adjacent
safety behavior, not a routine feature. FEAT-023 (Haematology CBC), the other unblocked Critical-
priority feature, opens an entirely new domain area (new instrument type, new analytes) with no
groundwork laid this session; FEAT-020 instead directly consumes this session's own fresh work
(`qc_rule_violation`, `qc-westgard` Skill) while it's still warm.

FEAT-020's issue AC is narrow and concrete: "Result release is blocked when the associated QC run is
out-of-control, verified by integration test." Its Tasks section is unstarted, the same "belongs to a
rolling-wave milestone" state every M5 feature starts in.

**Real, load-bearing finding from this proposal's own research, not present in FEAT-020's issue text:**
this codebase has no separate "release" action to gate — no auto-verification pipeline, no report-
finalization route. The closest existing concept is `ordered_test.status -> 'resulted'`, already
gated by `FinalizationRollupInterceptor` for unacknowledged criticals (Constitution Law #3). A second
finding: `observation.instrumentId`/`control_lot.instrumentId` are both real schema columns that no
application code anywhere ever sets, making KB-27's stated "analyte × instrument" gate scope currently
unenforceable as written. **ADR-0019** (drafted alongside this proposal, Status: proposed) resolves
both: the gate extends the existing rollup interceptor rather than inventing a new one, and holds are
scoped by analyte alone (not analyte × instrument) until something actually populates `instrumentId`.
A third finding: `qc_rule_violation` (ADR-0018) has no resolve/acknowledge lifecycle by design — this
feature must add one, or a single rejection-rule firing would permanently block an analyte forever.

**Task decomposition (draft):**
- **TASK-070 — QC release gate + resolve action.** This proposal's full scope, undivided — the two
  halves (gate check, resolve route) are small enough, and tightly enough coupled (the gate's query
  and the resolve route's write target the exact same table/columns), that splitting them into
  separate tasks would be artificial. Extends `FinalizationRollupInterceptor` with the new
  unresolved-rejection-violation check (ADR-0019 Decision 1/2); adds `resolvedAt`/`resolvedByUserId`
  to `qc_rule_violation` (ADR-0019 Decision 3); adds `resolve_qc` capability and
  `POST /v1/qc-rule-violations/:id/resolve`.
- **Issue #381** (no control-lot list/QC dashboard screen) is a candidate to fold into this feature's
  own frontend surface — a QA user needs *some* screen to find and resolve an active violation, which
  is exactly the list view #381 already identifies as missing. Raised explicitly as §10 Q2, not
  assumed either way, per #381's own filed reasoning ("a real decision for whoever picks up the next
  QC-related feature").

## 2. Affected files

- `lis-engineering/adr/adr-0019-qc-gate-extends-finalization-rollup-analyte-scoped-hold-new-resolve-action.md`
  (new, this session) — must be **accepted** before this task's migration/code is written (§10 Q1).
- `packages/db/src/schema/qc-rule-violation.ts` (modify) — add nullable `resolvedAt` (timestamptz) and
  `resolvedByUserId` (uuid, no FK — matches this table's existing no-FK-on-user-columns convention
  elsewhere, e.g. `observation.operatorUserId`) columns.
- `db/migrations/00NN_qc_rule_violation_resolve.sql` (new, hand-written, ALTER TABLE only — no new
  table, per ADR-0019 Decision 3).
- `apps/api/src/observation/finalization-rollup.interceptor.ts` (modify) — a third check alongside the
  existing `unacknowledgedCriticals` query (lines 155-180 today): for each `requiredAnalyteIds` entry,
  does an unresolved (`resolvedAt IS NULL`), rejection-severity `qc_rule_violation` exist, joined via
  `qc_rule_violation.controlLotId -> control_lot.analyteId = <this analyte>` and tenant, per ADR-0019
  Decision 1/2 (analyte-scoped, not instrument-scoped). If so, 409 with a distinct message
  ("Cannot complete: N analyte(s) held on an unresolved QC violation").
- `packages/domain/src/qc-rule-violation.ts` (new, or extend `control-lot.ts` if a natural home exists
  there already) — `resolveQcRuleViolationSchema`/response shape, mirroring `criticalNotification`'s
  own acknowledge-response precedent.
- `apps/api/src/control-lot/control-lot.controller.ts` or a new `qc-rule-violation.controller.ts`
  (new route) — `POST /v1/qc-rule-violations/:id/resolve`, bare action (no body), `@RequireCapability
  ('resolve_qc')`, `@Audit({ action: 'qc-rule-violation.resolve', resourceType: 'qc_rule_violation' })`
  — mirrors `verify()`'s own bare-action, single-capability, audited shape exactly.
- Capability model (wherever `verify`/`enter_result`/`acknowledge` capabilities are currently defined
  — needs a repo grep at implementation time, not yet located in this proposal) — add `resolve_qc`,
  granted to whichever role(s) map to a QA/lab-manager persona (TBD, likely mirrors `verifier`'s own
  grant pattern; a real question, not assumed — see §10 Q4).
- `apps/api/test/qc-gate.e2e-spec.ts` (new) — gate blocks/allows the rollup correctly; resolve clears
  it; warning-only never gates; RLS isolation on the new columns; cross-tenant 404 on resolve.
- Frontend: **scope pending §10 Q2** — either folded into this task (a minimal violation list +
  resolve button) or deferred to a follow-up, depending on how #381 is resolved.

## 3. Architecture consulted

- KB-27 Quality Control — primary; the release-gate section and "resolution is a documented, audited
  action."
- ADR-0019 (this session) — the concrete gate-hook-point/scope/resolution mechanism.
- ADR-0018 (FEAT-019) — `qc_rule_violation`'s own shape and its explicit "no resolve lifecycle here"
  deferral to this feature.
- ADR-0016/ADR-0017 (critical notification) — the closest existing precedent for a hold/acknowledge
  lifecycle on a clinically significant table; `FinalizationRollupInterceptor`'s own extension pattern
  (TASK-066 added the criticals check the same way this task adds the QC check).
- `domain/qc-westgard` Skill — entry #4 (the FEAT-018→019→020 scope boundary), entry #6/#7 (the "state
  the gap, don't fabricate" discipline applied here to the `instrumentId` finding).

## 4. Skills loaded

- `domain/qc-westgard` — primary, all entries.
- `engineering/database-design` — ALTER TABLE convention, nullable-column-addition precedent.
- `engineering/rls-multi-tenancy` — no new table this time, but the gate query itself must respect the
  existing tenant session binding.
- `engineering/api-design` — bare sub-resource action route shape (`verify()`/`acknowledge()`
  precedent), audited-mutation conventions.
- `engineering/testing` — the existing `capability-check.e2e-spec.ts` transactional-rollback precedent
  this task's own resolve route can likely reuse rather than re-prove.

## 5. Assumptions & autonomous decisions

- **Gate extends `FinalizationRollupInterceptor` rather than a new interceptor/route.** Per ADR-0019
  Decision 1 — the only existing "release-adjacent" enforcement point in this schema; raised as part
  of §10 Q1 (bundled with ADR-0019 acceptance) since it's a genuine architectural judgment call.
- **Analyte-scoped hold, not analyte × instrument.** Per ADR-0019 Decision 2 — the real,
  research-confirmed finding that `instrumentId` is never populated makes instrument-scoping currently
  vacuous. Also part of §10 Q1.
- **New `resolve_qc` capability, not reuse of `verify`.** Per ADR-0019 Decision 3 — raised explicitly
  as §10 Q4 below since capability-to-role mapping is a real access-control decision, not a pure
  implementation detail.
- **No re-evaluation requirement on resolve** (a QA user can clear a hold without a fresh in-control
  QC result existing) — per ADR-0019's own Consequences, matching the trust model `verify()` already
  extends elsewhere. Not raised as a separate question; follows directly from ADR-0019 if accepted.

## 6. Risks

- **ADR-0019 is not yet accepted.** Single blocking dependency for this entire task, raised as §10
  Q1, not assumed.
- **Analyte-only scoping over-blocks** relative to KB-27's stated ideal (documented in ADR-0019
  Consequences) — an accepted, safety-favoring trade-off, not a silent gap, but worth restating here
  since it directly affects how surprising the gate's behavior may look to a future reader who only
  reads KB-27 and not ADR-0019.
- **No frontend surface decided yet** (§10 Q2) — if resolved toward "defer," this feature ships a real
  safety gate with no way for a QA user to discover *why* an analyte is stuck short of a direct API
  call or reading `qc_rule_violation` in the database, which is a genuine usability gap worth being
  explicit about rather than treating the backend-only slice as a complete feature.
- **Capability-to-role mapping is unresearched** (§10 Q4) — this proposal does not yet know which
  Keycloak realm role(s) should receive `resolve_qc`; needs a real look at the existing role model
  before implementation, not a guess baked into the migration.
- **Extending `FinalizationRollupInterceptor` touches a route every existing `finalize()` call already
  exercises** — low risk (the new check is purely additive, structurally identical to the existing
  criticals check it sits beside) but the full existing e2e suite must stay green, same discipline
  TASK-066 already proved when it added the criticals half of this same interceptor.

## 7. Acceptance criteria

Mirrors FEAT-020's own issue AC plus ADR-0019's acceptance criteria (not yet checked off — nothing
implemented yet):
- [ ] An ordered test with an unresolved rejection-severity `qc_rule_violation` on any of its analytes
  cannot complete its `'resulted'` rollup (409), verified by integration test.
- [ ] `finalize()`'s own observation write is never rolled back by this gate (same property the
  existing criticals check already has).
- [ ] `POST /v1/qc-rule-violations/:id/resolve` clears the hold; audited; requires `resolve_qc`.
- [ ] Warning-only (`1-2s` alone) violations never gate.
- [ ] Hold is scoped per analyte, not global.
- [ ] Full existing `apps/api` e2e suite remains green (zero regression to the existing criticals
  gate or any unrelated `finalize()`/`verify()` path).

## 8. Testing plan

1. `apps/api/test/qc-gate.e2e-spec.ts` — gate blocks completion when an unresolved rejection violation
   exists for an analyte on the panel; allows completion once resolved; never blocks on warning-only;
   scoped correctly (an unrelated analyte on the same or a different ordered test completes normally).
2. RLS isolation on the new `resolvedAt`/`resolvedByUserId` columns and the resolve route (cross-tenant
   404).
3. Full existing `apps/api` e2e suite re-run, confirming zero regression to
   `FinalizationRollupInterceptor`'s existing criticals check.
4. `openapi.json`/`packages/sdk/src/schema.ts` regenerated if the new route is `@ZodResponse`-bound
   (expected yes, matching `verify()`'s own precedent).
5. Migration up/down cycle against seeded data, including at least one pre-existing (TASK-067-era)
   `qc_rule_violation` row to confirm the new nullable columns default correctly on existing data.

## 9. Rollback plan

Additive: two new nullable columns (drop them); `FinalizationRollupInterceptor`'s change is a pure
addition alongside the existing criticals check (remove the added clause, prior behavior untouched);
the resolve route is a new, isolated endpoint (remove it). No existing column or route behavior is
modified. No production data exists at this milestone (ADR-0008/ADR-0015/ADR-0018 precedent).

## 10. Questions requiring human approval — all four resolved 2026-08-08, recommended option chosen for each

1. **Is ADR-0019 approved as written?** **Resolved: yes, accepted as drafted.** ADR-0019's own Status
   updated to `accepted`.
2. **Should issue #381 be folded into this task's own frontend scope?** **Resolved: yes** — a minimal
   violation list + resolve button, not a full QC dashboard, folded into TASK-070 (#384)'s own scope.
   #381 itself left open (not closed by this decision alone) until TASK-070 actually ships that
   surface.
3. **Should TASK-070 be created as a real GitHub issue now?** **Resolved: yes** — created as **issue
   #384**, single and undivided (matching this proposal's own §1 reasoning that the gate and resolve
   halves are too small and too tightly coupled to split). GitHub Projects v2 custom fields were not
   populated by this creation (the repo's own `import-to-github.sh` normally does that sync; skipped
   here to avoid its GraphQL cost against an already-strained session quota) — populate before any
   board-driven planning relies on those fields being current.
4. **Which capability/role should `resolve_qc` map to?** **Resolved 2026-08-08, at `/develop` TASK-070
   start:** a new **`qa`** Keycloak realm role, granted `resolve_qc` only — not `verify` or
   `enter_result`. `infra/keycloak/lis-realm.json` today defines only `technologist`/`verifier`
   (ADR-0011's deliberately narrow initial scope); KB-10's own persona list already names
   `lab_director` / `qa` as a role distinct from both, and ADR-0019 Decision 3 already reasoned that
   resolving a QC failure and verifying a patient result are different real-world actors — reusing
   `verifier` for `resolve_qc` (the alternative considered) would quietly contradict that same
   reasoning at the role layer even though the capability itself stayed separate. A seeded
   `test-user-5` (tenant `...0001`, `realmRoles: ["qa"]`) is added alongside it, mirroring
   `test-user`/`test-user-4`'s own real-token-proof precedent (ADR-0011 AC) rather than only unit-
   testing `resolveGrantingRole` in isolation.
