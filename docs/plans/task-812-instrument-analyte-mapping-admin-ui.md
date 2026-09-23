# Implementation Proposal: Admin UI/API for instrument_analyte_mapping
Status: APPROVED
ADR: n/a    Date: 2026-09-21    Backlog ID: issue #812

**Approved 2026-09-23** via the native options-prompt (accepted as drafted — all 3 §10 questions
accepted at their recommended defaults: create-only/published-directly v1 scope; no archive/
supersede action for v1; `/admin/instrument-mappings` under the existing catalog-admin nav group,
gated by `manage_catalog`).

## 1. Goal

`instrument_analyte_mapping` (FEAT-027/KB-29 — translates an instrument's own channel code into a
real `analyte`/`unit`, read by the analyzer-correlation path) has a real, correct schema —
draft/published/archived lifecycle, a partial unique index preventing two published mappings for
the same `(tenant, instrument, channel)` — but no controller, no route, and no admin UI anywhere.
Confirmed via a repo-wide grep: the only way this table has ever been populated is a direct SQL
`INSERT` (this week's own analyzer-integration simulator work needed exactly that). Add a minimal
`POST /v1/instrument-analyte-mappings` route plus a minimal admin form, mirroring the existing
`/admin/tests` and `/admin/reference-ranges` create-only screens exactly — no new architecture.

## 2. Affected files

- `packages/domain/src/catalog.ts` — new `instrumentAnalyteMappingCreateSchema`/
  `instrumentAnalyteMappingResultSchema`/`instrumentAnalyteMappingListSchema` (same file the two
  closest precedents, `testDefinitionCreateSchema`/`referenceRangeCreateSchema`, already live in).
- `apps/api/src/catalog/instrument-analyte-mapping.controller.ts` — new. `POST` (create, defaults to
  `status: 'published'`) + `GET` (list, for the admin screen's own table and for a future driver's
  config visibility). Registered in `apps/api/src/catalog/catalog.module.ts` alongside
  `TestDefinitionController`/`ReferenceRangeController` — same `manage_catalog`-gated,
  `@lis/db`'s `analyte`/`unit` schema group these already belong to.
- `apps/web/app/(app)/admin/instrument-mappings/page.tsx`, `create-instrument-mapping-form.tsx`,
  `actions.ts`, `types.ts` — new. Mirrors `/admin/reference-ranges`'s shape exactly (a table of
  existing mappings + an add-only form), since both need an analyte **and** unit picker, unlike
  `/admin/tests`'s simpler analyte-only checklist.
- `apps/web/app/(app)/_components/sidebar.tsx` — one new nav entry (`/admin/instrument-mappings`,
  alongside the existing `/admin/reference-ranges`/`/admin/tests`/`/admin/referring-facilities`
  block), gated the same way those already are.
- `openapi.json` / `packages/sdk` — regenerated (CI's generated-artifact-drift check catches a
  missed regen; PR #782 hit this exact gap for the same class of change).

## 3. Architecture consulted

- `apps/api/src/catalog/reference-range.controller.ts` — the closest precedent: `POST` validates
  both a referenced `analyteId` and `unitId` exist (400 on either miss) before inserting, `GET` joins
  back through `analyte`/`unit`/`codeSystemValue` to resolve display names. This proposal's
  controller copies that exact create-then-list shape.
- `apps/api/src/catalog/test-definition.controller.ts` — the simpler precedent the issue's own
  "Recommended solution" cites; not copied as closely since it only references one existing-id set
  (`analyteIds`), not two (`analyteId` + `unitId`).
- `apps/web/app/(app)/admin/reference-ranges/page.tsx` + `reference-ranges-table.tsx` — the UI
  precedent this proposal's page/table/form mirror (analyte options sourced from the already-fetched
  `GET /v1/catalog`, no second endpoint needed for the picker).
