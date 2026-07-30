# Implementation Proposal: FEAT-006 Order, specimen & tenancy spine
Status: APPROVED
ADR: none yet — see §10 for resolved decisions    Date: 2026-07-30
Backlog ID: FEAT-006 (#15) / TASK-023 (#82), TASK-024 (#83), TASK-025 (#84)

## 1. Goal

FEAT-006 (#15) is M1's next feature after FEAT-005 (Observation store, closed this
session-chain). Per its own issue: "the aggregates results attach to, structurally
isolated per tenant." It has three tasks — TASK-023 (`order`/`ordered_test`/`specimen`
+ M:N fulfilment link), TASK-024 (tenant_id + RLS across the schema), TASK-025
(`audit_event` with hash chain + writer) — covered together by this one proposal,
following FEAT-004/FEAT-005's precedent of one proposal per feature so all three tasks
share a consistent schema before any is built.

This is the first migration to exercise Constitution Law #4 (RLS) against genuinely
new aggregates since TASK-017/018, and the first to exercise Law #5 (every clinically
significant action is audited) at all — no `audit_event` table exists yet anywhere in
this repo.

This proposal's concrete scope is all three tasks' schema/writer work; TASK-024's
actual deliverable is scoped narrower than its issue text implies — see §5.

## 2. Affected files

- `db/migrations/0009_order_specimen.sql` (new) — `order`, `ordered_test`, `specimen`,
  `specimen_fulfillment` (the M:N link). Raw SQL, RLS policies included in this same
  migration per Constitution Law #4 ("from the migration that creates it, not a
  follow-up") — non-negotiable, so TASK-023 and TASK-024's schema work are not
  actually separable into two migrations; see §5.
- `db/migrations/0010_audit_event.sql` (new) — `audit_event`, hash-chain columns, and
  the `REVOKE UPDATE, DELETE ... FROM lis_app` needed to make it genuinely append-only
  for the application role (see §6 Risk).
- `packages/db/src/schema/order.ts` (new) — `order`, `orderedTest` Drizzle schema.
- `packages/db/src/schema/specimen.ts` (new) — `specimen`, `specimenFulfillment`
  Drizzle schema.
- `packages/db/src/schema/audit.ts` (new) — `auditEvent` Drizzle schema.
- `packages/db/src/schema/index.ts` — export the three new schema modules.
- `packages/db/src/audit.ts` (new) — the "writer": a small typed function other call
  sites use to insert an audit row and compute `hash = hash(record ‖ prev_hash)`
  correctly per-tenant, so no caller has to reimplement chaining. No domain/API layer
  exists yet to call it from in M1 — this proposal delivers the writer and its own
  direct tests, not a wired-up caller (nothing clinically significant is being written
  by application code yet at this milestone).
- `docs/scope/current.md` — breadcrumb update once the feature closes.

TASK-024 additionally produces (no new migration — see §5):
- A cross-table RLS isolation-test suite (new tenant tables from this proposal +
  regression coverage on every existing tenant table).
- `~/work/lis-engineering/skills/engineering/rls-multi-tenancy/SKILL.md` — required by
  FEAT-006's own issue (`Required Skills`) but does not exist yet, same gap
  FEAT-004/FEAT-005 hit and deferred; this is the natural task to author it, since
  TASK-024 is where the reusable isolation-testing pattern first gets written down
  deliberately rather than ad hoc per table.

## 3. Architecture consulted

- **KB-02 Domain Model** — the `Order`/`OrderedTest`/`Specimen` aggregates and their
  invariants; the explicit `Order 1..* OrderedTest`, `OrderedTest *..* Specimen` (via
  fulfilment), `Specimen 1..* Aliquot` cardinalities; the "catalog vs. operational,
  with snapshotting" layering (`OrderedTest` references `TestDefinition` by ID,
  doesn't copy it).
- **KB-22 Sample Management** — the specimen lifecycle state machine
  (`collected → received → accessioned → in_process → completed → archived/disposed`,
  with `rejected(reason)` reachable from receipt); the load-bearing decision that
  specimen↔test is many-to-many (one tube serves several tests; some tests need
  several tubes) via explicit fulfilment links, not a specimen-per-test duplication;
  aliquots as parent-linked lineage; rejection reasons as **coded, never free text**
  (haemolysed, clotted, insufficient volume, mislabelled, wrong container, improper
  temperature, expired).
