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

---

# Revision: TASK-062 — Worklist UI (tabs, filters, priority, TAT)

Status: **IMPLEMENTED** — `apps/web/app/(app)/page.tsx` replaced, `worklist-view.tsx`,
`active-filters.tsx`, `lib/format-duration.ts` added. FEAT-017 (#26) is now fully implemented — both
named tasks (TASK-061 #120/PR #346, TASK-062 #121) done.
§10's open questions were resolved by the human via the native options-prompt, recommended option
chosen for each: Q1 **replace `apps/web/app/(app)/page.tsx` directly**, no new `/worklist` route.
Q2 **status-conditional row-click destination**. Q3 **plain formatted duration text only**, no color
urgency cue. Q4 **URL-searchParams-driven Server Component**, same convention as `orders/page.tsx`.

**Verified end-to-end via a real `web-verify` headless-browser pass** (Docker/Postgres/Keycloak, a
compiled `apps/api` server, real fixtures driven through the actual order/reception/result-entry/
finalize/cancel endpoints — not assumed from code review): stage counts render correctly (Pending 6,
In Progress 2, Verified 2 against the seeded fixture); each `StatCard`/tab correctly filters via the
URL; the priority filter and its `ActiveFilters`/`FilterBar` removable chip both work; an
`'in_process'` row's click lands directly on the real results grid showing the correct drafted value
(Sodium, 140, flag N) — the literal one-click path satisfying "two clicks or fewer"; a `'resulted'`
row's click lands on the real report viewer, correctly showing `PRELIMINARY`/"0 of 1 result verified"
(a `'resulted'` `ordered_test` means every analyte is at least finalized, per TASK-061's own §10 Q1 —
not the same as the report's own `FINAL` status, which needs full per-analyte verification; both
screens agree, not a contradiction). Dark mode renders correctly. Zero console/page errors in the
final clean run.

**Real, load-bearing correction to this revision's own §1 finding #4, caught only by driving the
actual page, not assumed from `results-grid.tsx`'s code:** `results-grid.tsx` has no focus-on-mount
behavior — its `.focus()` calls only ever fire in response to an action (advancing to the *next*
enterable row after a finalize), never automatically on initial page load. The "two clicks or fewer"
AC is still satisfied literally (a single row click is one click, and the field is immediately
visible and one `Tab`/click away — no click is spent reaching the page itself), but this revision's
own finding #4 overstated it as "landing keyboard-ready per TASK-052's own auto-focus" — corrected
here, not silently left inaccurate.

**Real, minor finding from the verification pass itself, not a regression:** a Playwright-driven
click sequence that mixes a client-side `Link`/`router.push()` navigation followed immediately by a
full-page form submission (stage tab → priority filter, back-to-back) triggers a one-time React
hydration-mismatch console warning on the `createdFrom`/`createdTo` date inputs
(`style={{caret-color:"transparent"}}`, injected by Chromium's own native date-input rendering, not
by any application code). Confirmed non-regression by direct isolation: neither the identical
`orders/page.tsx` date-input markup under the same interaction sequence, nor this same worklist page
driven in a single fresh browser context, reproduces it — only the specific "client nav, then form
nav, same page instance" sequence does. Cosmetic only (React explicitly logs "this won't be patched
up"; the DOM keeps the browser's own value), no functional impact observed across the whole
verification pass. Not fixed — a browser-native input-styling quirk outside application code's
control, the same class of "known, sandbox/browser-specific quirk, not a real code bug" this Skill's
own doc already carries an example of (the Turbopack prerender quirk).

Date: 2026-08-07    Backlog ID: FEAT-017 (#26) / TASK-062 (#121)

## 1. Goal

TASK-061 is merged (`eaaa9d7`, PR #346, deployed to staging) — `GET /v1/worklist` is real. TASK-062
is FEAT-017's second and last task. Its own issue text (#121): "Worklist UI (tabs, filters, priority,
TAT)." FEAT-017's AC: "Worklist returns correct counts per stage" (already proven by TASK-061's own
e2e suite) and **"A technologist goes from login to entering a result in two clicks or fewer"** —
this task's own literal AC to satisfy.

**Real, load-bearing finding #1 — Stitch §8.0's own "Work Queue (master)" prompt describes a much
larger surface than TASK-061's real API backs, and building the full prompt now would be
speculative.** §8.0 names 7 tabs (Pending/In Progress/Waiting Verification/Verified/Approved/
Rejected/Critical Results), an assigned-user avatar column with click-to-reassign, SLA-color-coded
TAT (amber at-risk, red-pulse overdue), bulk assign/transition/print actions, live row updates, a
density toggle, and saved views. None of these are backed by real data or infrastructure today:
TASK-061's proposal findings #2/#4 (this same document, above) already confirmed no TAT/SLA/
target-minutes column and no user/assignment table exist anywhere in this schema; no real-time
transport (websocket/SSE/polling) exists anywhere in this repo; `apps/api` has no bulk-mutation
route for `ordered_test`. Read the same way TASK-058 read KB-12's full template-engine vision
against FEAT-032's later, separate scope: this task builds exactly the 3 stages TASK-061's API
actually counts (pending/in-progress/verified) plus an "All" view, the 3 real filter dimensions the
API actually accepts (stage, priority, date range — no assignee/discipline/facility filter, none of
which exist), and the one column set the API actually returns. "Critical Results" as its own tab is
a real, named gap this leaves open, not silently dropped — flagged in §6 Risks.

**Real, load-bearing finding #2 — `FilterBar` and `StatCard` (TASK-035/036) have zero real
consumers anywhere in `apps/web` today.** Grepped every non-Storybook `.tsx` file under `apps/web`:
`FilterBar` appears only in its own Storybook story; `StatCard` likewise. `patients/page.tsx`'s own
comment explicitly declined `FilterBar` for that screen ("a two-attribute filter panel was judged
marginal value for this task's sizing") — not a rejection of the primitive itself. The worklist has
4 real, independent filter dimensions (stage, status, priority, date range) and 3 real per-stage
counts to display — a materially stronger case than patients' own 2-attribute screen. This task is
their first real consumer, the same "built but never consumed until X" pattern `StatusPill` went
through before TASK-057.

**Real, load-bearing finding #3 — the app's current home route is a placeholder, and FEAT-017's own
issue text names this task's destination directly.** `apps/web/app/(app)/page.tsx` (confirmed by
direct read) renders only "Signed in" plus the raw session `sub`/`tenantId` — no real content.
FEAT-017's own issue body (#26): "The technologist's home screen — without it, result entry has no
usable entry point." Read together, this is unambiguous: TASK-062 replaces `(app)/page.tsx`'s
content, not a new URL (§10 Q1 still poses this as a real choice, since a distinct `/worklist` route
has genuine future value for nav-linking, but "replace the placeholder home" is the literal, narrow
reading of both the issue text and finding #6 from TASK-061's own proposal above).

**Real, load-bearing finding #4 — the literal "two clicks or fewer" AC is only achievable with
status-conditional row navigation, not one fixed destination.** The worklist API's own `pending`
bucket groups two real statuses that are *not* equally actionable:
`observation.controller.ts`'s own `ENTERABLE_ORDERED_TEST_STATUSES` guard (confirmed by direct read)
accepts only `'received'`/`'in_process'` for result entry — a plain `'ordered'` row (not yet
received) has no results screen to usefully land on yet. A single fixed row-click target can
therefore never be *both* always-valid and one-click-to-result-entry for the common case. Each
worklist item already carries its own real `status` (not just its bucket), so the row click can
branch on it directly — see §10 Q2.

## 2. Affected files

- `apps/web/app/(app)/page.tsx` — replaced with the real worklist screen (§10 Q1).
- `apps/web/app/(app)/worklist-view.tsx` (new) — the client island: tabs, filter form results,
  `DataTable`, row-click routing. Mirrors `orders-table.tsx`'s "thin client island" shape.
- `apps/web/lib/format-duration.ts` (new, small) — formats `ageMinutes` as human-readable text
  (e.g. "2h 15m"), consumed by the TAT column.
- No `apps/api`/`packages/domain`/`packages/db` changes — TASK-061's API is consumed as-is.
- No `openapi.json`/SDK regeneration needed (no new/changed route).

## 3. Architecture consulted

Stitch Prompt Library §8.0 ("Work Queue master") and Pattern E — read narrowly per finding #1.
KB-26 Task Management (already loaded for TASK-061; unchanged). This document's own TASK-061
revision (proposal findings #1–#6) — the authoritative source for exactly what the API returns.

## 4. Skills loaded

`engineering/frontend-design` (StatusPill-vs-Badge scoping, TASK-037's a11y-contrast findings on
`StatCard`'s own delta chip, general primitive-usage conventions). `engineering/api-design`
(read-only, gate-free consumption pattern already used by `orders/page.tsx`/`patients/page.tsx`).

## 5. Assumptions & autonomous decisions

- Status badges render the raw lowercase enum value (`ordered`, `received`, ...), matching
  `orders-table.tsx`'s own established convention — no new label-mapping layer.
- `Badge`, not `StatusPill`, for status/priority — `frontend-design` entry #1 reserves `StatusPill`
  for clinical result flags (N/L/H/LL/HH), not general resource status; same reasoning
  `orders-table.tsx`/`collection-queue-table.tsx` already documented.
- The 3 `StatCard`s (Pending/In Progress/Verified) double as the stage-tab controls — each wrapped
  in a plain `<Link>` setting `?stage=...`, rather than building a separate tab-strip component and
  a redundant counts row. A 4th "All" link (no `stage` param) sits alongside them.

## 6. Risks

- "Critical Results" as a distinct tab/filter (Stitch §8.0) is real, out-of-scope-for-now surface —
  `observation.flags` (HH/LL) exists and is already GIN-indexed (TASK-050), but `GET /v1/worklist`
  does not expose or filter on it today. A future task can extend the API and this UI together if
  triage-by-criticality becomes a real, named need.
- No live/real-time updates — a technologist must reload/re-navigate to see new work; acceptable for
  v1 given zero real-time transport exists anywhere in this repo today.
- No assignee/claim workflow — every technologist sees the same tenant-wide worklist; matches the
  already-established finding that no user/assignment table exists yet.

## 7. Acceptance criteria

- [ ] The app's home route (`/`) shows the real worklist, not the "Signed in" placeholder.
- [ ] Stage counts render correctly and match `GET /v1/worklist`'s own `counts` field.
- [ ] Tabs (`All`/`Pending`/`In Progress`/`Verified`) filter the table correctly.
- [ ] Priority and date-range filters combine correctly with the active tab.
- [ ] A `'received'`/`'in_process'` row's click navigates directly into the keyboard-ready results
      grid — the literal "two clicks or fewer" AC, provable with a real headless-browser pass.
- [ ] Dark mode, keyboard navigation, and zero console/page errors confirmed via a real `web-verify`
      pass (Docker/Postgres/Keycloak already proven reachable this session).

## 8. Testing plan

No new `apps/api` e2e coverage needed (no backend change). A real `web-verify` headless-browser pass
(Docker/Postgres/Keycloak already up this session): load the worklist as a real `technologist`
session, confirm stage counts match a known fixture, click through each tab and filter combination,
confirm a `'received'` row's click lands directly in the results grid with the first enterable field
focused (TASK-052's own auto-focus behavior), confirm dark mode and zero console errors.
`packages/ui`'s existing Storybook/axe CI check (TASK-037) covers `FilterBar`/`StatCard` in
isolation already — no new story needed unless a real gap is found.

## 9. Rollback plan

Purely additive/replacement at the UI layer only — no schema, no API, no migration. Revert the PR;
`apps/web` returns to the placeholder home screen.

## 10. Questions requiring human approval

**Q1 — Does this replace the app's home route directly, or become a new dedicated `/worklist`
route?**
- (a) **[Recommended]** Replace `apps/web/app/(app)/page.tsx` directly — it's already the literal
  home route, and FEAT-017's own issue text calls this "the technologist's home screen." No redirect
  indirection.
- (b) A new dedicated `/worklist` route; `(app)/page.tsx` redirects to it — gives it a stable,
  bookmarkable URL distinct from `/`, useful if a future sidebar nav wants an explicit "Worklist"
  link highlighted separately from a generic "home" concept.

**Q2 — Row-click destination: one fixed target, or status-conditional?**
- (a) **[Recommended]** Status-conditional (finding #4): `'ordered'` → order detail page
  (`/orders/{orderId}`, not yet receivable-into-results); `'received'`/`'in_process'` → the results
  grid (`/orders/{orderId}/results`) — the literal two-click AC path, landing keyboard-ready per
  TASK-052's own auto-focus; `'resulted'` → the report viewer (`/orders/{orderId}/report/
  {orderedTestId}`, FEAT-016). `'cancelled'`/`'rejected'` (filter-only) → order detail.
- (b) Always navigate to the order detail page — simplest and always valid, but adds an extra click
  beyond order detail to reach result entry for the common case, missing the literal AC.

**Q3 — TAT display: plain formatted duration only, or a visual urgency cue?**
- (a) **[Recommended]** Plain formatted duration text only (e.g. "2h 15m"), no color-coding —
  matches TASK-061's own already-approved "computed elapsed-time only, no stored SLA" decision;
  color-coding now would silently invent an SLA threshold that was explicitly declined.
- (b) A simple client-side-only color threshold (e.g. amber past some fixed minutes), acknowledged
  as a UI-invented heuristic with no real SLA data behind it.

**Q4 — Filters/tabs mechanism: URL-searchParams Server Component, or client-side state?**
- (a) **[Recommended]** URL-searchParams-driven Server Component — plain `<Link>`s for tabs, a plain
  form for priority/date filters, identical convention to `orders/page.tsx`/`patients/page.tsx`; no
  new client-state pattern introduced, filters stay bookmarkable/shareable.
- (b) Client-side tab/filter state (no full navigation per click) — snappier, but diverges from
  every existing filtered-list page's convention in this repo and loses bookmarkability.
