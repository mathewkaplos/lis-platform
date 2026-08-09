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

---

# Revision: FEAT-022 Part 2 — Worklist v2 UI (bulk-select, SLA indicator, self-assign)

Status: APPROVED
ADR: none new (extends adr-0024's own accepted decisions 2/3 unchanged — this revision is the "v1
UI restricted to self-assign only" half of that decision, not a new one)    Date: 2026-08-09
Backlog ID: FEAT-022 (#31)

§10's open questions were resolved by the human via the native options-prompt, both recommended
options chosen: **Q1** inline summary banner for partial bulk-cancel feedback. **Q2** bulk-action
bar scoped to assign/cancel only, no results-screen shortcut.

## 1. Goal

Part 1 (merged, PR #419) built the API: `slaStatus`/`assignedUserId` on every `GET /v1/worklist`
item, `POST /v1/worklist/bulk-assign`, `POST /v1/worklist/bulk-cancel`. FEAT-022's own AC needs a
real screen driving them: "TAT/SLA indicator correctly shows at-risk and overdue states" and "Bulk
assign and bulk transition work correctly on multi-selected rows" — both currently true of the API
alone, unreachable from the UI.

**Real, load-bearing finding #1 — `DataTable`'s own header comment already named exactly this
gap, unprompted.** `packages/ui/src/components/data-table.tsx:10-14`: *"pagination/infinite
scroll, column show/hide/reorder/resize, and the bulk-action bar are real Pattern A requirements
not yet built here ... revisit when a screen actually needs them."* Row selection itself
(`selectedRowIds`/`onSelectedRowIdsChange`, a checkbox column, select-all) is **already fully
built and unused anywhere in `apps/web`** — grepped every non-Storybook consumer; only
`data-table.stories.tsx` exercises it. This screen is the first real consumer, the same
"built but never consumed until X" pattern `StatusPill` and `FilterBar`/`StatCard` each went
through before their own first real task (`frontend-design` entries #1, and TASK-062's own finding
#2). **The bulk-action bar itself (buttons that appear once rows are selected) is not built
anywhere — this revision builds it locally in `worklist-view.tsx`, not as a new `packages/ui`
primitive**, matching this repo's own "promote to a shared primitive only once a second consumer
needs it" precedent (no second bulk-selectable screen exists yet to justify one).

**Real, load-bearing finding #2 — ADR-0024's own decision 3 already resolved the assignee-display
question; this task must not quietly re-litigate it.** No user directory exists (ADR-0024). The
only honest states this screen can show for `assignedUserId` are: unassigned (`null`), assigned to
the viewer (`assignedUserId === session.sub`), or assigned to someone else (a real uuid the UI
cannot resolve to a name). The bulk-assign *action* is self-assign only ("Assign to me"), per
ADR-0024 decision 3 — this revision does not add a colleague picker, free-text uuid entry, or any
other path to assigning to someone other than the caller.

**Real, load-bearing finding #3 — bulk-cancel's own API eligibility (only `'ordered'`-status rows)
means a bulk selection spanning stages will report partial results, and the UI must surface that
honestly, not silently.** `POST /v1/worklist/bulk-cancel`'s response is
`{cancelledIds, ineligibleIds}` specifically so a caller can distinguish "did nothing" from
"did the eligible subset" — a UI that only checks "did the call succeed" and refreshes blindly
would hide a real, common case (a tech selects a mixed-stage batch, expects all of it cancelled,
and needs to know some rows were skipped and why).

**Real, load-bearing finding #4 — this repo has two different established UI-refresh patterns
after a mutation, and they fit different mutation shapes; this task must pick the one that
actually matches bulk actions, not default to whichever is closest by proximity.**
`results-grid.tsx` (single-row, in-place value edits) patches local row state directly.
`violations-table.tsx` (TASK-070, a same-shaped "select an item, resolve it, it leaves the current
filtered view") does the same: `setRows((prev) => prev.filter(...))`, no `router.refresh()`, no
full Server Component re-fetch. Bulk-assign/bulk-cancel are the same shape as the latter (an
action that changes which rows belong in the *current* filtered view — a cancelled row must leave
the view the same way a resolved QC violation does) — this revision follows `violations-table.tsx`'s
own local-state-patch precedent, not a page reload.

## 2. Affected files

New:
- `apps/web/app/(app)/worklist-actions.ts` — `'use server'`, mirrors
  `orders/[id]/results/actions.ts`'s exact shape: `bulkAssignToMe(orderedTestIds: string[])` (sends
  the caller's own `sub` — the only value ADR-0024's v1 UI ever sends) and
  `bulkCancelSelected(orderedTestIds: string[])`, both calling `client.POST('/v1/worklist/bulk-assign'
  | '/v1/worklist/bulk-cancel', ...)`.

Modified:
- `apps/web/auth/roles.ts` — new `hasTechnologistRole(session)`, identical fail-closed shape to
  `hasVerifierRole`/`hasQaRole`. Gates the bulk-select checkboxes and bulk-action bar entirely
  (hidden, not just disabled) for a non-`technologist` session — `manage_orders` (the API's own
  capability gate on both bulk routes) is granted only to `technologist`
  (`apps/api/src/auth/capabilities.ts`), so a `verifier`-only session would otherwise see controls
  that always 403.
- `apps/web/app/(app)/page.tsx` — fetch `session` (`getSession()`, same helper
  `orders/[id]/results/page.tsx` already uses), compute `canManageOrders =
  hasTechnologistRole(session)`, pass both `canManageOrders` and `currentUserId={session.sub}` into
  `WorklistView`.
- `apps/web/app/(app)/worklist-view.tsx` — add: a checkbox column (wire `DataTable`'s existing
  `selectedRowIds`/`onSelectedRowIdsChange`, only when `canManageOrders`), a bulk-action bar shown
  when `selectedRowIds.length > 0` ("Assign to me" / "Cancel selected", each reporting real
  per-row outcomes per finding #3), an Assignee column (unassigned / "You" / "Assigned", per
  finding #2), and an SLA indicator on the existing TAT column (a `Badge` — not `StatusPill`,
  `frontend-design` entry #1 reserves that for clinical result flags — colored per `slaStatus`:
  `at_risk` amber, `overdue` red/destructive, `on_track` unstyled).

## 3. Architecture consulted

Google Stitch Prompt Library §8.0-8.7 (Work Queue) — read narrowly, same discipline TASK-062's own
proposal already applied against this same document: the full spec names 7 tabs, an avatar-based
assignee picker, live row updates, and a density toggle, none of which this revision builds (no
real data/infra backs any of them, same gap TASK-062 already found and this revision re-confirms
unchanged). What it does take from §8.0/the data-table backbone spec: the checkbox-column +
bulk-action-bar shape itself, and the amber-at-risk/red-overdue color semantics (§0's own palette:
`#D97706`/`#DC2626`, already the exact `--warning`/`--danger` tokens this app's Tailwind theme
defines). `frontend-design` Skill entries #1 (StatusPill reserved for clinical flags),
#6 (`observation.flags` multi-value rendering discipline — not directly applicable here since
`slaStatus` is a single enum, not an array, but the same "render the real computed value, don't
assume a single fixed shape" spirit applies to not hardcoding an on_track-only assumption).
ADR-0024 (accepted) — decisions 2/3 directly govern this revision's assignee UI scope.

## 4. Skills loaded

`engineering/frontend-design` (StatusPill-vs-Badge scoping, WCAG-contrast precedent for colored
chips — TASK-037's own finding on `StatCard`'s delta chip, relevant to the at-risk/overdue Badge
coloring). `engineering/api-design` (read of the two new bulk routes' real request/response shapes,
already implemented in Part 1 — no new backend Skill entry needed, this revision consumes them
as-is).

## 5. Assumptions & autonomous decisions

- Bulk-action bar is built locally in `worklist-view.tsx`, not a new `packages/ui` primitive
  (finding #1) — promoted to a shared component only if a second bulk-selectable screen needs one.
- Assignee column shows exactly three states (unassigned / you / assigned-to-someone-else), no
  attempt to resolve a name for the third state (finding #2, ADR-0024 decision 2).
- "Cancel selected" sends every currently-selected row id in one `bulkCancelSelected` call,
  regardless of stage — the API's own eligibility check (finding #3) is the real filter; the UI
  does not pre-filter the selection to "only ordered-status rows" client-side, since that would
  hide the real ineligible-row feedback the API is specifically designed to report.
- Local state patch on success (finding #4), not `router.refresh()` — cancelled rows are removed
  from the current view; assigned rows have their `assignedUserId` updated in place; both mirror
  `violations-table.tsx`'s exact pattern.
- Selection state (`selectedRowIds`) is cleared after any bulk action completes (success or partial
  success) — a stale selection referencing now-cancelled/removed rows would be confusing to act on
  again.

## 6. Risks

- Real UX gap named plainly, not silently: a partial bulk-cancel (some rows ineligible) needs a
  clear, specific message ("3 of 5 cancelled — 2 were already past the ordered stage"), not a bare
  success/failure toast — get this reviewed in `web-verify`, not just asserted correct from the
  response shape.
- The Assignee column's "Assigned" (third-party) state is a real, known UX dead-end until a
  directory exists (ADR-0024's own named limitation) — worth a one-line tooltip/title attribute
  explaining why no name shows, not left silently unexplained.
- `manage_orders`-gating the whole bulk UI means a `verifier`-only session sees no bulk controls at
  all, not a disabled state — matches `isVerifier`'s own "hidden entirely" precedent (TASK-057
  §10 Q3) deliberately, but worth confirming that reads as "not for your role" rather than "broken"
  in a real `web-verify` pass.

## 7. Acceptance criteria

- [ ] A `technologist`-roled session sees a checkbox column and can select one or more rows;
      a `verifier`-only session sees neither the checkboxes nor the bulk-action bar at all.
- [ ] Selecting rows reveals a bulk-action bar with "Assign to me" and "Cancel selected"; both
      report real per-row outcomes (counts of what succeeded vs. was skipped and why).
- [ ] "Assign to me" updates the Assignee column to "You" for every successfully-assigned row,
      without a full page reload.
- [ ] "Cancel selected" removes successfully-cancelled rows from the current view immediately,
      leaves ineligible rows visible and unchanged, and states clearly which rows were skipped.
- [ ] The TAT column visibly distinguishes `at_risk` (amber) and `overdue` (red) from `on_track`,
      matching the real `slaStatus` value from the API — provable against a real seeded fixture,
      not just visual inspection.
- [ ] Dark mode, keyboard navigation (checkbox selection and bulk-action buttons reachable and
      operable without a mouse), and zero console/page errors confirmed via a real `web-verify`
      pass.

## 8. Testing plan

No new `apps/api` e2e coverage (Part 1 already covers the API surface this revision consumes
as-is). A real `web-verify` headless-browser pass (Docker/Postgres/Keycloak): seed a real
multi-status, multi-priority worklist fixture including at-risk/overdue-aged STAT rows (backdated
`createdAt`, same technique `worklist.e2e-spec.ts`'s own SLA tests already use); as a
`technologist`-roled session, select a mixed batch (some `ordered`, some `in_process`), run
"Cancel selected," confirm the `ordered` rows disappear and the response correctly reports the
`in_process` ones as skipped; run "Assign to me" on a fresh selection, confirm the Assignee column
updates to "You" without a reload; confirm the at-risk/overdue Badge colors render correctly in
both light and dark mode; as a `verifier`-only session, confirm no checkboxes or bulk-action bar
render at all; confirm zero console errors throughout. `packages/ui`'s existing Storybook/axe CI
check is unaffected (no new `packages/ui` primitive added, per §5).

## 9. Rollback plan

Purely additive/UI-layer — no schema, no API, no migration (Part 1 already merged and is
unaffected by reverting this revision). Revert the PR; the worklist screen returns to Part 1's own
read-only shape (SLA/assignee data still present in the API response, just not rendered or
actionable).

## 10. Questions requiring human approval

**Q1 — Partial bulk-cancel feedback: an inline summary banner, or a per-row indicator?**
- (a) **[Recommended]** An inline summary banner above the table after the action completes (e.g.
  "3 cancelled, 2 skipped — already past the ordered stage"), auto-dismissing or dismissible —
  simplest, matches `violations-table.tsx`'s own per-row inline error precedent scaled to a batch
  result, no new persistent UI state to manage.
- (b) A per-row indicator (e.g. a small icon/tooltip on each skipped row) — more precise but a
  real new UI pattern this table doesn't have anywhere else yet.

**Q2 — Should the bulk-action bar also expose the individual per-row Verify/finalize actions
`results-grid.tsx` already has, or stay scoped to assign/cancel only?**
- (a) **[Recommended]** Scoped to assign/cancel only — the only two bulk actions this feature's own
  AC and Part 1's own API actually support; per-row result entry/verification already has its own
  real, dedicated screen (`results-grid.tsx`) this revision doesn't duplicate or shortcut.
- (b) Add a "Go to results" bulk shortcut for the current selection (e.g., open the first selected
  row's results screen) — a real, if minor, convenience not asked for by this feature's AC.