- **KB-38 Multi-Tenancy** — tenant resolved authoritatively from the token (never a
  client parameter, out of scope for this DB-only proposal but the reason `tenant_id`
  is never client-writable); shared-schema + RLS as the default isolation tier, which
  is what M1 builds regardless of which tier a given tenant later escalates to.
- **KB-06 Database Architecture** — the canonical `observation` DDL's own FKs into
  `ordered_test(id)`/`specimen(id)` (already anticipated by ADR-0005, backfilled by
  this proposal's migration); the bounded-context schema table lists `orders` and
  `specimens` as separate logical schemas, but this repo has not adopted
  per-bounded-context Postgres schemas anywhere yet (every table so far — `analyte`,
  `test_definition`, `reference_range`, `observation` — lives in `public`); this
  proposal keeps that established repo convention rather than introducing schema
  namespacing FEAT-004/005 never used (a deviation from KB-06's suggested layout,
  not silently — noted here as the reason, consistency with existing tables).
- **KB-11 Audit Logging** — the `audit.event` record shape (`actor`, `action`,
  `resource`, `before`/`after`, `reason`, `context`, `prev_hash`, `hash`); hash-chain
  tamper evidence ("altering or deleting any historical event breaks the chain");
  append-only enforced at the grant level ("no `UPDATE`/`DELETE` grant exists on the
  audit table for any application role"); DB-trigger backstop as defence in depth
  (noted as a future addition — see §5, not built in this proposal since no
  application-level audited actions exist yet to backstop).
- **Constitution** — Law #1 (rejection reason must be coded, not free text — directly
  shapes `specimen.rejection_reason`), Law #4 (RLS from the creating migration, the
  reason TASK-023/024 are not separable schema-wise — see §5), Law #5 (every
  clinically significant action audited — TASK-025's entire reason for existing).
- **ADR-0004** — precedent that `code_system_value` is reserved for genuine
  coding-standard values (LOINC/UCUM), not lab-internal operational codes — informs
  §10 Q2 rather than reusing it for specimen rejection reasons.
- **ADR-0005** — the accepted, generically-named "forward-referencing columns"
  pattern, directly reusable for `order.patient_id` (patient table doesn't exist
  until TASK-038/M3) without drafting a new ADR.

## 4. Skills loaded

- `workflow/plan` (this proposal), `workflow/develop` (for the implementation step
  once approved), `engineering/database-design` (RLS/migration conventions — its
  third entry, added after TASK-021, on cross-checking a migration's literal wording
  against the Constitution's literal text, applies directly to the Law #4
  same-migration question in §5).
- `engineering/rls-multi-tenancy` — **required by FEAT-006's own issue and does not
  exist yet**, same gap class FEAT-004/FEAT-005 hit with other Skills. Not a blocker;
  TASK-024 is the natural task to author it (see §2), not deferred again.

## 5. Assumptions & autonomous decisions

- **TASK-023 and TASK-024 are not separable at the schema level; TASK-024's real
  deliverable is verification, not new policy SQL.** FEAT-006's issue lists TASK-024
  as "tenant_id + RLS policies on all tenant tables" with expected output "RLS
  policies applied across the schema," which read literally could imply new SQL.
  But Constitution Law #4 is unambiguous and non-negotiable: "Every tenant-scoped
  table has an RLS policy from the migration that creates it, not a follow-up" — and
  every migration in this repo so far (TASK-016 through TASK-022, no exception) has
  done exactly that, including on join tables (`panel_test`, `test_analyte` both
  carry their own `tenant_id` + policy despite being pure link tables). So
  `order`/`ordered_test`/`specimen`/`specimen_fulfillment` get `tenant_id` + RLS in
  TASK-023's own migration (0009), not a follow-up — there is no other Constitution-
  compliant order of operations. TASK-024's actual content, then, is the
  comprehensive cross-table isolation-*proof* (a real test suite proving no query
  shape leaks, across both the new tables and a regression sweep of every existing
  tenant table) and authoring the still-missing `rls-multi-tenancy` Skill — testing
  and documentation work, correctly sequenced to depend on TASK-023 as its issue
  already states, but not itself introducing new RLS DDL. Flagged here rather than
  silently resolved because it changes what TASK-024's PR actually contains.
