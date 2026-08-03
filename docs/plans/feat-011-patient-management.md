# Implementation Proposal: FEAT-011 Patient management
Status: APPROVED
ADR: none — all four §10 questions resolved as reversible implementation/scope decisions, none
judged architectural enough to warrant one
Date: 2026-08-02    Backlog ID: FEAT-011 (#20) / TASK-038 (#97)

## 1. Goal

M2 is engineering-complete (only #2 open, blocked on a non-engineering design-partner demo). M1's
three remaining open issues are all blocked on non-engineering factors. FEAT-011 is M3's first
feature and TASK-038 is its first task — "the record every clinical action attaches to" per the
issue's own Purpose line. TASK-038's stated dependency, TASK-024 (tenant_id + RLS on all tenant
tables), is closed.

**This proposal's approvable scope is TASK-038 only, not all four of FEAT-011's tasks** — same
scope-narrowing rationale FEAT-010's proposal used (`docs/plans/feat-010-design-system-v1.md`
§1): TASK-039 (API), TASK-040 (registration form + duplicate detection), and TASK-041 (search +
profile screens) genuinely depend on TASK-038's actual column shape in ways not responsibly
knowable yet. They'll be specified in a revision to this same file once TASK-038 merges.

**Real, load-bearing finding from this proposal's own research, not present in TASK-038's issue
text:** `observation.patient_id` and `order.patient_id` are **both** forward-referencing columns
awaiting this task's FK backfill (confirmed directly in `packages/db/src/schema/observation.ts:50`
and `packages/db/src/schema/order.ts:23` — both carry a `// FK backfilled by TASK-038, see
ADR-0005` comment). TASK-038's own issue body (#97) and its `/mnt/d/LIS/research/TASK-038-...md`
mirror only name `observation`'s backfill in the last comment; `order.patient_id` needs the
identical treatment and would have been silently missed working from the issue text alone. See §3
for a second, more serious finding in the same vein.

## 2. Affected files

- `packages/db/src/schema/patient.ts` (new) — the `patient` table.
- `packages/db/src/schema/patient-alert.ts` (new) — the `patient_alert` table (TASK-038's own
  title: "patient + identifiers + alerts" — the Google Stitch Prompt Library §4.6 "Patient Alerts"
  screen is the only place in the research corpus that defines what "alerts" actually means here;
  see §3).
- `packages/db/src/schema/observation.ts` — `patientId` gains `.references(() => patient.id)`;
  the header comment (lines 28-38) updated to remove the now-resolved "backfilled by TASK-038"
  forward note.
- `packages/db/src/schema/order.ts` — `patientId` gains `.references(() => patient.id)`; same
  comment update.
- `packages/db/src/schema/index.ts` — add `export * from "./patient"` and
  `export * from "./patient-alert"`.