- `packages/db/src/schema/instrument-mapping.ts` — confirms the table is already **tenant-scoped**
  (its own header comment: "contrast case, same reasoning as `delta_check_rule`/`reference_range`" —
  each lab configures its own instrument's channel mapping, unlike `analyte`/`unit` themselves,
  which are global reference data). No RLS/tenancy question to resolve — it's already correct and
  already has a `tenantIsolation()` policy from its own original migration (0026).
- `apps/gateway/scripts/simulate-instrument.sh` — the only place this table has ever been written
  from code (a raw `psql` `INSERT ... status = 'published'`) — confirms `published` is the status a
  real config needs to end up at for a driver to ever read it (`AnalyzerCorrelationService`'s own
  lookup only reads `status = 'published'` rows, per the schema's own `ix_instrument_mapping_lookup`
  index shape).
- `docs/world-class-final-assessment-2026-09.md` §23 / `docs/world-class-roadmap-2026-09.md`
  Decision 1 — the session that found this gap live while building the analyzer simulator; no ADR
  governs this screen specifically (`ADR-0045` covers global-vs-tenant reference data for
  microbiology catalogs, a different table family — checked, not applicable here since this table's
  own tenancy is already decided and documented in its own file header).

## 4. Skills loaded

- `engineering/api-design` (required — new `apps/api` route). Entry #8 (`ZodValidationPipe` can't
  see a DTO type under this repo's vitest e2e harness unless the DTO class itself is exported and
  referenced correctly) applies directly — will follow `ReferenceRangeCreateDto`'s exact
  `createZodDto(...)` shape, not a variant.
- `engineering/frontend-design` (required — new `apps/web` page/form/actions). No client-only
  library, no new dynamic route segment, no function-valued prop into a Client Component — the same
  shape `create-test-form.tsx`/`reference-ranges-table.tsx` already use safely.
