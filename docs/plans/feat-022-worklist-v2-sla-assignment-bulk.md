# Implementation Proposal: FEAT-022 — Worklist v2 (SLA, assignment, bulk) — Part 1: API

Status: APPROVED
ADR: adr-0024 (accepted)    Date: 2026-08-09    Backlog ID: FEAT-022 (#31)

§10's open questions were resolved by the human via the native options-prompt, all recommended
options chosen: **Q1** API accepts any uuid, v1 UI restricted to self-assign only — see `adr-0024`
(`~/work/lis-engineering/adr/adr-0024-worklist-assignment-is-an-unvalidated-uuid-column-v1-ui-restricted-to-self-assign.md`),
drafted alongside this proposal and **accepted 2026-08-09**, same session, alongside this
proposal's own approval. **Q2** fixed 80% ratio, no new column. **Q3** yes, draft the ADR now.

**This proposal's approvable scope is the backend API only** — SLA computation, assignment, and
bulk-cancel. The worklist UI (bulk-select checkboxes, an "Assign to me" action, an SLA-color pill)
will be specified as a revision to this same file once this API's real output exists, mirroring
exactly how FEAT-017's own proposal split TASK-061 (API) from TASK-062 (UI) in this same file.
FEAT-022 has no decomposed task issues yet (its own issue body: "Not yet decomposed... broken into
tasks at its milestone kickoff") — this session's own research is that kickoff.

## 1. Goal

FEAT-022's own literal AC (issue #31): "TAT/SLA indicator correctly shows at-risk and overdue
states" and "Bulk assign and bulk transition work correctly on multi-selected rows." This is
explicitly the feature that picks up what FEAT-017 (Minimal worklist, fully merged) deliberately
deferred — its own TASK-061 proposal (`docs/plans/feat-017-minimal-worklist.md`) named three real
gaps by number: finding #2 ("no TAT/deadline/SLA column exists anywhere... a query-time-computed
elapsed field, not a stored one, unless the human wants a stored target/threshold concept introduced
now"), finding #4 ("no user/assignment table exists anywhere in this schema... out of scope for
TASK-061 unless the human wants it introduced now"), and TASK-062's own finding #1 ("no bulk-mutation
route exists for `ordered_test`"). FEAT-022 is that "introduce it now."

**Real, load-bearing finding #1 — no persisted user/principal/staff table exists anywhere in this
schema, still, as of today (re-confirmed, not assumed stale from FEAT-017's research).** Grepped
every file under `packages/db/src/schema/` for a `pgTable` matching `user|principal|staff` — zero
hits. `apps/api/src/auth/request-context.ts`'s `RequestContext` is still exactly `{sub, tenantId,
roles}` — no persisted-row resolution. No Keycloak Admin API integration exists anywhere in
`apps/api` either (grepped for `admin/realms`/`KeycloakAdmin`) — there is no live user directory to
query, and `keycloak-config.ts` carries only the public JWKS issuer URL, no service-account
credentials for an admin client. **"Assignment" therefore has nowhere to resolve a human-readable
name from, and no directory to pick a colleague from.** This directly shapes §10 Q1.

**Real, load-bearing finding #2 — most `ordered_test.status` transitions have real domain side
effects that cannot be safely reduced to a raw bulk status write.** `receive()`
(`specimen.controller.ts`) creates a real `specimen`/`specimen_fulfillment` row alongside the status
change; `finalize()`'s roll-up (`finalization-rollup.interceptor.ts`) enforces Constitution Law #3
(no advance to `'resulted'` while any critical is unacknowledged); `verify()` sets
`verifierUserId`/`verifiedAt` on the underlying Observation, not just a status field. A generic
`POST /v1/worklist/bulk-transition` accepting an arbitrary `toStatus` would let a caller skip every
one of these real checks — a genuine safety regression, not a hypothetical. The **one** existing
transition with no such side effect is cancel: `order.controller.ts`'s `cancel()` (`:id/cancel`)
already does nothing beyond a plain status flip on every `'ordered'`-status test under one order,
cascading to the order itself only if every test ends up cancelled. This directly shapes §10 Q2 —
the AC's literal "bulk transition" is satisfied narrowly and safely as **bulk-cancel**, not a
generic status setter.

**Real, load-bearing finding #3 — `cancel()`'s own eligibility rule (`status === 'ordered'` only)
is real and narrows bulk-cancel's practical reach.** A worklist row already past `'ordered'`
(`'received'`, `'in_process'`, `'resulted'`) is not cancel-eligible via this route today, matching
`order.controller.ts`'s own existing single-order rule exactly — bulk-cancel does not invent a new,
more permissive rule; it extends the existing one across potentially many orders in one call, with
per-row ineligibility reported back, not silently skipped.

## 2. Affected files

New:
- `db/migrations/00xx_sla_target.sql` + `packages/db/src/schema/sla-target.ts` — new tenant-scoped
  table, RLS from the creating migration (Constitution invariant 4). Mirrors `delta_check_rule`'s
  own precedent (FEAT-025, ADR-0023): a small, per-tenant, per-discriminator config table with no
  existing home to extend.
- `db/seed/sla-targets.sql` (or a new section in an existing seed file) — placeholder targets
  (routine, stat), `PLACEHOLDER — NOT PARTNER-VALIDATED`, same convention as every other seeded
  clinical/operational config in this repo.

Modified:
- `packages/db/src/schema/order.ts` — new nullable `assignedUserId` column on `orderedTest` (no FK,
  matching `observation.operatorUserId`/`verifierUserId`'s own "no FK: no user table exists yet"
  precedent exactly). New migration.
- `packages/domain/src/worklist.ts` — `WorklistItem` gains `assignedUserId: string | null` and a
  computed `slaStatus: 'on_track' | 'at_risk' | 'overdue'`; new `worklistBulkAssignSchema`,
  `worklistBulkCancelSchema`, and their response schemas.
- `apps/api/src/worklist/worklist.controller.ts` — `loadItems` resolves `sla_target` rows (2 rows,
  one per priority — no batching concern) alongside the existing `order`/`testDefinition`/`patient`
  resolution, and computes `slaStatus` per row from `ageMinutes` vs. the row's own priority target.
  Two new routes: `POST /v1/worklist/bulk-assign`, `POST /v1/worklist/bulk-cancel`.
- `apps/api/openapi.json`, `packages/sdk/src/schema.ts` — regenerated (CI-enforced, PR #343).

## 3. Architecture consulted

KB-26 Task Management (`26-task-management.md`) — read in full. Its real-time push, materialised
views, first-class Task-record lifecycle, and configurable pull/push-per-task-type model are **all
explicitly out of scope here** (see §6 Risks) — this proposal builds only the slice FEAT-022's own
narrow AC asks for, the same "read the full KB vision, build the real narrow slice" discipline
TASK-062's own proposal already used against Stitch §8.0's larger vision. KB-26's own "pull vs. push"
distinction (§Assignment models: "pull... best for high-volume routine review... push... for
callbacks, specific... work... default is pull for routine bench/verification work") directly
motivates §10 Q1's recommended option. Constitution invariant 4 (RLS) and invariant 5 (audit every
clinically significant action) — bulk-assign/bulk-cancel are both clinically/operationally
significant per the same reasoning `order.cancel`/`observation.finalize` are already audited under.
`docs/plans/feat-017-minimal-worklist.md` (both revisions) — the direct predecessor this proposal
extends.

## 4. Skills loaded

`engineering/api-design` — entry #11 (action sub-resources use a slash, `/verb`, not a colon —
`bulk-assign`/`bulk-cancel` follow this), entry #6 (only mutating actions are audited; the existing
`GET /v1/worklist` stays unaudited, unchanged). `engineering/database-design` (RLS-from-creating-
migration discipline, index planning — no new index added for `assignedUserId` in this pass, see
§6 Risks).

## 5. Assumptions & autonomous decisions

- `sla_target` is priority-keyed only (`routine`/`stat`), matching `order.priority`'s own real
  two-value domain — no per-discipline/per-test-type SLA in v1 (KB-26 names this as a real future
  axis; not asked for by this AC).
- SLA clock is the same `ordered_test.createdAt` FEAT-017 already uses for `ageMinutes` — no new,
  second "clock" (e.g. specimen-received time) introduced for this feature.
- Bulk endpoints live on `WorklistController` (`v1/worklist/bulk-assign`, `v1/worklist/bulk-cancel`),
  not `OrderController` — these are worklist-initiated, potentially cross-order operations, a
  different resource shape from `order.controller.ts`'s own single-order-scoped `cancel()`.
- Both new routes reuse the existing `manage_orders` capability (already granted to `technologist`,
  already gating the single-order `cancel()` action) — no new capability invented for what is, at
  the domain level, the same class of action.
- `worklistBulkAssignSchema`/`worklistBulkCancelSchema` cap `orderedTestIds` at
  `WORKLIST_RESULT_LIMIT` (100) — reuses the existing fixed-cap precedent rather than inventing a
  second limit constant.

## 6. Risks

- **Real identity gap (finding #1) — this is the single biggest open risk in this proposal, not a
  minor detail.** Whatever §10 Q1 resolves to, this task does **not** build a user directory,
  Keycloak Admin API integration, or a persisted `principal` table — all three are real, separate,
  larger architectural decisions this repo has deferred since M2 and this proposal deliberately does
  not smuggle in now.
- KB-26's full vision (real-time push, materialised views, first-class Task records, configurable
  pull/push per task type, facility/discipline scoping) is entirely out of scope — this is a
  computed-field + two new mutation routes, not the Task-management service KB-26 describes.
- No index added for `assignedUserId` — an "assigned to me" *filter* (as opposed to the *write* this
  proposal builds) is real, near-term-likely follow-up work KB-26 names, not built speculatively here.
- Bulk-cancel's real reach is narrower than "bulk transition" might suggest at a glance — only
  `'ordered'`-status rows are eligible (finding #3), so a bulk-selection spanning `'received'`/
  `'in_process'` rows will report most of them ineligible, not silently cancel them.

## 7. Acceptance criteria

- [ ] Each worklist item's `slaStatus` (`on_track`/`at_risk`/`overdue`) is computed correctly against
      a real `sla_target` row for that priority, proven at both boundaries (exactly at target =
      overdue; exactly at the at-risk threshold = at_risk), mirroring `flagging.ts`'s own
      inclusive-boundary precedent.
- [ ] An item whose priority has no configured `sla_target` row never fabricates a status (returns
      `on_track` — never silently treated as breached or at-risk with no real target to compare
      against, same "no_range... never fabricated" discipline `reference-range.ts` established).
- [ ] `POST /v1/worklist/bulk-assign` sets `assignedUserId` on every id in the request that resolves
      to a real, tenant-visible `ordered_test` row; ids that don't (wrong tenant, nonexistent) are
      reported back, not silently dropped or a 500.
- [ ] `POST /v1/worklist/bulk-cancel` cancels every eligible (`'ordered'`-status) id, reports
      ineligible ids separately, and correctly cascades each affected order's own `status` to
      `'cancelled'` only when *that order's* every test ends up cancelled — proven across a
      multi-order bulk selection, not just a single-order case the existing route already covers.
- [ ] Both new routes are audited (`@Audit()`), tenant-isolated (RLS-proven, a second-tenant fixture
      id in the same bulk request must never be mutated), and gated on `manage_orders`.
- [ ] `openapi.json`/`packages/sdk/src/schema.ts` regenerated and committed.

## 8. Testing plan

Extend `apps/api/test/worklist.e2e-spec.ts`: seed `sla_target` rows and `ordered_test` fixtures at
known ages (via real timestamps, not mocked clocks) to prove `on_track`/`at_risk`/`overdue` boundary
correctness; a priority with no configured target never flags. New bulk-assign tests: a mixed batch
of valid + wrong-tenant + nonexistent ids, asserting the valid ones update and the rest are reported,
not silently accepted. New bulk-cancel tests: a mixed batch spanning `'ordered'` and `'in_process'`
rows proving only the former cancel; a multi-order selection proving each order's own cascade-to-
cancelled logic is evaluated independently per order, not globally. RLS isolation test for
`sla_target` (new tenant-scoped table). Full existing `apps/api` e2e suite re-run for zero regression
(touches an existing table's schema and one existing controller; no existing route's behavior
changes).

## 9. Rollback plan

`assignedUserId` and `sla_target` are both purely additive (nullable column; new table) — no
existing row or query is affected if reverted. The two new routes are additive; reverting removes
them with no data-shape consequence. `slaStatus` on `WorklistItem` is a computed, non-persisted
field — reverting the computation is a pure code revert, no migration to unwind beyond dropping the
new column/table (both safe to drop, nothing else references them).

## 10. Questions requiring human approval

**Q1 — What does "assign" mean without a user directory?** Finding #1: no persisted user table, no
Keycloak Admin API integration, no way to resolve a uuid to a display name or offer a picker of
real colleagues today.
- (a) **[Recommended]** Build the API to accept **any** caller-supplied `assignedUserId` (a bare
  uuid, unvalidated against a directory — matching this repo's own established "no FK: no user
  table exists yet" precedent), but scope Part 2 (UI)'s actual bulk-action to **self-assign only**
  ("Assign to me," sending the caller's own JWT `sub`) — matches KB-26's own stated default
  ("pull... best for high-volume routine review," the exact case this worklist serves), is
  immediately real and usable without inventing a directory, and the API itself stays general enough
  that a future directory-backed "assign to a named colleague" UI needs no API change, only a new
  picker.
- (b) Build a minimal Keycloak Admin API client now (a new confidential client + service-account
  role in `infra/keycloak/lis-realm.json`, a live `GET /admin/realms/lis/users` proxy) so the UI can
  offer a real named-colleague picker in Part 2 — a genuinely more complete UX, but a real, separate
  infrastructure decision this repo has deferred since M2, larger than "Worklist v2"'s own stated
  scope.
- (c) Defer assignment entirely until a real user/identity feature exists — leaves FEAT-022's own
  literal "bulk assign" AC unmet.

**Q2 — At-risk threshold: a fixed ratio of the target, or a second stored column?**
- (a) **[Recommended]** Fixed ratio (80% of `targetMinutes`) computed at read time — no second
  config column, matches FEAT-017's own "don't over-build config ahead of a real need" precedent
  (TASK-061 §10 Q2's own resolution).
- (b) A second `warningThresholdMinutes` column on `sla_target`, independently configurable per
  priority — more flexible, a real config surface this AC doesn't explicitly ask for.

**Q3 — Should an ADR be drafted for the assignment-identity decision (Q1) before this proposal is
approved?** Unlike FEAT-025's ADR-0023 (drafted alongside proposal approval), Q1's answer here has
real, longer-lived architectural weight — it effectively decides whether this repo's "assignment"
concept stays uuid-only through a future push-model feature, or gets revisited then.
- (a) **[Recommended]** Yes — draft it now, alongside this proposal, same pattern as ADR-0023.
- (b) No — treat Q1 as a proposal-level decision only, revisit via a future ADR only if/when a real
  directory feature is proposed.
