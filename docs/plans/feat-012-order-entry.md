# Implementation Proposal: FEAT-012 Order entry
Status: IMPLEMENTED — all three tasks merged (TASK-042 `eb41052`, TASK-043 `43653ce`, TASK-044
`0aee3bc`). FEAT-012 (#21) and TASK-044 (#103) both closed 2026-08-04.
ADR: none — action sub-resources for lifecycle transitions are already KB-08's stated convention,
and ADR-0013 §5 explicitly says the first task introducing one should follow KB-08 directly, no
new ADR needed for that specific point. §10 Q2 (Idempotency-Key) resolved as continued deferral,
matching ADR-0013 §4's existing framing — no new ADR triggered.
Date: 2026-08-04    Backlog ID: FEAT-012 (#21) / TASK-042 (#101)

## 1. Goal

FEAT-011 (patient management) is fully closed — all four tasks merged, the feature and its last
task closed via comment 2026-08-03. EPIC-003 (Pre-Analytical Workflow) names three features in
sequence: FEAT-011 (done), FEAT-012 (this proposal), FEAT-013 (accessioning/labels/reception,
not started). FEAT-012's own stated dependency, FEAT-011, is satisfied. TASK-042 is FEAT-012's
first task, and TASK-043/TASK-044 (both frontend) depend on its actual endpoint shape in ways not
responsibly knowable yet — same scope-narrowing precedent every prior proposal in this repo has
used (FEAT-010 §1, FEAT-011's four revisions).

**This proposal's approvable scope is TASK-042 only.** TASK-043 (order builder UI) and TASK-044
(order list/detail screens) will be specified as revisions to this same file once TASK-042's real
response shapes exist, matching FEAT-011's own revision-per-task structure.

Confirmed directly, not assumed: `order`/`ordered_test` exist in `packages/db/src/schema/order.ts`
(created by TASK-023, FK-backfilled onto `patient` by TASK-038) but have never been written to by
any real code path — no controller, no domain Zod schema, nothing in `packages/domain` or
`apps/api` references either table today. This is the first task to give either table real
read/write behavior.

**Real, load-bearing finding from this proposal's own research, not present in TASK-042's issue
text:** FEAT-012's own feature-level acceptance criterion says "Order list filters correctly by
status, priority, and date range" — but `order` (`packages/db/src/schema/order.ts:21-33`) has no
`priority` column. Its own header comment states this was a deliberate exclusion by FEAT-006's
proposal ("Scope deliberately excludes priority, clinical notes, diagnosis codes, billing linkage,
and ordering-provider reference — none has consuming code or a catalog table yet anywhere in this
repo"), correct at the time (M1, no order-consuming feature existed yet). That condition no longer
holds: FEAT-012 is exactly the first order-consuming feature, and its own AC now requires
`priority`. No task in FEAT-012's three-task list (TASK-042/043/044) is separately chartered to
add it, and TASK-044 (the list screen the AC describes) has no task of its own that could add a
column. Left unaddressed, TASK-044 would be asked to filter on a field that doesn't exist. See §5
for the proposed fix (a small additive migration, included in this task's own scope) and §10 for
why this is resolved autonomously rather than escalated.

## 2. Affected files

- `packages/db/src/schema/order.ts` — `order` gains a `priority` column (`text`, `NOT NULL`,
  default `'routine'`); its header comment updated to remove "priority... deferred" now that this
  task adds it. `ordered_test`'s `status` default stays `'pending'` at the column-default level
  (Postgres) but this task's own insert path always supplies `'ordered'` explicitly per KB-03 (§5)
  — the column default is only ever hit by a future direct-insert path this task doesn't add.
- `db/migrations/0013_order_priority.sql` (new, `drizzle-kit generate` output — an `ADD COLUMN...
  DEFAULT` on an existing, currently-empty-in-every-real-environment table; additive, no backfill
  needed since no `order` row has ever been written by real code).
- `packages/domain/src/order.ts` (new) — Zod schemas: `orderCreateSchema` (`patientId` +
  `testDefinitionIds`/`panelIds`, at least one non-empty), `orderedTestSchema`, `orderSchema` (full
  persisted shape incl. nested `orderedTests`), `orderSearchQuerySchema` (`status`/`priority`/
  `patientId`/date-range filters), `orderPrioritySchema` (`'routine'|'stat'`). Same "one schema,
  three consumers" pattern as `packages/domain/src/patient.ts` (`engineering/api-design` Skill
  entry #1).
- `packages/domain/src/index.ts` — `export * from "./order"`.
- `apps/api/src/auth/capabilities.ts` — `Capability` gains `'manage_orders'`, granted to
  `technologist` and `verifier` (both existing roles), matching `manage_patients`'s own precedent
  and rationale exactly (§5).
- `apps/api/src/order/order.controller.ts` (new) — `POST /v1/orders`, `GET /v1/orders`, `GET
  /v1/orders/:id`, `POST /v1/orders/:id:cancel`.
- `apps/api/src/order/order.module.ts` (new), registered in `AppModule`.
- `apps/api/test/order.e2e-spec.ts` (new) — real-Postgres, real-Keycloak-token e2e coverage,
  matching `patient.e2e-spec.ts`'s own standard.

## 3. Architecture consulted

- **FEAT-012 issue (#21) AC**: "Ordering a panel (e.g. lipid panel) creates the correct set of
  ordered_test rows"; "Order cancellation is implemented as an action sub-resource, never a status
  PATCH"; "Order list filters correctly by status, priority, and date range."
- **TASK-042 issue (#101) AC**: "Cancellation is implemented as an action sub-resource, never a
  status PATCH." Dependency `TASK-039` (patient API) — merged.
- **KB-02 Domain Model** (`02-domain-model.md:86`) — the Order aggregate: "Contains:
  `OrderedTest[]`, ordering context (priority, clinical notes, diagnosis codes)..." — confirms
  `priority` is a real, named Order-aggregate field, not an invented one (§1).
- **KB-03 Business Workflows** (`03-business-workflows.md:68-73`) — the canonical `OrderedTest`
  state machine: `ordered → collected → received → in_process → resulted → verified → reported`,
  with a `cancelled` branch **only from `ordered`** (no branch shown from `collected` or later).
  This directly shapes §5's cancel-cascade design and §10 Q1's escalation: cancellation is only
  ever valid pre-collection.
- **KB-03** (`03-business-workflows.md:149`) — `STAT / urgent | order priority | priority worklist
  placement, SLA timers` — confirms `priority` is a real domain concept driving downstream worklist
  behavior (not yet built, FEAT-017+), not a speculative column.
- **KB-08 API Architecture** (`08-api-architecture.md:64-75`) — the literal action-sub-resource
  examples: `POST /observations/{id}:verify`, `POST /orders/{id}:cancel` (this task's exact route,
  named verbatim in the KB). Colon-suffix, not slash-suffix (`/orders/{id}:cancel`, not
  `/orders/{id}/cancel`) — followed literally, per ADR-0013 §5's explicit instruction to use KB-08's
  spec directly for the first such route. See §6 for the one real technical risk this introduces
  (colon-in-path-segment routing).
- **KB-08** (`08-api-architecture.md:95-98`) — "unsafe creating/transition operations (`POST
  /orders`, `:verify`) require an `Idempotency-Key` header" — `POST /v1/orders` is KB-08's own
  literal worked example for mandatory idempotency. This is in tension with ADR-0013 §4's deferral
  ("no endpoint yet has needed one") — TASK-042 is arguably the first endpoint KB-08 itself names by
  example. Not resolved unilaterally; see §10 Q2.
- **ADR-0013** — the API baseline this task builds against (Zod/OpenAPI/RFC 9457/`/v1` prefix,
  `engineering/api-design` Skill). §5 explicitly pre-clears action sub-resources for this task's
  first use, no new ADR needed for that point alone.
- **`packages/db/src/schema/order.ts`** (read in full, §1) — `order`/`orderedTest` current shape;
  `orderedTest` already has an index on `orderId` (`ix_ordered_test_order`) supporting the nested
  read this task's `GET /v1/orders/:id` needs.
- **`packages/db/src/schema/catalog.ts`** (`test-catalog.ts:41-68`) — `panel`/`panelTest` link
  table: a panel's member tests are found via `panelTest.panelId = ? → testDefinitionId`. No
  existing code reads this table yet; this task's create endpoint is its first real consumer.
- **`apps/api/src/patient/patient.controller.ts`** (TASK-039, read in full) — the exact pattern this
  task follows: explicit `new ZodValidationPipe(schema)` at every `@Body()`/`@Query()`/`@Param()`
  call site (`engineering/api-design` entry #8), `{resourceId, before, after}` audited-mutation
  response shape, `RequestWithTx['tx']` via `@DbTx()`, 404-not-403 on cross-tenant `GET :id`.
- **`engineering/api-design` Skill** — loaded in full; entries #1 (one schema, three consumers), #2
  (global RFC 9457, already wired, no new work here), #3 (`/v1` prefix — `orders` is a new resource
  route, gets it), #4 (defer ETag/Idempotency-Key/pagination until a real endpoint needs one —
  directly informs §10 Q2 and §6's pagination note), #5 (audit/capability ordering dependency —
  directly shapes §5), #6 (only mutations audited, not reads), #7 (404 not 403 cross-tenant), #8
  (explicit schema at call site, not relying on `design:paramtypes`), #9 (server-generated
  identifiers use retry-on-violation — not applicable here, no server-generated identifier in this
  task), #10 (boot the real compiled server before considering this "done" — directly informs §8).
- **`domain/patient-identity` Skill** — checked; not directly applicable (order entry doesn't touch
  patient-identity questions), confirms no cross-cutting patient-side change is needed for this
  task.
- **`apps/api/src/auth/capabilities.ts`** (read in full) — `manage_patients`'s exact precedent for
  granting a new capability to both existing roles pending a real registrar role (§5).
- **`apps/api/src/auth/audit.interceptor.ts` / `audit.decorator.ts` / `capability.guard.ts`** (read
  in full) — confirms the audit/capability wiring this task reuses unchanged; no new interceptor or
  guard needed.

## 4. Skills loaded

- `engineering/api-design` — in full, see §3. Directly governs this task's endpoint shape,
  error handling, and audit/capability wiring.
- `rls-multi-tenancy` — re-checked; `TenantContextInterceptor` (ADR-0010) already provides the
  binding this task's endpoints need; `order`/`ordered_test` both already carry `tenant_id` + RLS
  policy from TASK-023's own migration (Constitution Law #4 satisfied from creation, not a
  follow-up). No new RLS work required.
- `database-design` — re-checked; entry #4 ("grep every `.insert(<table>)` call site on a table
  gaining a new FK/column, not just the migration's own tests") applied to §8: confirmed no other
  code anywhere inserts into `order` today (grepped `.insert(order)` — zero hits outside this task's
  own new controller), so the `priority` column addition has no other caller to break.
- `testing` — re-checked; its "verify against the real harness, not a mock" standard shapes §8's
  insistence on a real e2e spec plus a real compiled-server boot check.
- `domain/patient-identity` — checked, not directly relevant to this task (see §3).

## 5. Assumptions & autonomous decisions

- **`order.priority` is added in this task's own migration** (`text NOT NULL DEFAULT 'routine'`,
  domain `'routine'|'stat'`) rather than left for a later task, per §1's finding. Treated as
  reversible/additive (matches `database-design` entry #1's text-discriminator convention already
  used for `patient.sex`/`reference_range.sex`) — not escalated, since leaving it out would make
  FEAT-012's own AC unmeetable by any task in its list, and adding a `NOT NULL DEFAULT`-backed
  column to a table with zero real rows carries no migration risk.
- **`'routine'|'stat'` only, not a wider urgency scale.** KB-03's own variant-workflow row names
  exactly these two ("STAT / urgent | order priority"), and no finer SLA-tier catalog exists yet
  anywhere in this repo (FEAT-017+'s own future scope). Matches this repo's stated aversion to
  designing for hypothetical future requirements; a third tier is additive later if a real need
  appears.
- **`ordered_test.status` is written as `'ordered'` at creation (not the column's own placeholder
  default `'pending'`)** and cancellation writes `'cancelled'` — the two real values KB-03 names for
  this table's lifecycle start/exit-early states. `order.status` itself mirrors `ordered_test`:
  `'pending'` (mixed/no terminal state yet) is replaced with `'ordered'` at creation for the same
  reason. No other status transition (`collected`, `received`, ...) is written by this task — those
  belong to FEAT-013 (reception) and later features.
- **Request shape**: `POST /v1/orders` body is `{ patientId: uuid, testDefinitionIds?: uuid[],
  panelIds?: uuid[] }`, refined to require at least one non-empty array. Each `panelId` is expanded
  server-side (via `panelTest`) into its member `testDefinitionId`s; the result is unioned with any
  directly-supplied `testDefinitionIds` and deduplicated (ordering the same test both directly and
  via a panel creates exactly one `ordered_test` row, not two) — this directly satisfies the AC's
  "creates the correct set of ordered_test rows" for the stated lipid-panel example. Any supplied
  id (test or panel) not visible under RLS (nonexistent or cross-tenant) fails the whole request
  with `400` `problem+json` naming the missing id(s) — no partial order is ever created.
- **New `manage_orders` capability, granted to `technologist` and `verifier`** — identical
  reasoning to `manage_patients` (TASK-039 §10 Q2): no dedicated front-desk/registrar role exists in
  Keycloak yet; inventing one is a separate infra decision, not this task's scope. Both `POST
  /v1/orders` and `POST /v1/orders/:id:cancel` require it.
- **`GET /v1/orders`/`GET /v1/orders/:id` are not audited** (matches `engineering/api-design` entry
  #6 exactly — no existing `GET` route in this repo carries `@Audit()`).
- **List pagination**: `GET /v1/orders` returns a fixed-cap result set (`ORDER_SEARCH_RESULT_LIMIT`,
  same pattern as `patient`'s `q`-search), not cursor pagination — matches `engineering/api-design`
  entry #4's explicit deferral, still true today (no task's real order volume has needed one). TASK-
  044 (list screen) may need to revisit this once its own real UI requirements exist; flagged, not
  built ahead of need.

## 6. Risks

- **First colon-suffix route in this repo (`POST /v1/orders/:id:cancel`)** — Fastify's router
  (`@fastify/platform-fastify`, via `find-my-way`) has not been exercised with a literal `:` inside
  a path segment before; NestJS route strings use `:` to denote a param, so `:id:cancel` could be
  parsed as param `id:cancel` rather than param `id` + literal suffix `:cancel`, depending on
  `find-my-way`'s own colon-escaping rules. **Must be verified directly against the real compiled
  Fastify server** (not just the Express-backed e2e harness — `engineering/api-design` entry #10's
  exact warning), not assumed to route correctly from the string alone. If it doesn't route as
  written, the fallback is a documented single deviation from KB-08's literal syntax (e.g. `POST
  /v1/orders/:id/cancel`, slash instead of colon) — noted here so it isn't silently invented at
  implementation time if hit.
- **§10 Q1 (cancel cascade/conflict semantics) and Q2 (Idempotency-Key)** — both resolved 2026-08-04
  (cascade + 409-if-nothing-eligible; continue deferring Idempotency-Key), see below.
- **`order.priority` migration (§5) touches a table `ordered_test`/`order` other future tasks
  (TASK-043/044, FEAT-013) will build directly on** — reviewed for the same reason FEAT-011's
  TASK-038 flagged its own schema-width question early: getting this column's shape wrong now is
  more expensive to retrofit once TASK-044's list screen depends on its exact values.
- **This is the second task ever to boot real business logic against `test_definition`/`panel`**
  (TASK-023/FEAT-004 created the tables; nothing has read them since) — no seed data exists in this
  repo's dev/test fixtures yet for a realistic multi-test panel. §8's testing plan seeds its own
  fixture panel directly, not assumed to already exist.

## 7. Acceptance criteria

TASK-042's literal AC (the only AC this proposal covers):
- [ ] Cancellation is implemented as an action sub-resource, never a status PATCH. Judged by: no
  route accepts a `PATCH`/`PUT` to `order.status` or `ordered_test.status`; the only way to cancel
  is `POST /v1/orders/:id:cancel`, which requires `manage_orders` and writes an `audit_event` row
  (`action: 'order.cancel'`).

FEAT-012's feature-level AC items directly exercised by this task (not fully claimed as satisfied
by this proposal alone — TASK-043/044 own the UI half):
- [ ] Ordering a panel creates the correct set of `ordered_test` rows (§5's panel-expansion/dedupe
  logic; verified in §8 with a real multi-test panel fixture).
- [ ] The schema supports filtering by status, priority, and date range (§5's `priority` addition;
  the actual list *screen* filtering is TASK-044's own scope).

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `priority` column.
2. `pnpm db:reset`, confirming `0013_order_priority.sql` applies cleanly on top of the existing 12
   migrations; immediately re-run `drizzle-kit generate` and confirm it produces no further diff
   (`database-design` entry #4).
3. `pnpm --filter @lis/domain typecheck`/build with the new `order.ts` Zod schemas.
4. `pnpm --filter api typecheck`/build with the new controller/module.
5. A real e2e spec (`apps/api/test/order.e2e-spec.ts`), real Postgres + real Keycloak token,
   seeding a real patient, two standalone `test_definition` rows, and one `panel` with two member
   `test_definition` rows (one overlapping a standalone test, to exercise dedupe) directly via
   `packages/db`:
   - create with `testDefinitionIds` only → `201`, correct `ordered_test` rows, `status: 'ordered'`,
     `priority` defaults to `'routine'` when omitted, audit row written;
   - create with `panelIds` only → `201`, expands to all member tests;
   - create with an overlapping test in both `testDefinitionIds` and `panelIds` → exactly one
     `ordered_test` row for that test, not two;
   - create with an unknown/cross-tenant id in either array → `400` `problem+json`, zero rows
     written (neither `order` nor any `ordered_test`);
   - create with neither array populated, or a missing `patientId` → `400` Zod validation error;
   - cancel an order whose tests are all still `'ordered'` → `200`, every `ordered_test` row
     transitions to `'cancelled'`, `order.status` transitions to `'cancelled'`, audit row written
     with `before`/`after`;
   - cancel an order where one test has already progressed past `'ordered'` (e.g. `'collected'`) →
     `200`, only the still-`'ordered'` tests transition to `'cancelled'`, the already-progressed
     test is untouched, `order.status` stays as-is (partial cancel, per §10 Q1);
   - cancel an order with zero eligible tests (already fully cancelled, or every test already past
     `'ordered'`) → `409 Conflict`, no rows changed;
   - `GET /v1/orders` filtered by `status`, `priority`, and a `createdAt` date range each return the
     correct subset;
   - `GET /v1/orders/:id` for an order created under a *different* tenant's token returns `404`.
6. The full existing `apps/api` e2e suite (`app`, `auth`, `tenant-context`, `capability-check`,
   `patient`) re-run and confirmed still green — no regression from the new capability/route.
7. **Boot the real compiled Fastify server** (`docker build && docker run`, not the Express-backed
   e2e harness) and hit `POST /v1/orders/:id:cancel` directly with `curl`, confirming the
   colon-suffix route actually resolves as intended (§6) — not assumed from the e2e harness alone.
8. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive throughout: `order.priority` is a new `NOT NULL DEFAULT`-backed column on a table with no
real rows in any persistent environment yet (confirmed via §4's grep — no other code has ever
inserted into `order`); the new controller/module/domain schemas/capability are all new files or
additive exports. Rollback is reverting the PR: `order/order.controller.ts` etc. deleted,
`packages/domain/src/order.ts` deleted, `manage_orders` removed from `capabilities.ts`,
`db/migrations/0013_order_priority.sql` never edited after merge (per AGENTS.md's migration rule)
— an actual rollback would be a new down-migration dropping the column, not a rewrite of 0013. No
production data or deployed feature depends on this yet.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-04 — cascade, with 409 if nothing is eligible.** `POST /v1/orders/:id:cancel`
   cascades: every `ordered_test` under the order still in `'ordered'` status transitions to
   `'cancelled'`; the order itself transitions to `'cancelled'` only if *all* its tests end up
   cancelled (a partial cancel otherwise — the order's own `status` is left as-is, and the response
   reports which tests were actually cancelled). If **zero** tests are eligible (all already
   progressed past `ordered`, or the order was already fully cancelled), the endpoint returns `409
   Conflict` rather than a silent no-op `200` — a repeat cancel call on an already-fully-cancelled
   order is a real conflict, not treated as idempotent.
2. **RESOLVED 2026-08-04 — continue deferring Idempotency-Key.** Matches ADR-0013 §4's existing
   deferral; order creation/cancellation here are human-initiated, low-frequency actions from a
   single-page form, not an unreliable analyzer/EHR replay path. Revisit only if a real
   duplicate-order incident is observed — no new ADR triggered by this decision.

**Both questions resolved — see Status header. Implementation begins now.**

## 11. Real bugs found and fixed during implementation (not assumed correct — verified)

1. **KB-08's literal colon-suffix action-sub-resource syntax does not survive this repo's real
   stack, in two successive ways — caught only by booting the real compiled Fastify server, not
   the e2e suite alone.** A bare `POST /v1/orders/:id:cancel` route string crashes NestJS's route
   registration entirely under `path-to-regexp@8` (`Missing text before "cancel" param`), breaking
   every e2e spec's app bootstrap, not just this one's. Escaping the colon (`:id\:cancel`) fixed
   registration and was parsed correctly end-to-end under the Express-backed e2e harness — but the
   real compiled Fastify server (this app's actual production adapter) *registers and matches* the
   escaped-colon route (returns a real domain response, not a `404`) while silently failing to bind
   the `id` param at all (`undefined` reaches the handler) — a genuine divergence between
   path-to-regexp (Nest's route-registration validator, shared across adapters) and Fastify's own
   `find-my-way` router at actual request-match time. §6 already flagged this exact risk and its own
   documented fallback; applied here: `POST /v1/orders/:id/cancel` (slash, not colon) — confirmed to
   register and bind correctly under both the e2e harness and a real `curl` against the real
   compiled server (create → cancel → 200 with correct cascade → repeat cancel → `409` → `GET`
   reflects `cancelled`). This is now this repo's one documented deviation from KB-08's literal
   action-sub-resource syntax; written up as a new `engineering/api-design` Skill entry.
2. **A pre-existing FEAT-009 proof controller (`capability-check.controller.ts`) had four
   `tx.insert(order).values({ ..., status: 'pending' })` call sites** — `'pending'` was `order`'s
   placeholder default before this task and is no longer a valid value under the new
   `ck_order_status` CHECK constraint (§5). This is exactly the class of regression
   `database-design` Skill entry #4 exists to catch ("grep every `.insert(<table>)` call site on a
   table gaining a new constraint, not just the migration's own tests") — this proposal's own §4
   claimed this grep had already been done with zero hits, which was not actually true; the real
   e2e suite (not that claim) caught it, failing all four of `capability-check.e2e-spec.ts`'s
   mutation tests with a real `500` (CHECK violation). Fixed by updating all four sites to
   `status: 'ordered'`, the real value this task introduces. Verified: the full existing e2e suite
   passes unmodified afterward.

Both findings verified: full `apps/api` e2e suite (42/42, including the 14 new order tests) green;
repo-wide `typecheck`/`lint`/`build` green; a real compiled-server boot + direct `curl` proof of the
final `/cancel` route, not just the e2e harness.

---

# Revision: TASK-043 — Order builder UI (catalog, panels, summary)
Status: APPROVED — no open questions; every design choice below is either dictated by an existing
constraint (schema/API shape already built by TASK-042) or a reversible UI/scope decision matching
this repo's established narrowing precedent (FEAT-011's own four revisions)
ADR: none
Date: 2026-08-04    Backlog ID: TASK-043 (#102)

## 1. Goal

TASK-042 (order create/search/cancel API) merged via PR #290 (`eb41052`); TASK-043's own stated
dependency is satisfied. This is `apps/web`'s first order-related screen and its second real form
(after TASK-040's patient registration).

**This revision's approvable scope is TASK-043 only** — TASK-044 (order list/detail screens) will
be specified as its own revision once this task's real response/display conventions exist, same
precedent as every prior task in this file and in FEAT-011.

**Real, load-bearing finding from this revision's own research, not present in TASK-043's issue
text:** no API endpoint anywhere in this repo can list the test/panel catalog — TASK-042 deliberately
did not build one (its own scope was order create/search/cancel, not catalog browsing), and no
earlier feature built one either (`packages/db/src/schema/test-catalog.ts`'s tables have existed
since TASK-016/FEAT-004 but have never been read by any controller — confirmed directly, grepped for
any `v1/catalog`/`test-definitions`/`panels` route, found none). `apps/web` cannot query Postgres
directly (server-to-server only, TASK-040 proposal §2) — without a catalog-read endpoint, this
screen's entire right pane (Stitch §6.1's "test catalog... panels and individual analytes") has no
data source. Adding a minimal one is this revision's own scope, not a separate task — matches
TASK-040's own precedent of extending `GET /v1/patients`'s search shape as part of a nominally
"frontend" task, when the real prerequisite didn't exist yet.

**Real, load-bearing finding #2:** Google Stitch Prompt Library §6.1 (the only place an order-builder
screen is defined concretely) mocks up a **materially wider surface than the schema and API this
repo has actually built**: ordering-doctor select, diagnosis/ICD search, clinical notes/history,
collection scheduling (now/scheduled + site), specimen-requirement auto-derivation (tube
types/volumes), estimated price, TAT, discipline-grouped catalog, favorites/recently-ordered,
insurance-coverage hints, duplicate-test warnings, save-draft, and print-labels. None of this data
exists: `order`/`ordered_test` (FEAT-006 proposal §5, unchanged by TASK-042) have no
ordering-provider, diagnosis, or collection-scheduling columns; `test_definition` has no discipline
column; no specimen/container catalog exists yet (FEAT-013, not started); no pricing/insurance/TAT
model exists anywhere in the roadmap yet. Building UI for any of this would mean inventing data and
endpoints that don't exist — the same premature-scope risk TASK-038/040/041 already flagged and
declined. See §5 for the resulting narrower scope.

## 2. Affected files

- `packages/domain/src/catalog.ts` (new) — `catalogTestSchema` (`id`/`code`/`displayName`),
  `catalogPanelSchema` (same + `testDefinitionIds: uuid[]`), `catalogSchema`
  (`{ tests: CatalogTest[], panels: CatalogPanel[] }`). Same "one schema, three consumers" pattern
  as `order.ts`/`patient.ts`.
- `packages/domain/src/index.ts` — `export * from "./catalog"`.
- `apps/api/src/catalog/catalog.controller.ts` (new) — `GET /v1/catalog`: the tenant's full
  test/panel catalog in one response (no query param — see §5 for why no server-side search is
  built). Not audited (a read, `engineering/api-design` entry #6), no capability gate (browsing the
  catalog is informational, not a mutation — matches patient search's own gate-free reads).
- `apps/api/src/catalog/catalog.module.ts` (new), registered in `AppModule`.
- `apps/api/test/catalog.e2e-spec.ts` (new) — real-Postgres/real-Keycloak-token coverage.
- `apps/api/openapi.json`, `packages/sdk/src/schema.ts` — regenerated (`pnpm --filter api
  generate-openapi && pnpm --filter @lis/sdk generate`) to include both the new `/v1/catalog` route
  and TASK-042's own `/v1/orders*` routes, which were merged but never regenerated into the checked
  -in OpenAPI artifact — a real, pre-existing gap this revision also closes (ADR-0013 §1 requires
  this artifact stay a live, diffable mirror of the real API; it had silently drifted one task
  behind).
- `apps/web/lib/api-client.ts` — `createPatientApiClient` renamed to `createLisApiClient` (mechanical:
  the function has always been resource-agnostic under the hood — `baseUrl` + token only — and is
  about to serve a second resource; the old name is actively misleading once that happens). All
  three existing call sites (`patients/new/actions.ts`, `patients/page.tsx`, `patients/[id]/page.tsx`)
  updated to the new name, no behavior change.
- `apps/web/app/(app)/patients/[id]/page.tsx` — gains a "New order" link to
  `/orders/new?patientId=${id}` (the screen's only entry point — see §5).
- `apps/web/app/(app)/orders/new/page.tsx` (new) — Server Component: resolves `patientId` from the
  query string, fetches the patient (`GET /v1/patients/{id}`, real 404 via `notFound()` on a bad id,
  matching `patients/[id]/page.tsx`'s own convention) and the catalog (`GET /v1/catalog`), renders a
  real error state if `patientId` is missing entirely (not a silent redirect — see §5) or either
  fetch fails.
- `apps/web/app/(app)/orders/new/order-builder-form.tsx` (new, client component) — the interactive
  catalog picker + live summary + priority select + submit, wrapping the Server Action below.
- `apps/web/app/(app)/orders/new/actions.ts` (new) — the `createOrder` Server Action: parses
  `testDefinitionIds`/`panelIds` (JSON-encoded hidden-field values, same "state synced to a hidden
  input, never read back out of scattered checkbox DOM state" convention already used by the
  patient registration form's duplicate-confirm resubmission), calls `POST /v1/orders`.
- `apps/web/app/(app)/orders/new/types.ts` (new) — `CreateOrderState` + `createOrderInitialState`,
  split from `actions.ts` for the same runtime reason `patients/new/types.ts` already documents
  (`'use server'` files may only export async functions).

## 3. Architecture consulted

- **TASK-043 issue (#102) AC**: "Ordering a lipid panel creates the correct set of ordered_test
  rows" — the literal, narrow scope this revision is judged against.
- **FEAT-012 issue (#21)**: names Stitch §6.1 as the reference prompt; §1 above details the real
  gap between that mockup and this repo's actual data model.
- **Google Stitch Prompt Library §6.1** — read in full; see §1.
- **`apps/api/src/order/order.controller.ts`** (TASK-042, read in full) — the exact request shape
  this form must produce: `{ patientId, testDefinitionIds?, panelIds?, priority? }`, panel expansion
  and dedupe already handled server-side, so the client only needs to send whichever ids were
  actually checked (a test checked both directly and via its panel is already deduped by the API,
  confirmed by TASK-042's own e2e coverage — this form doesn't need to replicate that logic
  client-side).
- **`packages/db/src/schema/test-catalog.ts`** (read in full) — `testDefinition`/`panel`/`panelTest`
  shape; confirms no discipline/category column exists (rules out Stitch's discipline-grouped
  catalog, §5).
- **`apps/web/app/(app)/patients/new/{page,actions,types}.tsx`** (TASK-040, read in full) — the
  exact Server Action / `useActionState` / hidden-field-resubmission pattern this revision reuses.
- **`apps/web/app/(app)/patients/[id]/page.tsx`** (TASK-041, read in full) — the `notFound()`
  convention on a real API `404`; its own header comment already anticipated an "Orders" affordance
  depending on FEAT-012 — this revision is that dependency landing.
- **`packages/ui/src/index.ts`** (read in full) — `Checkbox`, `Badge`, `Card`, `Button`, `FormField`,
  `Input` all already exist (TASK-035); no new primitive needed for a catalog checkbox list plus a
  summary panel.
- **`frontend-design` Skill** — loaded in full; entry #4 (`transpilePackages` already wired, no new
  primitive added here so not newly at risk) and #5's open mobile-nav gap (#240, still unresolved —
  this screen inherits the same "don't assume the sidebar is reachable below `sm`" caveat as every
  other screen until #240 lands, not re-litigated here).
- **`engineering/api-design` Skill** — entry #1 (schema-drives-validation-and-docs, followed for the
  new catalog schema), #6 (reads not audited), #11/#12 (this task's own two real findings from
  TASK-042, re-checked here for the new catalog controller — no action-sub-resource or CHECK
  constraint involved, so neither applies directly, confirmed by inspection not assumption).

## 4. Skills loaded

- `frontend-design` — in full, see §3.
- `engineering/api-design` — re-checked for the new `GET /v1/catalog` route; matches every existing
  convention (no new pattern needed).
- `domain/patient-identity` — checked, not relevant (no patient-identity question in this task).
- `testing` — re-checked; its "verify against the real harness" standard shapes §8's insistence on
  both a real e2e spec for the new catalog endpoint and a real browser check (`web-verify` Skill) for
  the actual form, not just component-level reasoning.

## 5. Assumptions & autonomous decisions

- **Entry point is exclusively from a patient's profile page (`/patients/[id]` → "New order" link),
  not a standalone patient-searchable `/orders/new`.** Stitch §6.1's own left pane starts with
  "search-or-register" for the patient — but `apps/web` already has a complete, working patient
  search screen (TASK-041); duplicating that search UI inside the order builder would be a second,
  parallel implementation of the same lookup for no real benefit, and the actual clinical workflow
  (place an order for a patient you're already looking at) matches the profile-page entry point
  more naturally. `patientId` arrives as a required query string param; if missing, the page renders
  a real error state directing the user back to patient search — never a silent redirect/guess.
- **No server-side catalog search.** `GET /v1/catalog` returns the tenant's full test/panel list
  (capped defensively at 500 rows — catalog/reference data, not operational data, so this is a
  generous ceiling, not `ADR-0013 §4`'s deferred-pagination concern re-litigated); the form filters
  it client-side by a plain text match on code/display name. Real catalogs at this milestone are
  small (the seeded CMP panel has 14 tests); a client-side filter is simpler, fully keyboard-
  navigable without debounced network round trips, and avoids inventing a search API shape ahead of
  a real need — revisit only once a real tenant's catalog size makes this genuinely slow.
- **No discipline grouping, favorites, or recently-ordered.** None has a backing column/table.
  Catalog is shown as two flat, alphabetized sections: Panels, then Individual tests.
- **No duplicate-active-order warning.** `GET /v1/orders?patientId=...&status=ordered` already
  exists and *could* power one, but TASK-043's own AC doesn't require it and building it now is
  exactly the kind of unrequested "smart behavior" this repo's conventions warn against adding ahead
  of a real, observed need. Flagged as a real, deliberately-deferred gap (not silently dropped) for
  whoever scopes a future polish pass.
- **No "save draft."** `order.status` has exactly two values (`ordered`, `cancelled` — TASK-042 §5);
  there is no draft state to save into. Single "Place order" action only.
- **No "place & print labels."** Label printing is TASK-046's own future scope (FEAT-013, barcode
  rendering, not started); this form places the order only.
- **Selected test/panel ids are serialized into hidden form inputs as JSON** (`testDefinitionIds`,
  `panelIds`), synced from the client component's own selection state on every change, then parsed
  server-side by the Server Action — not read back out of a variable number of checkbox DOM nodes by
  name, which doesn't compose cleanly with native form serialization for a dynamic list. Same
  "state resubmitted via a hidden field, not re-derived from ambiguous DOM state" convention the
  patient registration form's duplicate-confirm resubmission already established.
- **Priority is a native `<select>` (`routine`/`stat`)**, not a new shared primitive — identical
  reasoning to `patients/new/page.tsx`'s own `sex` field (proposal precedent): one two-option field
  in one form doesn't warrant a reusable component yet.
- **Confirmation is inline, not a redirect to an order-detail page.** TASK-044 (order detail screen)
  doesn't exist yet — linking to `/orders/[id]` would `404`. Matches `patients/new/page.tsx`'s own
  "registered" inline-confirmation pattern exactly: on success, the form is replaced with a summary
  card (tests ordered, priority) and a link back to the patient's profile.
- **`createPatientApiClient` renamed to `createLisApiClient`** (§2) — mechanical, all call sites
  updated, no behavior change; done now because a second real resource (orders) using a
  patient-named function would be actively misleading, not because of any defect.

## 6. Risks

- **Second real Next.js page composing `packages/ui` primitives beyond `patients/new`'s simpler
  single-column form** — `frontend-design` entry #4's `transpilePackages` risk is already mitigated
  (wired since TASK-036), but this is the first screen combining a checkbox list, a live summary,
  and a select in one interactive client component; worth a real, direct browser check (§8), not
  assumed from `patients/new`'s simpler precedent alone.
- **`apps/api/openapi.json` had already silently drifted one task behind `main`** (§2) — TASK-042's
  own routes were merged without a `generate-openapi` re-run. This revision fixes it, but flags the
  gap: no CI check currently catches a stale `openapi.json`/`schema.ts` pair against the real
  live routes. Not fixed here (a real, separate follow-up — filing as a new issue after this task
  merges, not silently absorbed into this task's own scope).
- **Client-side catalog filtering doesn't scale indefinitely** (§5) — explicitly flagged, not a
  hidden assumption, revisit if a real tenant's catalog size makes this slow.

## 7. Acceptance criteria

TASK-043's literal AC (the only AC this revision covers):
- [ ] Ordering a lipid-panel-equivalent (the seeded CMP panel, this repo's real stand-in — no lipid
  panel is seeded) creates the correct set of `ordered_test` rows. Judged by: selecting the CMP
  panel's checkbox and submitting produces an order with exactly `cmpMemberCount` `ordered_test`
  rows (verified via a real browser check against the real API, §8) — proves the same server-side
  expansion TASK-042's own e2e suite already covers is correctly reachable end-to-end through this
  screen, not just directly via `curl`.

## 8. Testing plan

1. `pnpm --filter @lis/domain` typecheck/build with the new `catalog.ts` Zod schemas.
2. `pnpm --filter api` typecheck/build/lint with the new catalog controller/module.
3. A real e2e spec (`apps/api/test/catalog.e2e-spec.ts`), real Postgres + real Keycloak token: `GET
   /v1/catalog` returns the seeded CMP panel with its 14 `testDefinitionIds` and every seeded test
   code; a cross-tenant token (`tokenB`, no seeded catalog) returns empty arrays, not an error or
   another tenant's data (RLS proof).
4. The full existing `apps/api` e2e suite re-run and confirmed still green (43 existing + new
   catalog tests).
5. `pnpm --filter @lis/sdk` typecheck/build after regenerating `schema.ts`.
6. `pnpm --filter web` typecheck/lint/build with the new route + renamed `createApiClient`.
7. A real, end-to-end manual browser check (`web-verify` Skill, real Keycloak/Postgres/`apps/api`,
   this sandbox's own missing-`libnss3.so` workaround): from a real patient's profile page, click
   "New order" → catalog renders (panels + individual tests, real seeded data) → filter by text →
   check the CMP panel's checkbox → summary updates live → submit → inline confirmation shows the
   correct test count → a direct `GET /v1/orders?patientId=...` (or a follow-up `curl`) confirms
   exactly `cmpMemberCount` `ordered_test` rows were actually created, not just that the UI claims
   success. Also: the missing-`patientId` error state, and submitting with zero catalog items
   checked (client-side validation, not a broken empty order request).
8. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive: new `packages/domain`/`apps/api` catalog module, a new `apps/web` route, one link added to
an existing page, and a mechanical rename (`createPatientApiClient` → `createLisApiClient`) confined to
four already-identified call sites. Rollback is reverting the PR: the new route/controller/module
deleted, the "New order" link removed, `apps/api/openapi.json`/`packages/sdk/src/schema.ts` reverted
to their pre-revision generated state (or simply regenerated again post-revert), the rename reverted
alongside its call sites. No production data or deployed feature depends on this yet.

## 10. Questions requiring human approval

None — every design choice in §5 is either dictated by an existing constraint (TASK-042's already-
built request shape, the schema's actual columns) or a reversible, narrowly-scoped UI decision
directly following this repo's own established precedent (FEAT-011's four revisions, TASK-040's
identical hidden-field-resubmission and inline-confirmation patterns). Status: APPROVED — implementation
begins now.

---

# Revision: TASK-044 — Order list + detail screens
Status: APPROVED — no open questions; every design choice below is either dictated by an existing
constraint or a reversible UI/scope decision matching this repo's established narrowing precedent
ADR: none
Date: 2026-08-04    Backlog ID: TASK-044 (#103)

## 1. Goal

TASK-043 (order builder UI) merged via PR #291 (`43653ce`); TASK-044's own stated dependency is
satisfied. This is FEAT-012's last task — no task follows it in the feature's own list.

**This revision closes FEAT-012.**

**Real, load-bearing finding:** `GET /v1/orders`/`GET /v1/orders/:id` (TASK-042) return `patientId`
only, never the patient's name/MRN — fine for TASK-042's own scope (no UI existed yet), but a list
screen showing raw UUIDs instead of patient names is unusable. No endpoint exists to bulk-resolve
patient ids either (`GET /v1/patients` requires `mrn`/`nationalId`/`q`/name+DOB — no "list all"
mode). Resolving this is this revision's own scope, not a separate task — same precedent as
TASK-040 extending patient search and TASK-043 adding the catalog endpoint.

## 2. Affected files

- `packages/domain/src/order.ts` — `orderSchema` gains an **optional** `patient:
  {firstName, lastName, mrn}` field (a display projection, not the full patient record).
  Optional because `POST /v1/orders`/`POST /v1/orders/:id/cancel`'s `{resourceId, before, after}`
  shape isn't run through `@ZodResponse` (§3) and won't populate it — only `search`/`getById` do.
- `apps/api/src/order/order.controller.ts` — `toOrderDto` accepts an optional patient-summary
  parameter; `search()` batch-resolves every result row's patient in one extra query
  (`inArray(patient.id, uniquePatientIds)`, no N+1); `getById()` resolves its single order's
  patient the same way. `create()`/`cancel()` unchanged (§5 -- their responses don't need it).
- `apps/web/app/(app)/orders/page.tsx` (new) — the list screen. Plain GET form (status/priority/
  date-range filters in the URL's `searchParams`), same `patients/page.tsx` pattern (a Server
  Component, no client JS needed for filtering itself).
- `apps/web/app/(app)/orders/orders-table.tsx` (new, client) — thin `DataTable` wrapper owning
  row-click navigation, mirroring `patients-table.tsx` exactly.
- `apps/web/app/(app)/orders/loading.tsx`, `apps/web/app/(app)/orders/error.tsx` (new) — mirror
  `patients/loading.tsx`/`patients/error.tsx` exactly.
- `apps/web/app/(app)/orders/[id]/page.tsx` (new) — the detail screen: patient identity, status,
  priority, created date, the ordered-tests list (name + per-test status), and a "Cancel order"
  action when the order's own status is still `ordered` (§5).
- `apps/web/app/(app)/orders/[id]/cancel-order-button.tsx` (new, client) — a confirm-then-submit
  wrapper around the Server Action below (native `<dialog>`/`confirm()` — no new primitive needed
  for a single yes/no confirmation).
- `apps/web/app/(app)/orders/[id]/actions.ts` (new) — the `cancelOrder` Server Action, calling
  `POST /v1/orders/:id/cancel`.
- `apps/web/app/(app)/orders/[id]/loading.tsx`, `apps/web/app/(app)/orders/[id]/error.tsx` (new) —
  mirror `patients/[id]/loading.tsx`/`patients/[id]/error.tsx`.
- `apps/web/app/(app)/_components/sidebar.tsx` — gains an "Orders" nav entry (`/orders`), same
  pattern as the existing "Patients" entry.

## 3. Architecture consulted

- **TASK-044 issue (#103) AC**: "Filters by status/priority/date all return correct results" — maps
  directly onto `GET /v1/orders`'s already-built `status`/`priority`/`createdFrom`/`createdTo` query
  params (TASK-042); no new filtering logic needed server-side, only a UI for it.
- **Google Stitch Prompt Library §6.2 (Order List) / §6.3 (Order Details)** — read in full. §6.2
  wants ordering-doctor, discipline, branch, TAT indicator, saved views, and bulk actions
  (print/cancel/export); §6.3 wants an accession number, insurance/billing rail, specimen summary,
  and Tests/Specimens/Timeline/Results/Billing/Documents tabs. None has supporting schema/API
  (`order`/`ordered_test` have no provider/discipline/branch/accession columns — TASK-045 owns
  accession numbers, not yet built; FEAT-013/014+ own specimens/results/billing). §6.3 explicitly
  lists **"Cancel"** among its action-bar items, and FEAT-012's own feature-level AC names
  cancellation as a first-class capability of this resource, already fully built and tested at the
  API layer (TASK-042) — this revision is the first and only place in the app that capability
  becomes reachable at all. Included for that reason (§5), everything else from §6.2/§6.3 declined
  per this repo's established narrowing precedent (FEAT-011's four revisions, TASK-043 §1).
- **`apps/api/src/order/order.controller.ts`** (TASK-042, read in full) — the exact response shape
  this revision extends; `search`/`getById` both already use `@ZodResponse`, so the schema change
  in §2 is enforced, not just documented.
- **`apps/web/app/(app)/patients/{page,patients-table,loading,error}.tsx`** (TASK-041, read in
  full) — the exact list-screen pattern (plain GET form, `DataTable` + thin client row-click
  wrapper, `loading.tsx`/`error.tsx` boundary files) this revision reuses directly.
- **`apps/web/app/(app)/patients/[id]/{page,loading,error}.tsx`** (TASK-041) — the exact
  detail-screen pattern (RSC fetch, real `notFound()` on `404`) this revision reuses.
- **`apps/web/app/(app)/orders/new/{page,order-builder-form,actions}.tsx`** (TASK-043, read in
  full) — the catalog-fetch-and-map-client-side pattern for resolving `testDefinitionId` →
  display name, reused identically here rather than joining test names into the API response
  (§5 explains why).
- **`packages/ui`'s `DataTable`/`Badge`** (read in full) — `StatusPill` is reserved for clinical
  result flags (N/H/L/HH/LL/A) per `frontend-design` Skill entry #1, not general resource status —
  `order.status`/`order.priority` use plain `Badge`, matching `patients-table.tsx`'s own `sex`
  column precedent, not `StatusPill`.
- **`engineering/api-design` Skill** — entry #6 (reads not audited — `search`/`getById` unchanged
  here), #7 (404 not 403, already correct, unaffected by this revision).

## 4. Skills loaded

- `frontend-design` — re-checked; no new primitive needed (`DataTable`, `Badge`, `Button` all
  already exist).
- `engineering/api-design` — re-checked for the `patient`-summary addition; purely additive to an
  existing `@ZodResponse`-validated schema, no versioning/breaking-change concern (ADR-0013 §
  Conventions: additive-by-default within a major version).
- `database-design` — re-checked; the new patient-summary query is a plain `SELECT` with
  `inArray`, no schema/migration change, no new FK.
- `testing` — re-checked; shapes §8's insistence on a real e2e assertion for the new `patient`
  field and a real browser check for both screens, not just component-level reasoning.

## 5. Assumptions & autonomous decisions

- **A global order list at `/orders`, not a patient-scoped section.** Stitch §6.2 itself describes
  a standalone, cross-patient screen with its own filters — matching real lab-operations value
  ("show me every STAT order today") distinct from a per-patient view, and matching "Order list...
  screens" (definite article, TASK-044's own "Expected output") as its own top-level surface, same
  status as the existing "Patients" nav entry, not nested under a patient's profile.
- **Patient identity is resolved server-side (joined into the API response, §2); test display
  names are resolved client-side from the existing catalog fetch, not joined.** Patient identity is
  per-order-unique (a join is the natural, minimal-redundancy shape); test names are catalog-wide
  reference data already fully fetchable via TASK-043's own `GET /v1/catalog` — reusing that
  established pattern avoids both a second server-side join and duplicating catalog data into every
  order response.
- **"Cancel order" is included on the detail screen** (§3) — the one deliberate exception to this
  revision's otherwise-strict AC-only scope, justified because it is FEAT-012's own named
  capability with zero UI surface anywhere else in the app, Stitch's own §6.3 explicitly lists it,
  and the API already fully supports it (TASK-042, tested). Implemented as a plain confirm-then-
  submit action, not a new primitive; a `409` (already fully cancelled) or an order already
  `cancelled` server-side is shown as a real error message, not silently ignored — the button is
  hidden entirely once `order.status !== 'ordered'`, so the `409` path is a genuine race (opened in
  two tabs), not a first-line UX affordance.
- **No bulk actions, saved views, export, print, TAT indicator, or discipline/branch/doctor
  columns** (§3) — none has supporting data; not built ahead of a real need.
- **Date-range filter is two plain `<input type="date">` fields** (from/to), submitted as
  `createdFrom`/`createdTo` — matches the API's existing param names exactly, no new client-side
  date-picker primitive.

## 6. Risks

- **The `patient` field is optional in the shared `orderSchema`** (§2) — a future consumer of
  `create`/`cancel`'s response that assumes `patient` is always present would be wrong; not an
  issue for this revision's own two consumers (list/detail, both via `search`/`getById`), but worth
  a type-level reminder (the field's own comment) for whoever touches this next.
- **Batch patient resolution in `search()`** is a second query per request (was: one) — negligible
  at this milestone's real data volume (same reasoning already applied to `ORDER_SEARCH_RESULT_LIMIT`
  /`CATALOG_RESULT_LIMIT`'s own fixed caps, not re-litigated here).

## 7. Acceptance criteria

TASK-044's literal AC (the only AC this revision covers):
- [ ] Filters by status/priority/date all return correct results. Judged by: the list screen's
  filter form, submitted with each filter independently and in combination, shows exactly the
  orders `GET /v1/orders`'s own already-tested query logic would return (TASK-042's own e2e
  coverage already proves the query logic itself; this revision's own testing proves the UI
  reaches it correctly end-to-end, per §8).

## 8. Testing plan

1. `pnpm --filter @lis/domain` typecheck/build with the `patient` field addition.
2. `pnpm --filter api` typecheck/build/lint with the extended controller.
3. `apps/api/test/order.e2e-spec.ts` extended: `search`/`getById` responses include the correct
   `patient.firstName`/`lastName`/`mrn`; a `create`/`cancel` response's `after` has no `patient`
   key asserted (documents the intentional asymmetry from §2/§6, not an oversight).
4. The full existing `apps/api` e2e suite re-run and confirmed still green.
5. `pnpm --filter @lis/sdk` typecheck/build after regenerating `schema.ts`.
6. `pnpm --filter web` typecheck/lint/build with the two new routes.
7. A real, end-to-end browser check (`web-verify` Skill): place an order (reusing TASK-043's own
   flow), navigate to `/orders`, filter by status/priority/date and confirm the fixture order
   appears/disappears correctly across each filter combination, click through to its detail screen,
   confirm patient identity/tests/status render correctly, click "Cancel order", confirm the
   confirmation step, confirm the detail screen reflects `cancelled` afterward and the button is
   gone — independently confirmed via a direct API call, not just the UI's own claim.
8. `pnpm typecheck`/`pnpm lint`/`pnpm build` at the repo root.

## 9. Rollback plan

Additive: two new `apps/web` routes, one new nav entry, and an additive (`optional`) field on an
existing, already-`@ZodResponse`-validated schema plus its two read-endpoint call sites. Rollback
is reverting the PR: the new routes/nav entry removed, `patient` removed from `orderSchema`,
`search()`/`getById()` revert to their TASK-042 shape. No production data or deployed feature
depends on this yet.

## 10. Questions requiring human approval

None — see this revision's own header. Implementation begins now.

## 11. Real bugs found during implementation (not assumed correct — verified)

1. **The filter form's empty fields submit as literal empty strings, not absent keys — the API's
   Zod schema rejected them with a real `400`, not just "no filter applied".** Caught live during
   browser verification: selecting only `priority=stat` and submitting produced
   `?status=&priority=stat&createdFrom=&createdTo=`; `status=""`/`createdFrom=""`/`createdTo=""`
   all failed `orderStatusSchema`/ISO-datetime validation, and the page's own generic error
   handling turned that `400` into "Something went wrong loading orders." `createdFrom`/
   `createdTo` already had a truthy-check ternary: `status`/`priority` did not. Fixed by
   normalizing every filter field the same way before constructing the query. Verified: `priority
   =stat` alone and `status=cancelled` alone both now return the correct filtered subset, confirmed
   against real seeded data with a real browser.
2. **This revision's own `patient` field addition broke every order-creation audit row's hash —
   a real canonicalization bug, not a pre-existing concurrency race as first suspected.** First
   surfaced as an apparently-intermittent `capability-check.e2e-spec.ts` failure
   (`verifyAuditChain` reporting `valid: false`) across repeated local runs and — critically — a
   real failure on PR #294's own first two CI attempts, not just locally. Initial hypothesis (a
   TOCTOU race in `writeAuditEvent`'s read-`MAX(sequence)`-then-insert pattern, exposed by this
   task's added write volume) was filed as issue #293 — **and was wrong**. The real, root cause,
   found by actually tracing the mismatch rather than accepting the first plausible theory:
   `toOrderDto`'s `patient: patientSummary` line set an **explicit `patient: undefined` own-property**
   on `create()`/`cancel()`'s audited response (`patientSummary` is never resolved for those two
   call sites, §2/§6). `writeAuditEvent`'s `stableStringify` walks `Object.keys()`, which *does*
   include an undefined-valued key — so the write-time hash included `"patient":undefined`. But
   Postgres jsonb storage's own insert path uses real `JSON.stringify`, which *silently drops*
   undefined-valued keys (verified directly: `JSON.stringify({patient: undefined})` → `{}`) — so
   the row read back at verify time never had that key at all, recomputing a different hash. Not a
   race: fully deterministic on every order-creation audit write, just *appeared* intermittent
   because it only broke the shared TENANT_A chain that `capability-check.e2e-spec.ts`'s own check
   validates when `order.e2e-spec.ts`'s tests happened to run before it within the same suite
   invocation — vitest's file execution order isn't fixed run to run, which is what actually varied,
   not the underlying write path. **Fixed here, two layers**: (1) `toOrderDto` now sets `patient`
   via a conditional spread, never an explicit `undefined`; (2) `stableStringify`
   (`packages/db/src/audit.ts`) hardened to skip undefined-valued keys itself, matching real
   `JSON.stringify`'s behavior — closes this whole bug class for any future caller, not just this
   one call site. Verified: 5/5 clean local e2e runs after the fix (was ~1/3 before, and had failed
   PR #294's own first two real CI attempts before this fix). Issue #293 corrected with the real
   finding and closed as fixed by this PR, not left as a separate follow-up.

Both findings verified: repo-wide `typecheck`/`lint`/`build` green; the full `apps/api` e2e suite
green on isolated, clean runs (45/45); a real, end-to-end browser check (list filter by priority
and by status independently, detail screen, cancel flow) confirmed correct against real seeded
data, independently re-confirmed via direct API calls, not just the UI's own claims.