- `engineering/analyzer-integration` — loaded for context on `instrument_analyte_mapping`'s own
  intended lifecycle semantics (KB-29's "draft while configuring, published when live, archived once
  superseded"), to make sure the create flow doesn't quietly violate that intent.
- `engineering/database-design` — loaded to confirm no schema/migration change is needed (none is:
  the table, its unique index, and its RLS policy all already exist from migration 0026).

## 5. Assumptions & autonomous decisions

- **Create produces a `published` mapping directly, not a `draft` awaiting a separate publish
  step.** The issue's own recommended solution says "create/publish" and cites `/admin/tests`'s
  *create-only* pattern as the model — not a two-step draft→publish workflow, which would be new UI
  surface this issue doesn't ask for. `status` is accepted as an optional field on the create schema
  (defaulting to `'published'`) so a caller *can* still create a `draft` row via the API if a future
  screen wants a review step, but the v1 admin form itself only ever submits `'published'` — matching
  the real, immediate need (a working config path for a simulated/real analyzer today).
- **Creating a mapping when a published one already exists for the same `(tenant, instrument,
  channel)` is a real 409, not silently superseding the old one.** The partial unique index already
  enforces this at the DB level; the controller catches that specific constraint violation and
  returns a clear 409 ("a published mapping already exists for this instrument/channel — archive it
  first") rather than a raw 500. **Archiving/superseding an existing published mapping is explicitly
  out of scope for this proposal** (no `PATCH`/archive route) — same "add-only, no edit action on
  this screen" precedent `/admin/reference-ranges` already established, flagged as a question below
  since it's a real, if narrow, scope line.
- **`conversionFactor` defaults to `1` in the form** (a plain input, optional, matching the column's
  own DB default) — the common case where the instrument already reports in the analyte's canonical
  unit, per the schema's own header comment.
- **`instrumentId`/`channelCode` are free-text inputs, not pickers.** No `instrument` catalog table
  exists anywhere in this codebase (confirmed via grep) — `instrumentId` is documented in the
  schema's own comment as "just a caller-supplied identifier, not a foreign key," so there is nothing
  to pick from; a plain labeled text input matches what the data actually is.
- **Placed in `apps/api/src/catalog/` and gated by the existing `manage_catalog` capability**, not a
  new capability or a new `apps/api/src/instrument/` module. The table's own schema file already
  imports `analyte`/`unit` from `./catalog`, and every other screen that lets `qa`/`lab_admin`
  configure catalog-adjacent reference data (tests, reference ranges) already lives here under the
  same capability — this is the same class of action (catalog/reference-data configuration), not a
  new domain area.

## 6. Risks

- **The 409-on-duplicate-published path is new-ish territory for this codebase** — most existing
  create routes in this catalog group either accept duplicates by design or reject via a 400 on a
  missing reference, not a 409 on a real unique-constraint hit. Will confirm the exact Postgres error
  shape Drizzle surfaces for a partial-unique-index violation (via a real e2e test, not assumed) and
  map it to a 409, mirroring how `patient.controller.ts` already handles a duplicate `nationalId`
  (409, per AGENTS.md's own PR-history reference).
- Low risk otherwise: additive-only (no migration, no change to any existing route), and the
  correlation-read path (`AnalyzerCorrelationService`) is untouched — this proposal only adds a way
  to populate the table that already exists.

## 7. Acceptance criteria

- A `qa`/`lab_admin` user can open `/admin/instrument-mappings`, see any already-configured mappings
  in a table (instrument id, channel code, analyte, unit, conversion factor, status), and submit a
  form to create a new `published` mapping bound to an existing analyte/unit.
- A non-`manage_catalog` user sees the table (read access, matching every other admin catalog
  screen's own "read for any authenticated role, write gated" convention — confirmed via
  `GET /v1/reference-ranges`'s own `JwtAuthGuard`-only, no capability, guard) but not the create form.
- `POST /v1/instrument-analyte-mappings` 400s on an unknown `analyteId`/`unitId`, 409s on a duplicate
  published `(tenant, instrument, channel)`, and 403s for a caller without `manage_catalog`.
- `openapi.json`/`packages/sdk` regenerated; `pnpm --filter web typecheck`/`lint` clean.
- Live-verified: `apps/gateway/scripts/simulate-instrument.sh`'s own manual `psql INSERT` step can be
  replaced by a real API call through this new route and still correlate successfully end to end —
  the actual proof this gap was real.

## 8. Testing plan

- New `instrument-analyte-mapping.e2e-spec.ts` (`apps/api`), mirroring
  `catalog-admin.e2e-spec.ts`'s shape: RBAC 403 for a non-`manage_catalog` role, 400 for an unknown
  analyte/unit id, successful create + list round-trip, 409 on a duplicate published
  `(tenant, instrument, channel)`.
- `pnpm --filter web typecheck`/`lint`.
- Manual `web-verify`/live-browser pass as a seeded `qa`/`lab_admin` account: create one real
  mapping, confirm it appears in the table, confirm a `technologist`-only session sees the table but
  not the form.

## 9. Rollback plan

New files + one new nav entry only — no migration, no change to any existing route or schema.
Revert the PR's commits; nothing else is affected.

## 10. Questions requiring human approval

1. **Create-only (published directly, no draft→publish two-step UI) — is this the right v1 scope?**
   Recommended: yes, matches the issue's own cited precedent and the real immediate need (a config
   path that isn't raw SQL); a draft/review workflow can be a named follow-up if a real lab ever asks
   for one.
2. **No archive/supersede action for an existing published mapping (a firmware/channel-code change
   can't be re-pointed from this screen without a fresh SQL step)** — recommended: accept this gap
   for v1, matching `/admin/reference-ranges`'s own "add-only" precedent; name it explicitly as a
   known follow-up rather than silently building toward it.
3. **Screen location: `/admin/instrument-mappings` under the existing catalog-admin nav group, gated
   by `manage_catalog`** — recommended: yes, no new capability, matches the existing grouping exactly.