- `db/migrations/0012_patient.sql` (new, `drizzle-kit generate` output — this table has no
  partitioning/trigger DDL outside drizzle's vocabulary, so unlike 0007/0008 it should generate
  cleanly with no hand-editing required; `meta/0011_snapshot.json` is the reconciled baseline per
  `database-design` Skill entry #4).
- `packages/db/src/rls-isolation-check.ts` — no code change expected (it discovers tenant-scoped
  tables generically via `pg_class`/`information_schema`, per `rls-multi-tenancy` Skill entry #4);
  listed here because it must be *run*, not modified, as part of this task's testing plan.

## 3. Architecture consulted

- **KB-02 Domain Model** (`/mnt/d/LIS/research/02-domain-model.md:117-122`), the Patient aggregate:
  "Contains: identity, demographics (sex, birth date — required for range resolution), identifiers
  (MRN, national ID), merge history." Invariants: "Sex and birth date are required (or explicitly
  'unknown', which affects range resolution)"; "Patient merges are auditable and reversible in
  effect (never destroy source identity)."
- **`/mnt/d/LIS/research/TASK-038-migration-patient-identifiers-alerts.md`** — same content as
  issue #97; confirms no richer spec exists for this task beyond the one AC line ("A patient is
  queryable by both national ID and MRN").
- **KB-06 Database Architecture** (`06-database-architecture.md`) — checked directly: contains no
  canonical `patient` table DDL (unlike `observation`, which KB-06 fully specifies). This task's
  column design is derived from KB-02 + the AC + the Stitch prompts below, not transcribed from an
  existing spec the way FEAT-010's design tokens were.
- **Google Stitch Prompt Library §4.1-4.6** (`Google-Stitch-Prompt-Library.md:106-116`) — the only
  place "alerts" is defined: §4.6 "Patient Alerts" names four types (Allergy, Medical Alert,
  Infection-control/flag, VIP/confidential), each "severity-coded," with description, added-by,
  date, expiry, edit/deactivate. §4.1's field list (Identity/Contact/Emergency
  contact/Insurance/Clinical/Notes — photo, blood group, insurance, employer, etc.) is far wider
  than KB-02's "identity, demographics, identifiers" — this divergence is §10 Q1, not resolved
  here.
- **`37-security.md:25,86`** — "column-level encryption considered for the most sensitive fields
  (e.g. national IDs)" is named as an open consideration, not a decision; no ADR exists for it.
  Not resolved here — see §6 and §10 Q3.
- **ADR-0005** (forward-referencing columns) — read in full. Its acceptance criteria literally
  name only `observation_patient_id_fk`. Cross-checking its exact text against the actual schema
  (per `database-design` Skill entry #3, "cross-check a migration's exact wording against the
  Constitution/ADR's exact wording, not just its intent") surfaced two things:
  1. `order.patient_id` needs the identical backfill, and is *not* named in ADR-0005's acceptance
     criteria even though `order.ts`'s own comment cites this same ADR — a minor ADR-0005 gap in
     its own text, not a schema gap. See §5.
  2. **A real, pre-existing, unresolved gap**: `observation.ordered_test_id` and
     `observation.specimen_id` are the *other* two forward-referencing columns ADR-0005's context
     section names ("`ordered_test_id`/`specimen_id` on `observation` need their constraints added
     retroactively when TASK-023 lands"). TASK-023 (#92, the migration that created `order`,
     `ordered_test`, `specimen`, `specimen_fulfillment`) is closed, and its migration
     (`db/migrations/0009_order_specimen.sql`) exists — but grepping that file and every other
     migration for `observation_ordered_test_id_fk` / `observation_specimen_id_fk` finds nothing.
     `observation.ts`'s schema still reads `orderedTestId: uuid(...).notNull(), // FK backfilled by
     TASK-023, see ADR-0005` and `specimenId: uuid(...).notNull(), // FK backfilled by TASK-023,
     see ADR-0005` — both comments, unchanged, still describing a backfill that never happened.
     **This means ADR-0005's own acceptance criteria have been silently unmet since TASK-023
     merged** — a real, currently-live gap, not a hypothetical. Not part of TASK-038's own scope
     (different columns), but too significant to note quietly in a code comment — see §6 and §10
     Q4 for whether to fix it here or file it separately.
- **`database-design` Skill** — loaded in full; entries #1 (text vs. ENUM), #2 (forward
  references), #3 (cross-check literal wording), #4 (hand-written-migration snapshot
  reconciliation) all directly informed this proposal, cited inline above.
- **`rls-multi-tenancy` Skill** — loaded in full; entries #1 (test via `lis_app`, never
  `postgres`), #2 (join tables need their own `tenant_id`+policy too — applies to `patient_alert`),
  #4 (structural + live leak check, via `rls-isolation-check.ts`) directly inform §8.
- **`audit.ts`** (`packages/db/src/schema/audit.ts`) — confirmed no local `user`/`app_user` table
  exists anywhere in this repo; actor identity is a plain `uuid` column with no FK
  (`actorPrincipalId`), referencing Keycloak's `sub` claim directly. `patient_alert`'s
  "added-by" column follows the identical convention — see §5.
- **`engineering/api-design` and `domain/patient-identity` Skills** — FEAT-011's own issue (#20)
  names both as "Required Skills." **Neither exists** in `~/work/lis-engineering/skills/` (checked
  directly: `skills/domain/` is empty, `skills/engineering/` has no `api-design` entry). Not this
  task's blocker (TASK-038 is DB-only, no API surface), but will be load-bearing for TASK-039 —
  same "flag now, don't silently invent" precedent as FEAT-010's `frontend-design` gap.
  `standards/api-design.md` (also referenced by #20) likewise does not exist
  (`~/work/lis-engineering/standards/` is empty).

## 4. Skills loaded

- `database-design` — in full, see §3.
- `rls-multi-tenancy` — in full, see §3.
- `engineering/api-design` — **could not be loaded; does not exist.** Not needed for this
  DB-only task; flagged for whoever specifies TASK-039.
- `domain/patient-identity` — **could not be loaded; does not exist.** Same as above.
- `testing` — checked; its migration-testing guidance (RLS isolation check + a real Postgres
  instance, not mocked) is already reflected in §8, no new content beyond what
  `rls-multi-tenancy` entry #4 already establishes.
- `authentication` / `docker-pnpm-monorepo-deploy` — checked, not relevant (no auth surface, no
  deploy/infra change in a pure schema migration).

## 5. Assumptions & autonomous decisions

- **This proposal's approvable scope is TASK-038 only.** See §1.
- **Patient table scope is the KB-02-minimal core (identity, demographics required for range
  resolution, MRN + national ID), not the Stitch §4.1 mockup's full field set** (contact, emergency
  contact, insurance/billing, employer, blood group, photo, notes). FEAT-011's own AC literally
  says the registration form "captures the design partner's actual required field set" — meaning
  that set is *not yet known*, only mocked up as an illustrative example. Building 15+ speculative
  nullable columns now, before any real design-partner requirement exists, is exactly the
  premature-schema risk this repo's own conventions warn against (and per AGENTS.md: "Every schema
  change is a migration... never edit a past migration" — a wrong guess here isn't fixed by editing
  0012, only by an additive follow-up). **This is the proposal's single biggest open question — see
  §10 Q1, not decided unilaterally.** Recommendation stated there.
- **Identifiers are fixed columns (`mrn`, `national_id`), not a generic `patient_identifier(type,
  value)` table.** Matches the existing precedent of `specimen.accession_number` (a plain unique
  column, not a generic identifier table) and this repo's stated aversion to designing for
  hypothetical future requirements. Revisit as an ADR only if a genuine third identifier type
  becomes load-bearing later (see §10 Q2 for the narrower question of whether this is even worth
  asking explicitly).
- **`national_id` is nullable** (not every real patient has one — minors, foreign nationals,
  emergency/unidentified admissions are all real cases per general LIS practice, and neither KB-02
  nor the AC states it's always present) — a partial unique index
  (`WHERE national_id IS NOT NULL`) enforces per-tenant uniqueness only when present. `mrn` is
  `NOT NULL` and always unique per tenant (system-issued, always assignable at registration time).
- **`sex` is `text NOT NULL`, domain `('M','F','U')`** — matches `reference_range.sex`'s existing
  `'M'|'F'|null=any` convention (`database-design` entry #1: text discriminator, ≤4 values, stays
  text) extended with an explicit `'U'` (unknown) value rather than `NULL`, since KB-02's invariant
  is "required... or explicitly unknown" — `'U'` *is* that explicit value, not an absence of one.
  `NOT NULL` is kept because the invariant requires a value to always be present, even if that
  value is "unknown."
- **`birth_date` is a nullable `date`, `NULL` = unknown.** No sentinel date is invented; KB-02
  explicitly allows "unknown" for this field, and a null date is the more honest representation
  than a fake epoch value that could be confused with a real birth date.
- **`patient_alert.added_by_principal_id` is a plain `uuid`, no FK** — identical convention to
  `audit_event.actor_principal_id` (§3): no local user table exists, identity is Keycloak's `sub`.
- **Patient/patient_alert edits are ordinary mutable rows with an audit trail (via the existing
  `audit_event` writer, invoked at the API layer in TASK-039/040 — not this task's own scope), not
  routed through the `observation`-style append-only/`superseded_by` machinery.** Constitution Law
  #2 ("Verified clinical data is append-only") and FEAT-011's own Definition-of-Done checklist item
  ("Append-only/versioning applied to any clinical data touched") both name "clinical data"
  generically enough that this needed an explicit reading, not a silent assumption: Law #1/#2's own
  text defines "clinical value"/"verified clinical data" in terms of a structured, coded
  Observation (analyte, typed value, unit, range, status) — patient demographics are the *subject*
  of clinical data, not clinical data themselves, and `order.status` (already mutable, no
  append-only trigger) is the closest existing precedent for this same class of non-Observation
  operational data. Stated explicitly here per `database-design` entry #3's "cross-check literal
  wording" standard, rather than left as an unexamined reading.
- **`order.patient_id`'s FK backfill is included in this task's scope**, even though ADR-0005's own
  acceptance criteria only literally name `observation_patient_id_fk`. `order.ts`'s own comment
  independently cites ADR-0005 for the identical treatment, and leaving it out while fixing
  `observation`'s would be an inconsistent half-fix of the same underlying gap. Flagged as a minor
  ADR-0005 text gap, not re-litigated as its own decision — see §10 Q4's note.

## 6. Risks

- **Pre-existing, unresolved ADR-0005 gap found during this proposal's research (§3): TASK-023
  never backfilled `observation_ordered_test_id_fk` / `observation_specimen_id_fk`.** This is real
  and currently live — not something this proposal's own scope caused, but too significant to
  leave undecided. See §10 Q4.
- **§10 Q1 (patient table width) is the proposal's central open risk**: if the human wants the full
  Stitch field set built now instead of the KB-02-minimal core, this changes the migration's shape
  materially before implementation starts — better resolved now than mid-implementation.
- **`engineering/api-design` / `domain/patient-identity` Skill gaps** (§3/§4) are not this task's
  blocker but will be load-bearing for TASK-039's own proposal revision.
- **National ID column-level encryption** is named as a real consideration in `37-security.md` with
  no ADR resolving it either way. This proposal does not add encryption (matches every other
  column in this schema — none has it yet), but flags the gap explicitly rather than silently
  treating "considered" as "decided against." See §10 Q3.
- **Patient merge** is a stated KB-02 domain invariant ("Patient merges are auditable and
  reversible... never destroy source identity") with no corresponding task anywhere in FEAT-011's
  four tasks. Not built here — flagged so it isn't later assumed to already exist. Comparable to
  FEAT-010's app-shell org/branch-switcher gap (built ahead of, or in this case behind, its real
  requirement).
- **First table in this repo with a partial unique index** (`ux_patient_tenant_national_id ...
  WHERE national_id IS NOT NULL`) — low risk (standard Postgres feature, drizzle-kit supports
  partial indexes), but worth a direct check that `drizzle-kit generate` emits the `WHERE` clause
  correctly rather than a full unique index, since no existing migration in this repo exercises
  that path yet.

## 7. Acceptance criteria

TASK-038's literal AC (the only AC this proposal covers):
- [ ] A patient is queryable by both national ID and MRN. Judged by: `patient.mrn` (`NOT NULL`,
  unique per tenant) and `patient.national_id` (nullable, unique per tenant when present) both
  exist with supporting indexes; a direct `SELECT ... WHERE tenant_id = $1 AND mrn = $2` and
  `SELECT ... WHERE tenant_id = $1 AND national_id = $2` both return the correct row against seeded
  test data.

FEAT-011's feature-level AC is explicitly **not** claimed as satisfied by this proposal —
duplicate-detection (TASK-040), search/profile screens (TASK-041), and the API layer (TASK-039)
are out of scope here; see §1.

## 8. Testing plan

1. `pnpm --filter @lis/db typecheck`/build with the new `patient.ts`/`patient-alert.ts` schema
   files and the `.references()` additions to `observation.ts`/`order.ts`.
2. `pnpm db:reset` (drop/recreate/migrate/seed), confirming `0012_patient.sql` applies cleanly on
   top of the existing 11 migrations.
3. Immediately after, confirm the *next* `drizzle-kit generate` run stays clean (produces no
   redundant DDL against tables 0012 already created) — per `database-design` Skill entry #4's
   explicit warning that this is not automatic and must be checked directly, not assumed.
4. `pnpm --filter @lis/db rls-check` (`rls-isolation-check.ts`) against both new tables — both the
   structural sweep (RLS enabled + a policy exists) and the live leak check (seeded data under
   tenant A genuinely invisible to a session set to tenant B), connected as `lis_app`, never
   `postgres`, per `rls-multi-tenancy` entries #1 and #4.
5. A direct query test proving both AC query paths (national ID and MRN lookup) against seeded
   data, plus a negative case confirming the partial unique index on `national_id` allows multiple
   `NULL`s per tenant (real patients without a national ID) while rejecting a true duplicate.
6. `ALTER TABLE observation ADD CONSTRAINT observation_patient_id_fk ...` and the `order` equivalent
   verified by attempting an insert with a non-existent `patient_id` and confirming Postgres
   rejects it (proves the FK is real, not just present in the migration file).
7. `pnpm typecheck`/`pnpm lint` at the repo root — confirms no regression elsewhere from the
   `observation.ts`/`order.ts` schema edits.

## 9. Rollback plan

Additive for `patient`/`patient_alert` (new tables, no existing data depends on them). The
`observation`/`order` FK backfills are the only change touching existing tables — both are pure
`ADD CONSTRAINT` statements with no data mutation, safely reversible via `DROP CONSTRAINT` if
needed. No production data exists at this milestone. Rollback is reverting the PR:
`db/migrations/0012_patient.sql` is never edited after merge (per AGENTS.md's migration rule); an
actual rollback would be a new down-migration, not a rewrite of 0012.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-02 — KB-02-minimal core.** Identity, demographics (sex/birth date), MRN +
   national ID only. Contact/insurance/emergency-contact/photo/blood-group fields wait for a
   follow-up migration once TASK-040 confirms the design partner's actual required fields.
2. **RESOLVED 2026-08-02 — fixed columns.** `mrn` + `national_id` as plain columns on `patient`,
   matching the existing `specimen.accession_number` precedent. Revisit as an ADR only if a third
   identifier type becomes load-bearing later.
3. **RESOLVED 2026-08-02 — defer encryption.** Plain column, protected only by tenant RLS, matching
   every other column in this schema today.
4. **RESOLVED 2026-08-02 — file separately.** The pre-existing ADR-0005 gap
   (`observation.ordered_test_id`/`specimen_id` never FK-backfilled by TASK-023) is tracked as its
   own follow-up issue, not fixed inside this migration. This proposal's diff stays scoped to
   `patient_id` only, per TASK-038's own issue.

**All four questions resolved — see Status header. Implementation begins now.**

---

# Revision: TASK-039 — API: create/search/get patient (Zod + OpenAPI)
Status: APPROVED
ADR: ADR-0013 (minimal API baseline — accepted 2026-08-02, establishes the Zod/OpenAPI/error/
versioning conventions this revision implements against)
Date: 2026-08-02    Backlog ID: TASK-039 (#98)

## 1. Goal

TASK-038 (patient/patient_alert migration) merged via PR #261; TASK-039's own dependency is
satisfied. This is the first task in the entire repo to build a real domain-resource API endpoint —
every existing route lives under `apps/api/src/auth/` and is a proof-of-concept for the
capability/audit mechanism (FEAT-009), not a real business resource. Confirmed directly, not
assumed: no `zod` dependency exists anywhere in the repo; no `@nestjs/swagger` or other OpenAPI
tooling exists; `apps/api/src/main.ts` has no global validation pipe or exception filter;
`packages/domain/src/index.ts` and `packages/sdk/src/index.ts` are both still their original
placeholder `export {}`.

Because whatever this task does becomes the pattern every later endpoint copies, and KB-08 (API
Architecture) specifies a full platform contract far beyond what a single M-sized, 1-day task's own
AC ("Endpoints are RLS-enforced and validated via shared Zod schemas") requires, the scope question
was raised to the human directly before drafting further (2026-08-02) and resolved as **ADR-0013**:
adopt a minimal baseline now (Zod-driven validation + OpenAPI from one schema source, RFC 9457
errors applied globally, `/v1` prefix scoped to new resource routes only) and defer
`ETag`/`If-Match`, `Idempotency-Key`, and cursor pagination until a task's real requirements need
them. This revision implements TASK-039 against that ADR.

**This revision's approvable scope is TASK-039 only**, same scope-narrowing precedent as TASK-038's
own proposal §1 and FEAT-010's proposal §1 — TASK-040 (registration form + duplicate detection) and
TASK-041 (search + profile screens) depend on TASK-039's actual response/request shape in ways not
responsibly knowable yet.

## 2. Affected files

- `packages/domain/package.json` — add `zod` as a dependency (first real dependency this package
  has ever had).
- `packages/domain/src/patient.ts` (new) — the shared `zod` schemas: `PatientCreateSchema` (request
  body for create), `PatientSchema` (the full persisted shape, used for responses), a
  `PatientSearchQuerySchema` (query params for search). Single source of truth per ADR-0013 §1 — no
  parallel OpenAPI-only schema maintained separately.
- `packages/domain/src/index.ts` — `export * from "./patient"` (this package's first real export).
- `apps/api/package.json` — add `zod`, `nestjs-zod`, `@nestjs/swagger` as dependencies.
- `apps/api/src/main.ts` — wire `ZodValidationPipe` as `APP_PIPE` (or per-controller — see §5),
  register the new global RFC 9457 exception filter, and mount `SwaggerModule` (via
  `cleanupOpenApiDoc`) at a docs route.
- `apps/api/src/common/problem-details.filter.ts` (new) — the global RFC 9457 `problem+json`
  exception filter (ADR-0013 §2): catches `HttpException` broadly, special-cases `nestjs-zod`'s
  `ZodValidationException` to enumerate field-level `errors`, formats every other `HttpException`
  (401/403/404/etc.) into the same `{type, title, detail, instance, code}` shape.
- `apps/api/src/patient/patient.controller.ts` (new) — `POST /v1/patients`, `GET /v1/patients`
  (search by `mrn`/`nationalId`, exact match only — TASK-039's own AC covers exactly these two
  lookups, not free-text/name search, which is TASK-041's own future concern), `GET
  /v1/patients/:id`.
- `apps/api/src/patient/patient.module.ts` (new), registered in `AppModule`.
- `apps/api/test/patient.e2e-spec.ts` (new) — real-Postgres, real-Keycloak-token e2e coverage,
  matching every existing e2e spec's own standard (`get-keycloak-token.ts`), not a mocked-auth unit
  test.

## 3. Architecture consulted

- **ADR-0013** (this session) — the baseline this revision implements against; see §1.
- **TASK-038's own migration/schema** (`packages/db/src/schema/patient.ts`) — the persisted shape
  this task's Zod schemas must mirror: `mrn` (unique per tenant), `nationalId` (nullable, unique per
  tenant when present), `firstName`/`lastName` (required), `middleName` (optional), `sex`
  (`'M'|'F'|'U'`), `birthDate` (nullable).
- **FEAT-011 issue (#20) AC**: "Patient searchable by national ID and MRN with correct results" —
  the literal scope of the search endpoint.
- **Google Stitch Prompt Library §4.1** — "Patient Number [auto, monospace, read-only]" is the only
  place in the research corpus that speaks to MRN generation at all; treated as a real signal (see
  §10 Q1), not authoritative on its own given FEAT-011's AC explicitly says the *rest* of §4.1's
  field set isn't confirmed yet.
- **`apps/api/src/auth/*`** (capability-check/tenant-check controllers, `TenantContextInterceptor`,
  `AuditInterceptor`, `CapabilityGuard`, `JwtAuthGuard`) — read in full as the only existing
  precedent for how a route gets tenant-bound (`ADR-0010`) and audited (`FEAT-009`). Directly
  informs §5's capability/audit design, including a real constraint found by reading
  `audit.interceptor.ts` line-by-line: `AuditInterceptor` writes `actorRole: request.grantingRole`,
  which only exists if `CapabilityGuard` ran first — an audited route with no capability gate would
  write `undefined` into `audit_event.actor_role` (`NOT NULL`), a real insert-time failure, not a
  hypothetical. See §5/§10 Q2.
- **`packages/db/src/schema/audit.ts`** — `actorRole: text("actor_role").notNull()`, confirming the
  constraint above directly against the schema, not just the interceptor's code.
- **`database-design` Skill entry #4** (added this session, TASK-038) — re-read given this task also
  touches `patient`; not directly applicable here (no FK backfill in this task), but its underlying
  discipline ("grep every caller before considering a schema-adjacent change done") applied to §8's
  testing plan regardless.

## 4. Skills loaded

- `rls-multi-tenancy` — re-checked; `TenantContextInterceptor` (ADR-0010) already provides the
  binding this task's endpoints need, no new RLS work required.
- `engineering/api-design` and `domain/patient-identity` — **still do not exist** (confirmed again;
  same gap TASK-038's proposal already flagged). Now genuinely load-bearing, not hypothetical — this
  is the first API task in the repo. Recommend authoring `engineering/api-design` immediately after
  this task lands (same-day rule), using ADR-0013 plus this task's own real decisions as its first
  content, rather than inventing it speculatively now ahead of real findings.
- `testing` — re-checked; its "verify against the real harness" standard (also AGENTS.md's own
  four-instance rule, extended this session) directly shapes §8's insistence on a real e2e spec, not
  a mocked-request unit test alone.

## 5. Assumptions & autonomous decisions

- **Search is exact-match only, by `mrn` or `nationalId`** — matches FEAT-011's own AC literally;
  free-text/name search is TASK-041's own future concern once its real UI requirements exist, not
  built ahead of that task per this repo's stated aversion to premature scope.
- **`GET` routes (search, get-by-id) are not audited; `POST /v1/patients` (create) is**, via the
  existing `@Audit()`/`AuditInterceptor` mechanism. Matches the existing convention exactly (no
  existing `GET` route in this repo carries `@Audit()`; `order-count` is a plain read) and
  Constitution Law #5's own scope ("every clinically *significant action*" — a read is not an
  action). Not treated as ambiguous.
- **`ZodValidationPipe` is applied globally** (`APP_PIPE` in `AppModule`), not per-route, matching
  `nestjs-zod`'s own documented recommended pattern and ADR-0013 §1's "one global pipe" framing.
  Confirmed safe against every existing route: none of `auth/*`'s routes currently use a NestJS DTO
  class for `@Body()`/`@Query()` (they read `@CurrentUser()`/`@DbTx()` only), so the global pipe has
  nothing to validate on those routes — a no-op for them, not a behavior change.
- **The global RFC 9457 filter's `type` URI is a placeholder scheme** (e.g.
  `https://lis.internal/problems/{code}`) until this platform has a real public docs domain — cosmetic,
  reversible, not blocking.

## 6. Risks

- **§10 Q1 (MRN generation) and §10 Q2 (capability/audit-actor-role model) are both genuinely open**
  — see below, not decided unilaterally.
- **First use of `nestjs-zod` and `@nestjs/swagger` in this repo** — low risk (both are mature,
  widely-used packages, confirmed via Context7 against current docs, not assumed from training
  data), but worth a direct, real check that `cleanupOpenApiDoc`'s output is actually valid OpenAPI
  (§8), not just that the Swagger UI renders without erroring.
- **Global RFC 9457 filter changes every existing route's error-response *body* shape** (not status
  codes) — ADR-0013 §Consequences already accepts this as deliberate, but §8 re-verifies the
  existing e2e suite still passes unmodified as the actual proof, not just the ADR's own reasoning.
- **`engineering/api-design` Skill gap is now load-bearing, not hypothetical** (§4) — recommend
  authoring it same-day once this task's real decisions exist to draw from.

## 7. Acceptance criteria

TASK-039's literal AC (the only AC this revision covers):
- [ ] Endpoints are RLS-enforced and validated via shared Zod schemas. Judged by: `POST
  /v1/patients`, `GET /v1/patients`, `GET /v1/patients/:id` all require `JwtAuthGuard` +
  `TenantContextInterceptor` (real tenant isolation, not app-level filtering); request
  bodies/queries are validated against the `packages/domain` Zod schemas via the global
  `ZodValidationPipe`, rejecting malformed input with a `400` `problem+json` response enumerating
  field-level errors; a cross-tenant `GET /v1/patients/:id` for another tenant's patient returns
  `404` (RLS makes the row structurally invisible, not a leaked "exists but forbidden" signal).

FEAT-011's feature-level AC is explicitly **not** claimed as satisfied by this revision —
registration-form duplicate detection (TASK-040) and the search/profile UI (TASK-041) are out of
scope here; see §1.

## 8. Testing plan

1. `pnpm --filter @lis/domain typecheck`/build with the new `patient.ts` Zod schemas.
2. `pnpm --filter api typecheck`/build with the new controller/module/filter/pipe wiring.
3. A real e2e spec (`apps/api/test/patient.e2e-spec.ts`), real Postgres + real Keycloak token, per
   `testing` Skill / AGENTS.md's harness-mismatch rule — not a mocked-request unit test alone:
   - create succeeds (`201`), response matches the Zod response schema, an `audit_event` row is
     written attributing the real caller;
   - create with a malformed body (missing `lastName`, invalid `sex` value) returns `400`
     `problem+json` with field-level errors, no row written;
   - create with a duplicate `mrn`/`nationalId` for the same tenant returns a real conflict
     response (`409`, mapped from the Postgres unique-violation — not a raw `500`);
   - search by `mrn` and by `nationalId` both return the correct row;
   - `GET /v1/patients/:id` for a patient created under a *different* tenant's token returns `404`,
     proving RLS isolation at the API layer, not just the DB layer (`rls-isolation-check.ts` already
     proved the DB layer in TASK-038).
4. The full existing `apps/api` e2e suite (`app.e2e-spec.ts`, `auth.e2e-spec.ts`,
   `tenant-context.e2e-spec.ts`, `capability-check.e2e-spec.ts`) re-run and confirmed still green,
   proving the global Zod pipe + RFC 9457 filter are non-breaking for every existing route (§5/§6).
5. `SwaggerModule`'s generated document fetched and validated as real OpenAPI (a schema validator,
   not just "the UI renders") — confirms `cleanupOpenApiDoc`'s output is actually spec-compliant,
   not just visually plausible.
6. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive for `packages/domain`/`packages/sdk`-adjacent files and the new `patient` module — no
existing route or table is modified except `main.ts`'s global pipe/filter registration, which §5/§8
confirm is a no-op for existing routes. Rollback is reverting the PR: new dependencies removed,
`patient.controller.ts`/`patient.module.ts`/`problem-details.filter.ts` deleted,
`packages/domain/src/patient.ts` deleted, `main.ts` reverts to no global pipe/filter/Swagger mount.
No production data or deployed feature depends on this yet.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-02 — server-generated.** MRN is generated by the API at creation time via a
   retry-on-unique-violation scheme, not accepted as caller input. Exact format decided at
   implementation time (a reversible, cosmetic detail).
2. **RESOLVED 2026-08-02 — new `manage_patients` capability.** Added to `capabilities.ts`, granted
   to both existing roles (`technologist`, `verifier`) for now. `POST /v1/patients` gated with
   `@RequireCapability('manage_patients')` + `CapabilityGuard`, reusing the existing
   `AuditInterceptor` mechanism unchanged.

**Both questions resolved — see Status header. Implementation begins now.**

---

# Revision: TASK-040 — Registration form + duplicate detection
Status: APPROVED
ADR: none — §10 Q1 resolved as a reversible, well-reasoned scope decision, not architectural
Date: 2026-08-02    Backlog ID: TASK-040 (#99)

## 1. Goal

TASK-039 (patient API) and the session token bridge (#265/ADR-0014) are both merged — the two
things this task actually depends on (a working `/v1/patients` endpoint, and a way for `apps/web`
to call it at all) now exist. This is `apps/web`'s first real form, first real page beyond the
"Signed in" placeholder, and its first real call to `apps/api`.

**This revision's approvable scope is TASK-040 only**, same scope-narrowing precedent as every
prior revision in this file — TASK-041 (search + profile screens) depends on this task's actual
patient-detail rendering conventions in ways not responsibly knowable yet, and this task does not
build the search UI TASK-041 owns.

## 2. Affected files

- `packages/sdk/src/index.ts` (+ new files) — `packages/sdk`'s first real content: TypeScript
  types generated from `apps/api`'s live OpenAPI document (`openapi-typescript`), plus a thin typed
  fetch client (`openapi-fetch`) — no hand-maintained parallel client, per ADR-0013 §1's same
  "contract never drifts from code" principle, now extended to the generated-client side.
- `apps/web/lib/api-client.ts` (new) — `createPatientApiClient(accessToken: string)`: returns a
  **fresh** `openapi-fetch` client per call, with the `Authorization` header baked in at creation
  time — never a module-scoped singleton reused across requests. `openapi-fetch`'s own docs
  explicitly warn that caching a token in module state "is safe... for client applications but
  should be avoided for server applications" — `apps/web` is exactly that server application,
  multi-tenant and multi-user, so a cached token would leak across requests/users. Always
  constructed fresh from `getValidAccessToken()`'s own per-request result.
- `apps/web/.env.example` / staging env — new `API_BASE_URL` (default `http://localhost:4000`
  locally, matching `apps/api`'s own local port). **Confirmed directly**:
  `infra/docker-compose.staging.yml`'s `api` service has no `ports:` mapping at all, with its own
  header comment already stating the intended architecture — "apps/web never calls api from the
  browser... only server-to-server on `lis_staging_net`" — exactly this task's own call shape.
  `infra/docker-compose.staging.yml`'s `web` service environment gains `API_BASE_URL:
  http://api:4000` (the compose-internal hostname).
- `apps/web/src/patient/patient-form-schema.ts` or reuse `packages/domain`'s existing
  `patientCreateSchema` directly for client + server-side validation (exact choice at
  implementation time — likely direct reuse, avoiding a second schema for the same shape).
- `apps/web/app/(app)/patients/new/page.tsx` (new) — the registration screen.
- `apps/web/app/(app)/patients/new/actions.ts` (new) — the Server Action: duplicate-check, then
  create, calling `apps/api` via `createPatientApiClient(await getValidAccessToken())`.
- `apps/web/app/(app)/_components/sidebar.tsx` — add a "Patients" (or "Register patient") nav
  entry, since this is the first real feature page beyond the app shell's own placeholder content.
- **`apps/api/src/patient/patient.controller.ts` — `GET /v1/patients`'s search extended** to also
  accept `firstName`+`lastName`+`birthDate` as a combination (see §10 Q1) for duplicate-detection
  specifically, alongside its existing exact `mrn`/`nationalId` lookup. `packages/domain/src/
  patient.ts`'s `patientSearchQuerySchema` gains this as a third valid combination.

## 3. Architecture consulted

- **FEAT-011 issue (#20) AC**: "Duplicate-patient warning triggers on matching name+DOB+ID
  combination"; "Registration form captures the design partner's actual required field set."
- **Google Stitch Prompt Library §4.1** (Patient Registration) — the only place "duplicate
  detection" is described concretely: "Duplicate-detection callout if name+DOB+ID match an existing
  patient (‘Possible match found — review’)" — a **soft, reviewable warning**, not a hard block;
  the user can still proceed after reviewing. This directly shapes §5/§10 Q1: TASK-040 is not
  building a hard-reject mechanism (that already exists, separately, as the DB's own unique
  constraint + `409` on an exact `nationalId` collision, shipped in TASK-039) — it's a second,
  softer, earlier signal shown before save.
- **TASK-038's own KB-02-minimal scope decision** (already approved, `docs/plans/
  feat-011-patient-management.md`'s TASK-038 revision, §10 Q1) — directly bounds this task's own
  field set: the API only accepts `firstName`/`middleName`/`lastName`/`sex`/`birthDate`/
  `nationalId` today, so the registration form can only meaningfully capture those fields
  regardless of what Stitch's wider mockup shows (contact/insurance/emergency-contact/photo/blood
  group) — there is nothing yet for those fields to be submitted to.
- **`infra/docker-compose.staging.yml`** — read directly (not assumed) to confirm the
  server-to-server-only architecture already anticipated for `apps/web`↔`apps/api` calls (§2).
- **`openapi-typescript`/`openapi-fetch` docs** (Context7, this session) — confirmed the
  generate-types + thin-client pattern, and the specific server-vs-client token-caching warning
  that directly shapes §2's `createPatientApiClient` design (fresh client per call, never a
  module-level singleton).
- **`packages/ui`'s existing primitives** (`form-field.tsx`, `input.tsx`) — checked directly:
  `Input` is a generic wrapper accepting any native `type` (including `date`), and `FormField`
  already implements the label-above-input, `aria-describedby`/`aria-invalid` pattern this form
  needs. No dedicated select/radio primitive exists for the `sex` field (`M`/`F`/`U`) — see §5.

## 4. Skills loaded

- `frontend-design` — re-checked; still doesn't exist (same gap TASK-038/039's proposals already
  flagged, now a third time). Not authored here — real findings from this task become its first
  content afterward, per AGENTS.md's same-day rule, matching TASK-034/035's own precedent for the
  same gap.
- `engineering/api-design` / `domain/patient-identity` — re-checked, still don't exist (flagged a
  third time, per the breadcrumb).
- `authentication` — re-checked for the token-bridge's own established conventions
  (`getValidAccessToken()`, ADR-0014) — directly reused here, no new auth pattern invented.

## 5. Assumptions & autonomous decisions

- **`sex` is a native `<select>` wrapped in `FormField`, not a new shared `packages/ui`
  primitive.** A single three-option field for one form doesn't warrant a new reusable component
  the way `DataTable`/`StatusPill` did — those exist because multiple future screens need them;
  nothing else in this task's scope needs a select/radio primitive yet. Revisit only if a second,
  independent need for one appears.
- **The duplicate-check and the create both happen inside one Server Action**, sequentially (check
  first, if the user confirms past a warning, then create) — not two separate round trips the
  client orchestrates. Keeps the token-refresh/API-call pattern in one place, matching
  `getValidAccessToken()`'s own "Server Action or Route Handler only" constraint (ADR-0014 §3).
- **Name matching for duplicate detection is case-insensitive exact match**, not fuzzy/phonetic
  (e.g. no Soundex/Levenshtein). A real patient-matching algorithm is its own substantial body of
  work, well beyond this task's 2-day sizing — exact-match-on-normalized-casing is the honest,
  scoped starting point; a follow-up task can add fuzzier matching once this simpler mechanism's
  real false-negative rate is actually observed.

## 6. Risks

- **§10 Q1 (duplicate-match criteria) is the one genuinely open, load-bearing question** — changes
  the API extension's actual shape, not decided unilaterally.
- **First real `apps/web`-to-`apps/api` call** — the token bridge (ADR-0014) was built and tested
  against a real Keycloak refresh call, but never yet exercised end-to-end against a real
  `apps/api` request. Worth a direct, real check (§8), not assumed to work from the token bridge's
  own tests alone.
- **`API_BASE_URL` staging wiring is a real infra change** (`infra/docker-compose.staging.yml`),
  not just application code — per this repo's own established rule (AGENTS.md's Rules of
  engagement: check runbooks/access constraints before drafting a mechanism touching
  staging/production infra), confirmed directly against the compose file itself (§2/§3) rather than
  assumed.
- **`packages/sdk`'s first real build** — first time this package has real content; worth
  confirming its own `tsc -p tsconfig.json` build step actually works with generated
  `openapi-typescript` output before considering this "done."

## 7. Acceptance criteria

TASK-040's literal AC (the only AC this revision covers):
- [ ] A duplicate name+DOB+ID combination triggers a warning before save. Judged by: submitting a
  registration whose `firstName`+`lastName`+`birthDate` (and `nationalId`, when provided — see §10
  Q1) matches an existing patient in the same tenant shows a review callout ("Possible match
  found") before the create actually happens; the user can still proceed (soft warning, not a hard
  block) or cancel; a genuinely new patient (no match) saves without any warning shown.

FEAT-011's feature-level AC is explicitly **not** claimed as satisfied by this revision — the
search/profile screens (TASK-041) and the "design partner's actual required field set" (§3, bounded
by TASK-038's own already-approved KB-02-minimal scope) are out of scope here.

## 8. Testing plan

1. `pnpm --filter @lis/sdk typecheck`/build with the generated OpenAPI types + `openapi-fetch`
   client.
2. `pnpm --filter web typecheck`/`lint` with the new page/Server Action/API-extension changes.
3. `pnpm --filter api typecheck`/`lint` with the extended search endpoint.
4. A real, end-to-end manual check (this sandbox's `next build` has its own known, unrelated
   Turbopack quirk — see `web-verify` Skill — so `pnpm --filter web dev` is the real verification
   path, not `build`): register a patient through the actual browser form, confirm it appears via
   `GET /v1/patients/:id`; attempt a second registration with the same `firstName`/`lastName`/
   `birthDate`, confirm the review callout appears; confirm proceeding past the callout still
   creates the second patient (soft warning, not a block).
5. A real e2e spec (`apps/api/test/patient.e2e-spec.ts`, extended) proving the new
   `firstName`+`lastName`+`birthDate` search combination returns the correct row(s), matching the
   same real-Postgres/real-Keycloak standard every existing spec in that file already uses.
6. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive: new `packages/sdk` content, a new `apps/web` route + Server Action, a new nav entry, and
an additive extension to the existing search endpoint's accepted query shape (old `mrn`/
`nationalId` behavior unchanged). Rollback is reverting the PR: the new route/Server Action/nav
entry removed, the search endpoint's extension removed, `packages/sdk` returns to its placeholder
state, `infra/docker-compose.staging.yml`'s `API_BASE_URL` line removed. No production data or
deployed feature depends on this yet.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-02 — `firstName`+`lastName`+`birthDate` only.** Exact, case-insensitive match
   on these three triggers the soft "Possible match found" review callout, regardless of
   `nationalId`. An exact `nationalId` match is already a separate, harder signal the API rejects
   outright with `409` (TASK-039) — requiring it here too would make the soft warning rarely add
   value beyond that existing hard block.

**Question resolved — see Status header. Implementation begins now.**

## 11. Real bugs found and fixed during implementation (not assumed correct — verified)

1. **`apps/api`'s real (compiled, Fastify) server has never actually been able to start since
   TASK-039 shipped `SwaggerModule.setup(...)` in `main.ts`.** `@nestjs/platform-fastify`'s
   `useStaticAssets()` (which `SwaggerModule.setup` calls internally to serve the Swagger UI)
   requires `@fastify/static`, never installed. Every prior verification of `main.ts`'s own
   bootstrap path used either `Test.createTestingModule().createNestApplication()` (defaults to
   Express, never exercises Fastify at all — every existing e2e spec) or a bespoke script that
   called `SwaggerModule.createDocument`/`cleanupOpenApiDoc` directly without ever calling
   `.setup()` (this session's own earlier OpenAPI-validation checks). This task's own manual
   verification (§8 item 4) was the first time anything actually booted the real `main.ts` path
   end-to-end, and the process crashed immediately. Fixed: added `@fastify/static@^9` (pinned to
   the version range `@nestjs/platform-fastify@11.1.28` actually declares as its peer — the
   unpinned `pnpm add` resolved `10.1.2` first, which mismatches). Verified for real: the compiled
   server now starts, `/health` and `/v1/docs` both return `200`, confirmed both directly and via
   the actual Docker image (`docker build` + `docker run`, not just a build-succeeds check).
2. **A `'use server'` file may only export async functions at runtime — a plain object export
   throws only when a real request hits it, not caught by typecheck or lint.** `actions.ts`
   originally also exported `registerPatientInitialState` (a plain object) alongside the action
   function itself; Next.js's real dev server threw `A "use server" file can only export async
   functions, found object` the moment the page rendered — confirmed only by the actual Playwright
   browser check (§8 item 4), invisible to `tsc`/`eslint`. Fixed by moving the shared types and the
   `initialState` object into a separate `types.ts` file, keeping `actions.ts` to only its one
   exported async function.
3. **This sandbox's TypeScript incremental build cache (`tsconfig.build.tsbuildinfo`) is unreliable
   under WSL2** — `nest build`/`tsc -p tsconfig.build.json` repeatedly reported success while
   silently producing no `dist/` output at all, apparently because the cache believed prior output
   already existed and matched, even after `dist/` was deleted. Not a code bug; worked around by
   deleting `tsconfig.build.tsbuildinfo` before every local build attempt during this task. Noted
   here as a real, reproducible sandbox limitation for the next session, not chased further (the
   real, authoritative build proof is CI's own `pnpm build` step and the direct Docker builds this
   task's own testing plan already ran).

---

# Revision: TASK-041 — Patient search + profile screens
Status: APPROVED
ADR: none — §10 Q1 resolved as a reversible, well-reasoned scope decision, not architectural
Date: 2026-08-03    Backlog ID: TASK-041 (#100)

## 1. Goal

TASK-038/039/040 are all merged and independently re-verified; this is the last task in FEAT-011.
TASK-041's own issue AC is thin ("All four states implemented; screen is fully keyboard-navigable"),
but FEAT-011's feature-level AC assigns this task the actual substance: "Patient searchable by
national ID and MRN with correct results" (a UI for what TASK-039's API already does) and "Search
and profile screens implement all four states... and full keyboard navigation."

**Real, load-bearing finding from this revision's own research, not present in TASK-041's issue
text:** Google Stitch Prompt Library §4.2/§4.3 (the only place a "patient search" and "patient
profile" screen are defined concretely) mock up a **materially wider surface than the schema and API
this repo has actually built**. §4.2's table wants Photo, Phone, Insurance, Last visit, and an Alerts
badge as columns, plus filters for insurance/branch/has-critical-alert; §4.3's profile wants a
photo, blood group, insurance, employer, next-of-kin, inline-editable demographics, a "Merge" action,
and six tabs (Overview/Timeline/Orders/Results/Documents/Billing/Notes). None of this data exists:
`patient` (per `domain/patient-identity` Skill entry #8) is deliberately KB-02-minimal — no photo,
phone, insurance, employer, blood group, or next-of-kin columns. `patient_alert` was created by
TASK-038's own migration but **no API route reads or writes it** — TASK-039/040 never touched it.
No `order`/`observation`-reading endpoint exists yet for a Timeline/Orders/Results tab (those are
FEAT-012/014/016's own future scope). Patient merge is a named KB-02 invariant with no implementing
mechanism anywhere (`domain/patient-identity` Skill entry #6). Building any of this now would mean
inventing UI for data and endpoints that don't exist — the same premature-scope risk TASK-038/040
already flagged and declined. See §10 Q1 for the proposed narrower scope.

**This revision closes FEAT-011** — no further task follows it in the feature's own task list.

## 2. Affected files

- `packages/domain/src/patient.ts` — `patientSearchQuerySchema` gains a fourth, mutually-exclusive
  lookup mode: `q` (free-text, matched against `firstName`/`lastName`/`mrn`/`nationalId`), distinct
  from the existing `mrn`-exact, `nationalId`-exact, and `firstName+lastName+birthDate`
  (duplicate-detection) modes, which are unchanged.
- `apps/api/src/patient/patient.controller.ts` — `search()` extended to handle the new `q` mode:
  case-insensitive partial match (`ilike`) across `firstName`, `lastName`, plus exact-or-prefix match
  on `mrn`/`nationalId` (an MRN/national ID is typically typed in full or scanned, not partially
  searched the way a name is) — combined with `OR`, capped at a fixed result limit (see §5) since
  cursor pagination is explicitly deferred (ADR-0013 §Decision 4) and no task's real data volume
  needs it yet.
- `apps/web/app/(app)/patients/page.tsx` (new) — the search/list screen. `DataTable` +
  `FilterBar` (search input only, per §5) + `StatusPill` (sex, rendered as a small badge) from
  `packages/ui`. Row click navigates to `/patients/[id]`. All four states (populated, empty, loading
  skeleton, error) plus a persistent "Register patient" button linking to the existing
  `/patients/new`.
- `apps/web/app/(app)/patients/[id]/page.tsx` (new) — the profile screen. `Card`-based layout:
  identity header (name, MRN + national ID as copyable mono chips, sex, age computed from
  `birthDate`), no tabs (see §5). All four states, including a real "not found" error state for a
  bad/cross-tenant id (matches the API's `404`, per `engineering/api-design` Skill entry #7).
- `apps/web/app/(app)/patients/[id]/actions.ts` (new) — thin Server Action wrapping
  `createPatientApiClient(await getValidAccessToken())` for the profile page's server-side fetch (or
  a direct Route Handler — exact choice at implementation time, following TASK-040's own established
  `getValidAccessToken()` pattern, ADR-0014).
- `apps/web/app/(app)/_components/sidebar.tsx` — the existing "Register patient" nav entry becomes
  "Patients", linking to `/patients` (the list) with registration reachable from there, matching the
  Stitch pattern of list-screen-owns-the-create-button rather than two separate top-level nav
  entries for one resource.
- `apps/api/test/patient.e2e-spec.ts` — extended with real-Postgres/real-Keycloak-token coverage for
  the new `q` search mode (see §8).

## 3. Architecture consulted

- **FEAT-011 issue (#20) AC**: "Patient searchable by national ID and MRN with correct results";
  "Search and profile screens implement all four states... and full keyboard navigation."
- **Google Stitch Prompt Library §4.2 (Patient Search) / §4.3 (Patient Profile)** — read in full;
  see §1 for the material gap between what these mock up and what the schema/API actually support.
- **`domain/patient-identity` Skill** (drafted this session from TASK-038/039/040's real decisions) —
  entries #1-#3 (identifier/sex/birth-date shape, directly bound the profile header's fields),
  #4 (the two duplicate-detection tiers — not this task's concern, already built), #6 (patient merge
  is unbuilt — directly rules out the Stitch "Merge" action), #8 (the wider Stitch field set is
  illustrative, not built — directly rules out photo/insurance/employer/blood-group/next-of-kin).
- **`engineering/api-design` Skill** (drafted this session) — entry #7 (cross-tenant access returns
  `404`, not `403` — directly shapes the profile page's error-state handling), entry #4 (cursor
  pagination deferred until a real endpoint needs it — directly informs §5's fixed-limit decision
  for the new `q` search instead of building a pager).
- **`apps/api/src/patient/patient.controller.ts` / `packages/domain/src/patient.ts`** (TASK-039,
  read directly) — confirmed the three existing search modes and their exact shape; the new `q` mode
  is designed to be a fourth, additive, mutually-exclusive option in the same `refine()`, not a
  replacement.
- **`packages/ui`'s existing primitives** (read directly): `DataTable`, `FilterBar`, `StatusPill`,
  `StatCard`, `SlideOver`, `Card` all already exist from FEAT-010/TASK-035. `StatCard` and
  `SlideOver` are not used here — `StatCard` has no real data source yet (no order/result counts
  exist per patient), and a full profile page reads better as its own route than a `SlideOver` given
  how much header/identity content §4.3 itself wants shown.
- **`apps/web/app/(app)/patients/new/`** (TASK-040, read directly) — the existing
  `createPatientApiClient(await getValidAccessToken())` pattern and Server Action structure this
  revision reuses rather than reinventing.

## 4. Skills loaded

- `domain/patient-identity` — **authored this session** (see §1), drawn from TASK-038/039/040's real
  decisions; directly shapes §1/§5's scope-narrowing.
- `engineering/api-design` — **authored this session**, same origin; directly shapes §2/§5's search
  and error-handling design.
- `frontend-design` — checked; its four-states/keyboard-nav/primitive-reuse conventions (from
  FEAT-010) directly shape §2's screen designs.
- `authentication` — re-checked for `getValidAccessToken()` (ADR-0014), reused unchanged.
- `testing` — re-checked; its real-Postgres/real-Keycloak e2e standard and the vitest
  `design:paramtypes` gotcha (entry #6, already handled by TASK-039's explicit-schema pattern, which
  this revision's new `q` parameter must follow identically) both apply to §8.

## 5. Assumptions & autonomous decisions

- **No tabs on the profile screen; Overview content only, inline (not tabbed).** Timeline/Orders/
  Results/Documents/Billing/Notes all depend on features that don't exist yet (FEAT-012 order entry,
  FEAT-014 result entry, billing is unscoped anywhere in the current roadmap window). Building empty
  or stubbed tabs for features that don't exist would misrepresent what the product can currently do.
  Revisit once FEAT-012/014 land and have their own real content to show.
- **No inline-editable demographics, no "Merge" action.** Neither has a supporting API — TASK-039
  built `create`/`search`/`get` only, no `update`. Adding a `PATCH /v1/patients/:id` endpoint to
  support this would be new API scope beyond "search + profile screens," and patient merge has no
  mechanism anywhere yet (`domain/patient-identity` entry #6). Both are real gaps, not silently
  assumed unnecessary — flagged here for whichever future task first needs patient demographic edits.
- **Patient alerts are not shown**, despite `patient_alert` existing in the schema since TASK-038.
  No API route reads it. Building one is new API scope this task's own issue doesn't ask for
  ("search + profile *screens*," not "alerts API"). Flagged as a real, visible gap in the Stitch
  design's own "medical-alert pills" and "Alerts" column — not silently dropped.
- **Free-text search (`q`) is capped at a fixed result limit (proposed: 50 rows), no pager UI.**
  Matches ADR-0013's deferral of cursor pagination until a real endpoint needs it — patient counts at
  this milestone are test/demo-scale, not production volume. A search returning more than the cap
  shows a "refine your search" hint rather than silently truncating without explanation. Revisit
  once real data volume makes this a genuine UX problem, per `engineering/api-design` entry #4.
- **Filters are limited to the search box itself; no separate `FilterBar` filter panel** (gender/age
  range/insurance/branch/has-critical-alert/registered-date from Stitch §4.2). Insurance, branch, and
  has-critical-alert have no backing data (§1); gender and registered-date *could* be built, but a
  single-field filter panel for two attributes is marginal value for this task's sizing (M, 1 day) —
  proposed to defer all filtering to a follow-up once alerts/branch data actually exist and the
  filter panel has real substance. **This is the revision's central open question — see §10 Q1.**
- **Age is computed client- or server-side from `birthDate`, not stored.** `birthDate` is nullable
  (unknown) per `domain/patient-identity` entry #3 — age display shows "Unknown" rather than a
  computed value when `birthDate` is null, never a misleading default like age 0.

## 6. Risks

- **§10 Q1 (whether to defer all filtering, or build the gender/registered-date subset now) is the
  one genuinely open, load-bearing question** — changes `FilterBar`'s actual presence on the search
  screen, not decided unilaterally.
- **The new `q` free-text search mode is a real, if small, API extension** — must follow TASK-039's
  established explicit-schema pattern (`engineering/api-design` entry #8) exactly, or it will
  silently no-op under this repo's vitest harness the same way an earlier oversight would have.
- **A materially narrower profile screen than the Stitch mockup shows** is a visible product gap if
  presented to the design partner without context — the demo should be framed as "search, browse, and
  view an existing patient's core identity," not implied to be feature-complete against §4.3's full
  mockup. Worth flagging explicitly in the PR description, not just in this proposal.
- **This closes FEAT-011.** Once merged, `docs/plans/feat-011-patient-management.md`'s own
  Definition of Done requires the whole proposal be archived with status `IMPLEMENTED` and the merge
  commit SHA — a step worth remembering explicitly since no further task-revision will naturally
  prompt it the way TASK-039/040's own revisions prompted each other.

## 7. Acceptance criteria

TASK-041's literal AC (the only AC this revision covers), plus FEAT-011's feature-level AC items
this task is responsible for:
- [ ] All four states (populated, empty, loading, error) implemented on both the search and profile
  screens; both screens are fully keyboard-navigable (tab order, focus rings, `Enter` activates the
  focused row/button, no keyboard trap).
- [ ] A patient is findable via the search screen by MRN, national ID, or free-text name, landing on
  the correct patient's profile.
- [ ] The profile screen correctly renders a real patient's identity/demographics; a bad or
  cross-tenant id shows the error state (via the API's real `404`), not a blank page or an
  unhandled exception.

## 8. Testing plan

1. `pnpm --filter @lis/domain typecheck`/build with the `patientSearchQuerySchema` extension.
2. `pnpm --filter api typecheck`/`lint`/build with the extended `search()` handler; re-run the full
   existing `apps/api` e2e suite to confirm the three existing search modes are unaffected by the
   new `q` branch.
3. A real e2e spec extension (`patient.e2e-spec.ts`): `q` matching a name fragment, an MRN fragment
   (prefix), and a national ID returns the expected row(s); a `q` matching nothing returns an empty
   array, not an error; a result count at/above the fixed cap is verified to actually cap (seed
   enough rows to prove it, not just trust the `LIMIT` clause is present).
4. `pnpm --filter web typecheck`/`lint`/build with the two new pages + Server Action.
5. A real, end-to-end manual check via a real headless-Chromium browser (`web-verify` Skill, real
   Keycloak/Postgres/apps/api, not mocked): register a patient (existing TASK-040 flow), search for
   them by MRN, by partial name, and by national ID from the new search screen, confirm each lands
   on the correct profile; navigate to a nonexistent id directly by URL and confirm the error state
   renders, not a crash; verify keyboard-only navigation reaches and activates a search result row.
6. `pnpm typecheck`/`pnpm lint` at the repo root.

## 9. Rollback plan

Additive: two new `apps/web` routes, a small additive extension to the existing search endpoint's
accepted query shape (the three existing modes are unchanged), and a nav-label change
("Register patient" → "Patients"). Rollback is reverting the PR: the new routes and `q` search mode
removed, the nav label reverted. No production data or deployed feature depends on this yet.

## 10. Questions requiring human approval

1. **RESOLVED 2026-08-03 — search box only.** Defer all filtering (including gender/registered-date)
   to a follow-up once alerts/branch data actually exist and the filter panel has real substance
   across more than two attributes. No `FilterBar` panel in this task.
2. **RESOLVED 2026-08-03 — 50-row cap, no pager.** Matches ADR-0013's deferral of cursor pagination
   until a real endpoint's data volume needs it.

**Both questions resolved — see Status header. Implementation begins now.**

## 11. Real bugs found and fixed during implementation (not assumed correct — verified)

1. **`getValidAccessToken()` (ADR-0014) throws when called from a plain (GET) Server Component
   render, not just a Server Action/Route Handler — a real gap in ADR-0014 itself, not a hypothetical
   edge case.** Its own header comment already documented "only callable from a Server Action or
   Route Handler," since a stale-token refresh calls `cookies().set(...)`, which Next.js rejects
   outside those two contexts. TASK-040's registration flow never hit this (its one call site is a
   Server Action). TASK-041's two new screens are this repo's *first* plain-GET Server Components to
   call `apps/api` at all, and real browser verification (§8 item 5) caught it directly: the search
   page threw `Cookies can only be modified in a Server Action or Route Handler` the moment the
   access token (300s realm `accessTokenLifespan`) actually went stale mid-session — which any
   real, longer-than-~5-minute session on `/patients` or `/patients/[id]` will always eventually
   hit. Fixed in `apps/web/auth/access-token.ts`: the cookie-write (and the fail-closed
   cookie-delete) are now each wrapped in their own `try`/`catch` — a plain Server Component render
   still gets the refreshed access token for that request, just without persisting it to the
   cookie. Confirmed safe, not just convenient: Keycloak's realm has no `revokeRefreshToken`
   override (defaults to `false`, i.e. refresh tokens are not single-use here), so a non-persisted
   refresh doesn't invalidate the `refreshToken` a later Server Action/Route Handler call would use
   — it just means an extra Keycloak round trip on each stale GET render until a real mutation
   persists a fresh one. Verified end-to-end with a real headless-Chromium browser after the fix
   (§8 item 5).
2. **The new `q` cap-enforcement e2e test (seeding 51 rows) was itself flaky against a real
   Postgres/Keycloak stack, not just under this sandbox's earlier no-Docker gap.** Firing all 51
   seed requests via `Promise.all` against this suite's own `DB_POOL_MAX=1` (a single physical
   connection, set for the existing audit hash-chain ordering requirement) produced a real,
   reproducible-but-intermittent `ECONNRESET` under connection pressure — confirmed by re-running
   the isolated test twice, once failing and once passing. The test only needs 51 rows to *exist*,
   not to be written concurrently, so fixed by seeding sequentially instead of via `Promise.all`.
   Verified stable across three consecutive full-suite runs (28/28 passing each time) after the fix.
3. **This session's own Docker Desktop instance hung on startup for several minutes with no visible
   cause** (WSL2 `docker-desktop` distro reporting `Stopped`, then the daemon socket simply not
   appearing for 10+ minutes after the app process was confirmed running) — not a memory-pressure
   repeat of the prior session's known issue (`free -h`/Windows `wmic` both showed ample headroom
   this time). No code implication; noted here only as a reproducible-again instance of "Docker can
   hang on this host for reasons beyond memory pressure," in case a future session hits the same
   thing and wants to rule out memory first before waiting it out.
