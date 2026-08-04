# Implementation Proposal: FEAT-012 Order entry
Status: APPROVED — both §10 questions resolved 2026-08-04; TASK-042 implementation begins now
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