- **`order.patient_id` follows ADR-0005 directly** — required `uuid`, no FK, same
  forward-reference shape as `observation.patient_id`, backfilled at TASK-038 (M3).
  Reusing the existing, generically-named ADR rather than drafting a new one, per
  ADR-0005's own stated intent to be citable by exactly this kind of future table.
- **Scope is TASK-023's literal expected output, not KB-02's full `Order` aggregate.**
  KB-02 describes `Order` as also carrying priority, clinical notes, diagnosis codes,
  and a billing linkage reference, and `OrderedTest` as having provider/ordering
  context. None of that is in TASK-023's stated expected output
  (`db/migrations/000X_order_specimen.sql`) or AC ("one specimen correctly fulfils
  two distinct ordered tests"), and no provider/diagnosis-catalog table exists yet
  in this repo at any milestone through M1. This proposal builds only: `order`
  (id, tenant_id, patient_id, status, created_at), `ordered_test` (id, tenant_id,
  order_id, test_definition_id, status, created_at), `specimen` (lifecycle +
  lineage + coded rejection, detailed below), `specimen_fulfillment` (the M:N link).
  Priority/clinical-notes/diagnosis/billing/provider are deliberately deferred to
  whichever future task actually consumes them (order-entry API/UI, M3) rather than
  added now as unused forward-referenced columns — same "backlog reality overrides
  KB's abstract completeness" precedent FEAT-005 used for its own FK-sequencing gap.
  Routed to §10 Q3 for explicit confirmation since it is a real scope boundary, not
  an unambiguous reading.
- **`order`/`ordered_test.status` are unconstrained `text`, not a modeled state
  machine.** KB-02 cites KB-03 (Business Workflows) for the actual transition rules,
  and KB-03 is not among FEAT-006's own cited architecture documents. Enforcing "OrderedTest
  status transitions are monotonic within an allowed state machine" is real future
  work, not something TASK-023's narrow AC requires. `status text NOT NULL DEFAULT
  'pending'` for both tables now; full transition enforcement deferred.
- **`specimen.status` mirrors KB-22's state machine as plain `text`**, following this
  repo's established discriminator convention (`text`, not `ENUM` — ADR-0006 scoped
  its ENUM decision to `observation.data_type` only and was explicit that this is
  "not a general license to enum other discriminator columns"): `collected`,
  `received`, `accessioned`, `in_process`, `completed`, `archived`, `disposed`,
  `rejected`. A `CHECK` constraint restricts the column to exactly these eight
  values (bounded and stable per KB-22, so a CHECK is appropriate even without a
  full state-machine engine enforcing legal transitions between them).
- **Specimen lifecycle/status updates are plain `UPDATE`s, not append-only.**
  Constitution Law #2 ("verified clinical data is append-only") governs *results*
  (`observation`), not administrative/workflow state. A specimen's status is
  operational tracking, not a clinical value — same distinction already drawn for
  `order`/`ordered_test.status`. Direct `UPDATE` on these columns does not violate
  Law #2. Read directly off Law #2's literal scope ("clinical data"), same
  literal-text-first method `engineering/database-design`'s third entry calls for.
- **`specimen.collection_context` is `jsonb`, not typed columns**, for
  fasting/tourniquet-time/collector-note-style collection conditions KB-22 mentions.
  Per KB-06's own principle ("anything you will ever want to trend/flag/aggregate is
  a typed column; everything else may be JSONB"), collection conditions are neither
  trended nor cross-patient-aggregated, so this is squarely inside KB-06's own JSONB
  carve-out, not a Law #1 violation (Law #1 governs *clinical values* — the result
  itself — not incidental collection metadata).
- **`specimen_fulfillment` (the M:N link) carries its own `tenant_id` + RLS policy**,
  matching the `panel_test`/`test_analyte` join-table precedent exactly (TASK-017),
  not an assumption that the parent tables' RLS is sufficient.
- **Reserved-word table name:** `order` is a reserved SQL keyword. Drizzle already
  quotes every identifier in every migration in this repo (`"observation"`,
  `"reference_range"`, etc.), so `CREATE TABLE "order" (...)` is syntactically fine
  and needs no workaround — flagged in §6 as a place to double-check manual/raw SQL
  in tests and seeds, which must remember to quote it too.

## 6. Risks

- **`audit_event` must be explicitly locked down against `lis_app`'s own default
  grant, or KB-11's append-only guarantee is silently false.** `0002_app_role.sql`
  already ran `ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT,
  UPDATE, DELETE ON TABLES TO "lis_app"` — a blanket grant that will silently apply
  to `audit_event` the moment it's created, exactly like the `postgres`/`BYPASSRLS`
  and Constitution-Gate-regex classes of bug found this session-chain (real,
  structural, easy to miss because the table *looks* correct while the grant quietly
  isn't). TASK-025's migration must explicitly `REVOKE UPDATE, DELETE ON
  audit_event FROM lis_app` after creation, and this needs a real negative test
  (attempt an `UPDATE`/`DELETE` as `lis_app`, confirm it's rejected) — the same
  "prove the negative case" standard TASK-018/TASK-021 already established, not just
  a green migration.
- **`audit_event`'s hash chain must be scoped per tenant**, per KB-11's own wording
  ("forming a chain **per tenant**"). A naive "chain over the whole table" design
  would let one tenant's audit activity affect another's chain computation — a
  correctness bug, not just a style choice — so `prev_hash` lookup must filter by
  `tenant_id`, confirmed in the testing plan (§8).
- **Constitution Gate false-positive/negative risk on this migration is real,
  demonstrated three separate times already this session-chain** (`postgres`/
  `BYPASSRLS`, `meta/*.json` pathspec, `ENABLE ROW LEVEL SECURITY` regex ordering).
  `specimen.rejection_reason`'s CHECK-constrained text column and `order`'s reserved
  keyword are both plausible new edge cases the gate's regexes haven't seen yet —
  treat a green Gate run as a starting signal on this PR, not proof, same as noted
  in the Session Report.
- **Composite-PK gotcha from ADR-0008 applies if any FK targets `observation(id)`
  directly** — none of this proposal's new tables do (they're FK'd *from*
  `observation`, not the reverse), so this is a non-issue for TASK-023/024/025
  themselves, but worth stating explicitly so it isn't silently assumed away.

## 7. Acceptance criteria

FEAT-006's feature-level AC, plus how each will be judged:
- [ ] One specimen can fulfil two distinct ordered tests (M:N modeled correctly) —
      TASK-023. Judged by inserting one `specimen` row and two `specimen_fulfillment`
      rows against two different `ordered_test` rows, then querying both back.
- [ ] RLS isolation test proves tenant A cannot read tenant B's rows under any query
      shape — TASK-024. Judged by a cross-table integration test connected as
      `lis_app` (never `postgres`, per the TASK-017 lesson) against all four new
      tables plus a regression pass over every pre-existing tenant table.
- [ ] `audit_event` hash chain is broken and detected when a row is tampered with —
      TASK-025. Judged by a deliberate direct-SQL row mutation (bypassing the
      writer), then re-running the chain-verification check and confirming it flags
      the discontinuity.
- [ ] Specimen aliquot/parent lineage is queryable — TASK-023. Judged by inserting a
      parent specimen and a derived aliquot, then querying the aliquot's
      `parent_specimen_id` back to the parent.

TASK-level AC:
- [ ] TASK-023 (#82): as above.
- [ ] TASK-024 (#83): as above.
- [ ] TASK-025 (#84): "tampering with an audit row is detected by chain
      verification" — as above.

## 8. Testing plan

1. `pnpm db:reset` — confirm a clean migrate run with real output captured.
2. Insert a real `order` → two `ordered_test` rows → one `specimen` → two
   `specimen_fulfillment` rows linking the specimen to both ordered tests; query
   back and confirm the M:N shape (AC).
3. Insert a parent `specimen` and a child aliquot (`parent_specimen_id` set); query
   the lineage back.
4. Attempt an invalid `specimen.status` value; confirm the CHECK constraint rejects
   it. Attempt an invalid `specimen.rejection_reason` value (per §10 Q2's resolution);
   confirm the same.
5. RLS negative case, connected as `lis_app`: confirm a wrong/no-data tenant sees 0
   rows across `order`, `ordered_test`, `specimen`, `specimen_fulfillment` — this is
   TASK-024's core deliverable, not a side effect of TASK-023.
6. Insert two `audit_event` rows via the writer for the same tenant; confirm
   `hash` on the second correctly incorporates the first's `hash` as `prev_hash`.
   Insert one for a second tenant; confirm its `prev_hash` chain is independent of
   the first tenant's (per §6's per-tenant-chain risk).
7. Directly `UPDATE` an existing `audit_event` row as `lis_app` (bypassing the
   writer); confirm it is rejected by the revoked grant, not just by application
   discipline.
8. Directly mutate an `audit_event` row's stored value as `postgres` (simulating a
   compromised admin, since `lis_app`'s grant already blocks the honest-path case),
   then re-run chain verification and confirm the break is detected — this is the
   literal TASK-025 AC ("tampering ... is detected").
9. Confirm the Constitution Gate passes on this migration PR without weakening any
   invariant to get there (see §6 risk on gate edge cases).
10. `docker compose down -v` for a clean teardown afterward.

## 9. Rollback plan

Purely additive — `order`, `ordered_test`, `specimen`, `specimen_fulfillment`, and
`audit_event` are new tables with no existing data depending on them. Rollback is a
Drizzle down-migration dropping the tables, or a straight `git revert` of the
migration files followed by `pnpm db:reset`. No production data exists at this
milestone, so there is no data-loss exposure from rolling back. The `lis_app` grant
revocation on `audit_event` is table-scoped and rolls back cleanly with the table
itself (no change to the blanket `ALTER DEFAULT PRIVILEGES` statement from
`0002_app_role.sql`, which stays intact for every other table).

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-30 — Option (a).** `audit_event.id` stays `uuid DEFAULT
   gen_random_uuid()` (v4, consistent with every other table in this repo, no new
   extension dependency), with a separate `bigserial "sequence"` column added for
   guaranteed monotonic per-tenant ordering. The hash chain's correctness comes from
   `prev_hash`/`hash`, not from the ID being sortable, so this doesn't weaken
   tamper-evidence — it only deviates from KB-11's literal `uuid v7` column type,
   accepted deliberately to avoid taking on `pg_uuidv7` as this repo's first new
   Postgres extension dependency.
2. **RESOLVED 2026-07-30 — Option (a).** `specimen.rejection_reason` is `text`
   (nullable until rejected) with a `CHECK` constraint enumerating exactly KB-22's
   seven canonical values (`haemolysed`, `clotted`, `insufficient_volume`,
   `mislabelled`, `wrong_container`, `improper_temperature`, `expired`) — matches
   this repo's established text-discriminator convention (`reference_range.sex`/
   `range_type`, `specimen.status` per §5) and satisfies "coded, not free text" via
   the CHECK, not a shared catalog table. `code_system_value` reuse and a second
   native `ENUM` were both explicitly rejected (ADR-0004 and ADR-0006 scoping,
   respectively — see the option analysis above this resolution for the full
   reasoning, unchanged).
3. **RESOLVED 2026-07-30 — narrow scope confirmed.** `order`/`ordered_test` in this
   proposal build only `order(id, tenant_id, patient_id, status, created_at)` and
   `ordered_test(id, tenant_id, order_id, test_definition_id, status, created_at)`.
   Priority, clinical notes, diagnosis codes, billing linkage, and ordering-provider
   reference are deliberately deferred to whichever future order-entry task actually
   consumes them, not added now as unused forward-referenced columns.
4. **RESOLVED 2026-07-30 — reinterpretation confirmed.** TASK-024 produces no new
   RLS-policy SQL — that is structurally part of TASK-023's own migration (0009) per
   Constitution Law #4, non-negotiable and consistent with every prior migration's
   precedent. TASK-024's actual PR is the cross-table isolation-test suite (new
   tables + a regression sweep of every pre-existing tenant table) plus authoring
   the still-missing `engineering/rls-multi-tenancy` Skill.

**Approved 2026-07-30** — full FEAT-006 scope, all four open questions resolved with
the recommended option in each case. TASK-023 may proceed; TASK-024/025 follow under
this same approval per §1's stated sequencing.
