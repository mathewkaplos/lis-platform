# Implementation Proposal: FEAT-017 Minimal worklist

Status: **IMPLEMENTED** — TASK-061 delivered: `GET /v1/worklist`
(`apps/api/src/worklist/worklist.controller.ts`), `packages/domain/src/worklist.ts`,
`apps/api/test/worklist.e2e-spec.ts` (5 new tests, real HTTP/Postgres/Keycloak). TASK-062 (worklist
UI) remains — FEAT-017 itself stays open until both tasks are done.
§10's open questions were resolved by the human via the native options-prompt, recommended option
chosen for each: Q1 **`pending` = `ordered`+`received`, `in-progress` = `in_process`, `verified` =
`resulted`**, cancelled/rejected excluded from counts. Q2 **computed elapsed-time TAT only**, no
stored SLA/target-minutes concept. Q3 **cancelled/rejected excluded from the response by default**,
with an optional status filter to include them. Q4 **one combined response** (`{ counts, items }`),
not two separate routes.

**Real, load-bearing finding from implementation, not anticipated when this proposal was drafted:**
a single query capped at `WORKLIST_RESULT_LIMIT` across the *whole* default active set silently
starves the smaller stages once one status dominates — confirmed directly, not assumed, against
this local DB's own accumulated e2e fixture data (116 `'ordered'` rows vs. 25 `'in_process'` after
repeated test runs; a completely realistic real-lab backlog shape too, not a test-only artifact,
since `'ordered'`-status rows are the input funnel and naturally outnumber later stages). Fixed by
querying and capping each of the 3 counted buckets independently in the default (unfiltered) view,
then merging — a large pending backlog can no longer crowd `in_process`/`verified` items out of the
response. An explicit `stage`/`status` filter still uses a single capped query (no crowding risk
within one bucket). The residual case — a single bucket itself exceeding
`WORKLIST_RESULT_LIMIT` (100) — is an accepted, already-precedented limitation of this repo's
fixed-cap-no-cursor-pagination design (ADR-0013 §Decision 4, same as `order`/`patient` search today),
not something this task's scope extends to solving.
Date: 2026-08-07    Backlog ID: FEAT-017 (#26) / TASK-061 (#120)

## 1. Goal

FEAT-016 (Minimal report, #25) is fully merged and closed. FEAT-017 (Minimal worklist, #26, M4,
EPIC-004) is next — its one dependency, FEAT-014 (Result entry engine), is fully merged. FEAT-017
names two tasks (TASK-061 query API, TASK-062 worklist UI). **This proposal's approvable scope is
TASK-061 only** — the same scope-narrowing precedent every prior feature in this repo has used.
TASK-062 will be specified as a revision to this same file once TASK-061's real output exists.

TASK-061's own issue text (#120): "Worklist query API with filters + TAT." FEAT-017's stated
acceptance criteria (#26) are: "Worklist returns correct counts per stage
(pending/in-progress/verified)" and "A technologist goes from login to entering a result in two
clicks or fewer." The second AC is UI-level and inherited context, not something TASK-061 alone
delivers — this proposal treats it as informing TASK-061's response shape (a landing-page-ready
single call, see finding #6) and performance, not as a literal TASK-061 deliverable.

**Real, load-bearing finding #1 — the schema/domain comments claiming `ordered_test.status` only
ever writes `'ordered'`/`'cancelled'` are stale and directly contradicted by already-merged code.**
`packages/db/src/schema/order.ts:51-53` and `packages/domain/src/order.ts:20-21` both state "TASK-042
... writes only 'ordered' (create) and 'cancelled' (cascade cancel) — the remaining values are
reserved for later features." Checked directly against real handler code, not assumed correct from
the comment: `'received'`/`'rejected'` are written by `apps/api/src/specimen/specimen.controller.ts:197`
(TASK-047 reception); `'in_process'` by `apps/api/src/observation/observation.controller.ts:634`
(TASK-051 draft-save); `'resulted'` by
`apps/api/src/observation/finalization-rollup.interceptor.ts:147` (TASK-056 roll-up, gated on
Constitution Law #3's critical-acknowledgement check, lines 129-143). So **6 of the 9 canonical
values are already real** (`ordered`, `received`, `rejected`, `in_process`, `resulted`, `cancelled`);
only `'collected'` and `'reported'` are never written anywhere. `ordered_test` itself never reaches a
literal `'verified'` status — verification is tracked at `observation.status` only, and
`finalization-rollup.interceptor.ts:104-107`'s own comment explains why `'resulted'` already requires
every analyte to be `'preliminary'` **or** `'verified'`, not that the ordered_test row itself gets a
`'verified'` status. This directly shapes Q1 below.

**Real, load-bearing finding #2 — no TAT/deadline/SLA column exists anywhere.** Grepped
`packages/db/src/schema/`, `apps/api/src/`, `packages/domain/` for `TAT|turnaround|deadline|sla` —
zero hits. The only timestamps available to derive TAT are `order.createdAt`, `specimen.collectedAt`/
`receivedAt`, `observation.producedAt`/`verifiedAt`/`createdAt` — all real, none purpose-built for
TAT. "TAT" in TASK-061's own title must therefore be a query-time-computed elapsed-time field, not a
stored one, unless the human wants a stored target/threshold concept introduced now (Q2).

**Real, load-bearing finding #3 — `priority` exists only on `order`, not `ordered_test`.**
`packages/db/src/schema/order.ts:38,43` (`'routine'|'stat'`, TASK-042). A worklist row showing an
ordered_test's priority must join up to its parent `order` — there is no ordered_test-level override.

**Real, load-bearing finding #4 — no user/assignment table exists anywhere in this schema.**
`apps/api/src/auth/request-context.ts` carries only JWT `sub`/`tenantId`/`roles` — no persisted,
joinable user row. `observation.operatorUserId`/`verifierUserId` and `report.generatedByUserId` are
all bare, FK-less `uuid` columns with an explicit "no FK: no user table exists yet (M2)" comment.
"Assigned to me" filtering therefore has no real FK-backed home today; out of scope for TASK-061
unless the human wants it introduced now — not raised as an open question below since neither
TASK-061's issue text nor FEAT-017's AC asks for per-user assignment, only stage counts and a fast
path to result entry.

**Real, load-bearing finding #5 — the closest existing precedent is `OrderController.search()`.**
`apps/api/src/order/order.controller.ts:230-304` + `orderSearchQuerySchema`
(`packages/domain/src/order.ts:99-106`): tenant-scoped via `TenantContextInterceptor`/RLS (no manual
`tenantId` filter — confirmed by `order.controller.ts:319`'s own comment, "RLS makes a cross-tenant
row structurally invisible"), optional AND-combined filter conditions built as an array and filtered
for `undefined`, a fixed-cap result limit (`ORDER_SEARCH_RESULT_LIMIT = 100`, no cursor pagination —
`engineering/api-design` entry #4, ADR-0013 §Decision 4, still deferred), batch N+1-avoiding
resolution via `inArray()` + in-memory `Map`s (no `.innerJoin()` precedent anywhere in this repo), and
`@ZodResponse`/`createZodDto` for both request validation and OpenAPI generation. TASK-061 should
follow this exact shape, with a **new** `packages/domain/src/worklist.ts` file (not extending
`order.ts`) — matching the per-aggregate file convention already used for `order.ts`/`specimen.ts`/
`observation.ts`/`catalog.ts`, and directly anticipated by `order.ts:96-97`'s own comment: "that's
worklist-level (FEAT-017+), not built ahead of a real need."

**Real, load-bearing finding #6 — `apps/web`'s current home page is a placeholder.**
`apps/web/app/(app)/page.tsx` renders only "Signed in" plus `session.sub`/`tenantId` — confirming
FEAT-017's "two clicks" AC is about TASK-062 replacing this placeholder as the app's real landing
page. TASK-061's response shape should therefore be efficient for an unfiltered landing-page load
(counts + a default row set in as few round trips as practical), not only for an on-demand filtered
search — informs Q4 below.

## 2. Affected files

New:
- `packages/domain/src/worklist.ts` — `worklistQuerySchema` (filters, mirroring
  `orderSearchQuerySchema`'s optional-AND shape: stage/status, priority, `createdFrom`/`createdTo`),
  `worklistItemSchema` (per-ordered_test row: id, orderId, patient summary, test display name, status,
  priority (from parent order), `createdAt`, computed elapsed-time/TAT field), `worklistCountsSchema`
  (per-stage counts, per Q1's resolved bucket mapping).
- `apps/api/src/worklist/worklist.controller.ts` — new controller (route shape per Q4).
- `apps/api/src/worklist/worklist.module.ts` (matching `order.module.ts`'s per-feature-module
  convention).
- `apps/api/test/worklist.e2e-spec.ts`.

Modified:
- `apps/api/openapi.json`, `packages/sdk/src/schema.ts` — regenerated for the new route(s); now
  CI-enforced as of PR #343 (merged this morning, closes the #292 drift gap this repo has hit
  proactively-avoided-by-memory across TASK-051/052/060).
- `packages/db/src/schema/order.ts:51-53`, `packages/domain/src/order.ts:20-21` — stale-comment fix
  (finding #1), same PR (§5).

## 3. Architecture consulted

KB-26 Task Management — distinguishes **worklist** (a live, parameterised query over operational
state, no stored rows) from **Task** (a discrete, assigned, SLA-tracked record with its own
lifecycle). This proposal builds the worklist half only; KB-26's Task-record/assignment/
escalation machinery is out of scope — no AC here asks for it, and KB-26 itself scopes that
separately (notification delivery, SLA escalation are named as explicitly out of *its own* scope
too, deferred to `34-notification-system.md`/later features). KB-03 Business Workflows
(`03-business-workflows.md:68-73`, the canonical OrderedTest state machine). ADR-0010 (RLS
tenant-context binding — reused unchanged, no new pattern needed). ADR-0011 (Keycloak realm-role
model — relevant only if stage/queue visibility should be role-aware, not currently required by
either AC).

## 4. Skills loaded

`engineering/api-design` (nestjs-zod DTO pattern, `@ZodResponse`, the no-join batch-resolve
convention, `TenantContextInterceptor` usage). `engineering/database-design` (index planning for a
filtered, sorted query over `ordered_test`/`order` — `ix_ordered_test_order` already exists,
`order.createdAt` is unindexed today and this task's own sort-by-age access pattern may want one,
folded into Q1/implementation, not a separate open question since it's a pure performance
implementation detail with no external-behavior tradeoff).

## 5. Assumptions & autonomous decisions

- New `packages/domain/src/worklist.ts` file, not extending `order.ts` — matches this repo's
  per-aggregate file convention and `order.ts`'s own comment anticipating this exact task.
- Read-only, no capability gate (`@UseGuards(JwtAuthGuard)` only) — matches `OrderController.search()`'s
  own gate-free read precedent (also `GET /v1/catalog`); a worklist view has no clinical-write side
  effect.
- No cursor pagination — reuses the fixed-cap-limit precedent (ADR-0013 §Decision 4), revisited later
  if real order volume needs it, same as `order`/`patient` search today.
- The stale `'ordered'`/`'cancelled'`-only comments in `order.ts`/`domain/order.ts` (finding #1) are
  fixed in the same PR — a small, directly-verified, low-risk drive-by correction, not routed to a
  human decision (matching the "real bug found and fixed proactively" precedent already set by
  TASK-051's `UPDATE`-keying bug and TASK-055's nestjs-zod `extends` bug, both fixed in-flight once
  directly confirmed, not just flagged).

## 6. Risks

- Stage-count AC ("pending/in-progress/verified") needs an explicit bucket mapping since the real
  9-value enum has no literal `"pending"` value and `ordered_test` never reaches a literal
  `"verified"` status (finding #1) — resolved via Q1, not assumed.
- No TAT/deadline column exists — if the human wants a stored SLA/target-time breach flag (not just
  raw elapsed time), that is a real, if small, schema addition this proposal does not currently scope
  (Q2).
- `order.createdAt` has no index today; a worklist sorted/filtered by age at real volume may want one
  — noted for implementation, not a behavior-changing decision.

## 7. Acceptance criteria

- [ ] Response rows are scoped to the authenticated tenant only (RLS-proven — a second-tenant fixture
      must never appear, not just "no manual filter needed").
- [ ] Stage counts (per Q1's resolved bucket mapping) are correct against a real multi-status fixture,
      proven by direct DB count comparison, not only trusted from the response shape.
- [ ] A TAT/elapsed-time field is present per row, computed from real timestamps.
- [ ] Filters (status/stage, priority, date range at minimum, mirroring `orderSearchQuerySchema`'s
      shape) combine correctly with AND.
- [ ] `openapi.json`/`packages/sdk/src/schema.ts` regenerated and committed (now CI-enforced, PR #343).

## 8. Testing plan

New `apps/api/test/worklist.e2e-spec.ts`: seed `ordered_test` rows spanning the six real-written
statuses (`ordered`, `received`, `rejected`, `in_process`, `resulted`, `cancelled`) by driving through
the existing order/reception/result-entry/finalize endpoints (not direct DB insert), the same
"prove against this app's own real state-transition code" discipline TASK-052 already used; assert
stage counts, filter combinations, tenant isolation (a second-tenant fixture proving cross-tenant
invisibility), and TAT field correctness against known elapsed time. Full existing `apps/api` e2e
suite re-run for zero regression (this task adds a new read-only route, touches no existing write
path except the two stale-comment lines).

## 9. Rollback plan

Purely additive (new file, new route(s), no migration, no schema change under the base resolution) —
revert the PR; zero data-shape risk. The stale-comment fix (finding #1) is also trivially revertible
independent of the rest.

## 10. Questions requiring human approval

**Q1 — Stage-count bucket mapping.** The real 9-value `ordered_test.status` enum has 6 values
actually written today (`ordered`, `received`, `rejected`, `in_process`, `resulted`, `cancelled`) and
never reaches a literal `'verified'` value at the ordered_test grain (finding #1).
- (a) **[Recommended]** `pending` = `ordered` + `received` (result entry not yet started);
  `in-progress` = `in_process`; `verified` = `resulted` (already means "every analyte finalized and
  every critical acknowledged," per Constitution Law #3 enforcement in
  `finalization-rollup.interceptor.ts` — the closest real analog to "verified" at this grain).
  `cancelled`/`rejected` excluded from all three counted buckets (visibility per Q3).
- (b) Add a 4th "awaiting verification" bucket distinguishing `resulted`-but-some-analytes-still-
  `preliminary` from fully `verified` analytes, requiring a per-row join into `observation.status`.
- (c) Read "verified" literally and strictly: only count as verified when 100% of an ordered_test's
  analytes have `observation.status = 'verified'` (stricter than `resulted`, which accepts
  `preliminary` too) — a currently-unexposed condition needing a live per-row analyte check.

**Q2 — TAT scope: computed field only, or a stored target/deadline too?**
- (a) **[Recommended]** Computed only: return elapsed-minutes-since-`createdAt` (or since
  `specimen.receivedAt` where available) per row; no new column, no SLA/breach-threshold concept —
  matches this repo's "don't build ahead of a real need" precedent, and KB-26 explicitly scopes
  SLA/escalation to a separate, later concern.
- (b) Add a stored per-priority target-minutes config (e.g. STAT = 60min, routine = 1440min) plus a
  computed `isBreached` boolean — more immediately useful for TASK-062's UI, but a real new piece of
  config/schema this task's issue text doesn't explicitly ask for.

**Q3 — Does the worklist response include `cancelled`/`rejected` rows at all?**
- (a) **[Recommended]** Excluded by default (a worklist is "what's pending/active," not a full audit
  log — `order` search already exists for that), with an optional status filter value to include them
  on request.
- (b) Included always, left for TASK-062's UI to filter out client-side.

**Q4 — One combined endpoint, or two separate routes?**
- (a) **[Recommended]** Single combined response (`{ counts, items }`) — one round trip for a
  landing-page load (finding #6: TASK-062 will need both simultaneously on first paint), closer to
  `GET /v1/catalog`'s "one full snapshot" shape than to `order` search's narrower filtered-list-only
  shape.
- (b) Two separate routes (`GET /v1/worklist`, `GET /v1/worklist/counts`), mirroring
  `order.controller.ts`'s one-concern-per-route convention more literally.
