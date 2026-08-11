# Implementation Proposal: FEAT-056 Cross-tenant de-identified aggregation
Status: DRAFT
ADR: adr-0048 (proposed)    Date: 2026-08-11    Backlog ID: FEAT-056 (#518)

## 1. Goal
Generalize `FEAT-055`'s own tenant-scoped AMR surveillance report into a real, safe network-wide
aggregate — the first feature in this codebase that deliberately crosses tenant isolation, even in
de-identified form. ADR-0048 (this proposal's own companion) makes the two central decisions: how
the aggregation itself is computed correctly across FEAT-045's three isolation tiers, and how
small-cell re-identification risk is actually controlled (minimum-cell-size suppression, not
per-record redaction — HIPAA Safe Harbor doesn't fit an already-aggregate output).

**This is the deepest speculative chain in this M12 sketch.** FEAT-056 generalizes FEAT-055, which
cannot be implemented until FEAT-051 and FEAT-053 both ship real tables. Nothing in this proposal
can be built, scaffolded, or tested against real data until that entire chain resolves. §10 Q1
asks explicitly whether the design is still worth approving now on that basis.

## 2. Affected files
- `packages/db/src/schema/tenant.ts` (extends) — `amrSurveillanceOptIn` boolean, default `false`
  (ADR-0048 decision 2). The smallest schema addition that satisfies explicit per-tenant opt-in —
  one flag on the existing global registry row, not a new table.
- `db/migrations/00XX_tenant_amr_opt_in.sql` (new) — the one new column.
- `packages/domain/src/amr-surveillance.ts` (extends, from FEAT-055) — a new
  `networkAmrSurveillanceEntrySchema`: `{ organismDisplay, antimicrobialDisplay, timeBucket,
  suppressed: boolean, susceptibleCount: number | null, intermediateCount: number | null,
  resistantCount: number | null, totalCount: number | null }` — every count field `null` when
  `suppressed: true` (ADR-0048 decision 5), never a fabricated/rounded number standing in for a
  real one. No tenant/facility field anywhere in this shape (decision 4).
- `apps/api/src/report/amr-network-surveillance.service.ts` (new) — the per-tenant iteration +
  merge + suppression pipeline: enumerate opted-in tenants, resolve each via the existing
  `resolveTenantRouting()` (FEAT-045, unmodified), call `FEAT-055`'s own
  `computeAmrSurveillanceReport` against each tenant's own correctly-routed connection, merge
  counts in application code, coarsen to monthly buckets, suppress any cell below n=5.
- `apps/api/src/report/amr-network-surveillance.controller.ts` (new) — `GET
  /v1/reports/network-amr-surveillance`. Authorization is a real, unresolved open question — see
  §10 Q2; this is not a normal tenant-scoped route and the existing capability system assumes one.

## 3. Architecture consulted
- ADR-0048 — this proposal's own companion, the two central decisions (per-tenant iteration across
  isolation tiers; minimum-cell-size suppression over per-record redaction).
- `packages/db/src/tenant-resolver.ts`, `packages/db/src/schema/tenant.ts` — read in full, the real
  finding that a single cross-tenant SQL query would silently miss `dedicated_schema` tenants
  entirely (ADR-0048's own Context section).
- KB-44 Analytics (de-identification governance requirement), KB-37 Security (no specific
  de-identification methodology named there — ADR-0048 fills that real gap for this feature's own
  shape).
- `docs/plans/feat-055-amr-surveillance-report.md` — the tenant-scoped report this feature
  generalizes; `computeAmrSurveillanceReport` is reused per-tenant, not reimplemented.

## 4. Skills loaded
- `engineering/database-design`.
- `engineering/api-design`.

## 5. Assumptions & autonomous decisions
- **One new boolean column for opt-in, not a new table** — not treated as an open question; a
  single per-tenant flag is the minimal state this feature's own requirement needs.
- **`dedicated_db`-tier tenants are skipped (logged), not thrown** during the per-tenant
  enumeration loop — different from `resolveTenantRouting()`'s own per-request fail-closed throw,
  since this loop's own job is producing a best-available aggregate across whichever tenants are
  actually reachable, the same "expected-shaped gap, logged no-op" discipline
  `engineering/workflow-engine` Skill entry #4 already established elsewhere in this codebase.
- **Monthly time-bucketing, not configurable in v1** — ADR-0048's own stated default; a
  finer-grained bucket option is real future scope, not silently built now.

## 6. Risks
- **Authorization shape is a real, unresolved gap** (§10 Q2) — every existing capability in this
  codebase assumes a JWT's own `tenant_id` scopes what its holder can see; this endpoint's entire
  point is showing data that spans every opted-in tenant, which no existing tenant-scoped human
  role should be able to request. Flagged explicitly rather than assumed solvable by an existing
  capability.
- **Chain depth** (§1) — four layers of unbuilt dependency (FEAT-051 → FEAT-053 → FEAT-055 →
  FEAT-056); this proposal's own design may need real revision at each layer once the ones below
  it are actually built.
- **Opt-in UX/consent flow is entirely out of this proposal's own scope** — how a tenant actually
  sets `amrSurveillanceOptIn = true` (an admin toggle? a contractual term at onboarding?) is real
  product/legal work this proposal doesn't design; v1 assumes the flag is set directly, by
  operator action, not through a tenant-facing UI.

## 7. Acceptance criteria
(unchanged from issue #518/FEAT-056, restated for traceability)
- [ ] A real de-identification standard is chosen and documented (ADR-0048) -- done, pending
      approval
- [ ] No individual patient, order, or result is ever recoverable from this feature's own output --
      provably, not just by construction
- [ ] Cross-tenant aggregation is itself audited (which tenants contributed, when, by whom it was
      requested)

## 8. Testing plan
- Unit: the merge/suppression logic (given synthetic per-tenant count maps, produces the correct
  network totals and correctly suppresses sub-5 cells) — buildable independent of FEAT-051/053/055
  landing, same reasoning FEAT-055's own §8 already used.
- Integration (real Postgres, real multi-tier fixture): blocked until FEAT-051/053/055 all ship —
  cannot prove real per-tenant-tier iteration against tables/tiers that don't exist together yet in
  a real test.
- A real re-identification-attempt test once implemented (ADR-0048's own acceptance criteria):
  given the aggregate output, confirm no individual tenant's contribution is recoverable, and no
  opted-out tenant's data appears at all.

## 9. Rollback plan
Additive: one new column, one new service, one new (unresolved-authorization) endpoint. No
existing table, function, or route is touched. Rollback is dropping the column and removing the
new files.

## 10. Questions requiring human approval
1. **This is the deepest speculative layer in M12** (§1) — FEAT-051 → FEAT-053 → FEAT-055 all need
   to ship for real before this is buildable at all. Approve ADR-0048 and this design now on that
   basis, or hold until the chain is closer to real?
2. **Authorization for a genuinely cross-tenant endpoint** — the existing capability system has no
   concept of "sees data spanning multiple tenants." Recommend the same precedent
   `gateway_ingest`/`interop_ingest` already established for a non-human caller: a new, dedicated
   machine-only Keycloak client + capability (e.g. `platform_analytics`), never folded into any
   existing human role or tenant-scoped capability. Approve that direction, or is this genuinely a
   human (platform-operator) role that needs its own design instead?
3. **n < 5 suppression threshold and monthly time-bucketing** (ADR-0048's own v1 defaults) —
   approve as the real, adjustable policy default, or is there a different threshold/cadence
   preference?
