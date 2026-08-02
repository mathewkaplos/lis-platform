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
