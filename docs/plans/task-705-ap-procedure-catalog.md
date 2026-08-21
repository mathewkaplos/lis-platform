# Implementation Proposal: Seed real AP procedure/billing codes into the test catalog
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #705 (part of EPIC #697)

## 1. Goal

Per the decision recorded on #698 (Phase 0): seed a starter set of
CAP-adjacent, generic AP procedure codes now rather than waiting on the
design partner's own fee schedule. Closes two original pilot-readiness
audit findings: the order-entry catalog had zero AP procedures
(chemistry/haematology/microbiology only), and the one AP case walked
through billing landed on a literal `"CBC-PLACEHOLDER"` charge code
because nothing else existed to bill against.

## 2. Affected files

- `db/seed/anatomic-pathology-catalog.sql` (new) — 8 `test_definition`
  rows (surgical pathology at 3 complexity tiers, frozen section, special
  stain, single-antibody IHC, and the ER/PR + HER2 panels that already
  connect to the existing breast-biomarker synoptic protocol, #551/#689),
  each with a real, distinct `billing_code`/`price_cents` set directly at
  insert time — not the `code || '-PLACEHOLDER'` pattern
  `chemistry-catalog.sql` uses.
- `packages/db/src/tenant-catalog-seed.ts` — added to `SEED_FILES`, so a
  brand-new self-signup tenant gets this catalog too, not just the fixed
  dev/CI tenant.
- `scripts/db-reset.sh` — added as the "fourth discipline seed," same
  ordering convention as chemistry/haematology/microbiology.
- `.github/workflows/pr.yml` — same seed step added to CI's own
  independently-duplicated seed sequence (confirmed it does not call
  `scripts/db-reset.sh`, so both needed the same addition).

## 3. Architecture consulted

`db/seed/chemistry-catalog.sql` (the "PLACEHOLDER, NOT PARTNER DATA"
honesty framing, and the tenant-literal-substitution convention
`tenant-catalog-seed.ts` relies on); `CatalogController`
(`apps/api/src/catalog/catalog.controller.ts`, confirmed a
`test_definition` with zero `test_analyte` rows renders correctly with an
empty `analytes: []`); `default-report-templates.sql` (confirmed its own
`WHERE EXISTS (test_analyte)` guard correctly skips these new AP rows,
since AP reporting goes through the case/synoptic pipeline, not the
generic per-analyte report path); `billing.service.ts`'s
`validateAndTotal` (confirmed billing reads `test_definition.billingCode`/
`priceCents` directly, no AP-specific wiring needed).

## 4. Skills loaded

None new — this is a seed-data-only change following an existing,
well-established pattern (`chemistry-catalog.sql`/`haematology-catalog.sql`).

## 5. Assumptions & autonomous decisions

- **Deliberately not CPT codes, and said so in the seed file's own header
  comment.** AMA's CPT code set (including the widely-used 88300-series
  surgical-pathology-by-complexity-level codes) is a licensed, copyrighted
  compilation — reproducing its code numbers and official descriptions
  without a license is a real legal exposure, not a style choice, and
  "CAP-standard" (the decision's own wording) is a different standards
  body from CPT/AMA in the first place (CAP defines synoptic *reporting*
  content, e.g. the cancer-protocol templates this app already implements;
  it does not define billing codes). `code`/`billing_code` here are plain
  internal identifiers, the exact same convention this catalog already
  uses for `GLU`/`CMP`/`TSH`/`LIPID` — none of those were derived from an
  external registry either.
- **No `code_system_value`/`analyte`/`unit` chain, unlike the chemistry/
  haematology files.** An AP procedure's result is a case narrative
  (gross/microscopic/diagnosis text, FEAT-067), not a numeric analyte
  value through the observation pipeline — confirmed live that
  `CatalogController` and `default-report-templates.sql` both already
  handle a zero-analyte `test_definition` correctly, so no LOINC linkage
  was needed to make these orderable and correctly excluded from the
  generic report-template seeding.
- **8 procedures chosen to span real, common AP billing categories**
  (3 surgical-pathology complexity tiers, frozen section, special stain,
  single-antibody IHC, ER/PR panel, HER2) rather than exhaustively — a
  starter set per the decision's own framing, not a claim to be
  comprehensive or partner-validated; explicitly flagged as
  placeholder/replaceable, same posture as every other seeded price in
  this repo.
- **Prices are distinct per procedure** (not the flat $15 the chemistry
  seed's placeholder step uses) so the demo/pilot at least reflects that
  different AP procedures cost different amounts, while still being
  clearly non-authoritative (no design-partner fee schedule exists yet).

## 6. Risks

Low — additive seed data only, no schema change, no code path modified
outside adding one new file to two already-parameterized seed-file lists.
`ON CONFLICT (tenant_id, code) DO NOTHING` makes it idempotent and safe to
re-run.

## 7. Testing plan

- `pnpm --filter @lis/db build` clean.
- **Live verification against real Postgres, not just review:**
  - Ran the seed file directly against the dev DB: `INSERT 0 8`, then
    re-ran it: `INSERT 0 0` (idempotent, confirmed not just assumed).
  - `tenant-catalog-seed-check.ts` (the existing real-Postgres check for
    `seedStarterCatalog`): a freshly seeded synthetic tenant now gets 27
    `test_definition` rows (was 19), confirming the new file is wired into
    onboarding for every future tenant, not just the fixed dev tenant.
  - `GET /v1/catalog` (real API, real token): all 8 `AP-*` procedures
    appear in the real order-entry catalog response.
  - Full order → invoice cycle, no mocks: created a real patient, placed a
    real order for `AP-BX-SMALL`, generated a real invoice — resulting
    line item: `billingCode: "AP-BX-SMALL"`, `totalCents: 8500` ($85.00).
    A real AP procedure code and a real, non-placeholder price on a real
    invoice.
  - All test fixtures (patient/order/invoice) deleted from the dev DB
    after verification.

## 8. Rollback plan

Revert `db/seed/anatomic-pathology-catalog.sql`, its addition to
`SEED_FILES`, `scripts/db-reset.sh`, and `.github/workflows/pr.yml`. No
migration to roll back — plain `INSERT`s into an existing table.
