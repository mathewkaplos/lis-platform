# Implementation Proposal: FEAT-027 — Analyzer #1 driver + idempotent ingestion
Status: APPROVED
ADR: adr-0027 (observation-write.service.ts extraction — see §10 Q3)
Date: 2026-08-09    Backlog ID: FEAT-027 (issue #36)

## 1. Goal

Issue #36's own purpose is "eliminate manual transcription for the design partner's highest-volume
instrument" — but no file in either repo names that instrument, and the human confirmed this session
that it isn't known yet (see §10 Q0's own resolution below). This proposal therefore narrows scope
exactly the way FEAT-026 narrowed against KB-29's full topology: build the real, protocol-independent
infrastructure a driver needs — correlation, versioned instrument→analyte mapping, and the actual
hand-off into the result pipeline — behind a synthetic/mock protocol adapter standing in for real
ASTM/HL7 parsing. The literal AC "ingest correctly via ASTM/HL7" is **not** fully met by this scope;
that requires the real instrument identity, which is out of this proposal's control.

## 2. Affected files

- **New** `apps/gateway/src/ingest/mock-driver.controller.ts` (or similar) — a synthetic driver proving
  the pipeline end to end, matching FEAT-026's own precedent (no real protocol parsing this phase).
- **New migration + schema**: `packages/db/src/schema/instrument-mapping.ts` — a new
  `instrument_analyte_mapping` table (tenant-scoped, RLS'd per Constitution Law #4 from the migration
  that creates it): `instrumentId` (text — no instrument catalog table exists yet, same "no FK, no
  catalog table" precedent as `observation.instrumentId`/`methodId`), `channelCode` (text, the
  instrument's own code for this analyte), `analyteId` (FK → `analyte`), `unitId` (FK → `unit`, the
  instrument's *native* unit), `conversionFactor` (numeric, `instrument_value * conversionFactor =
  canonical_value`; `1` when the instrument already reports in the canonical unit — resolved §10 Q1,
  a minimal multiply-on-ingest factor, not a full unit-engine), `status`
  (`draft`/`published`/`archived`, KB-29's own versioning language), `version` (int), `createdAt`.
- **`apps/api/src/gateway-ingest/gateway-ingest.controller.ts`/`.service.ts`** — rewritten from
  FEAT-026's "dedupe + acknowledge" stub into the real pipeline: correlate → map → write.
- **New `apps/api/src/observation/observation-write.service.ts`** (refactor) — extracts
  `loadWriteContext`/`resolveRangeAndFlags`/`upsertObservation` out of `ObservationController`'s
  private methods into an injectable service both the human-facing controller and the gateway-ingest
  path call, so an analyzer-ingested result gets identical range resolution, delta check, critical
  detection, and QC-gate treatment to a human-typed one (KB-29's own stated requirement). See §10 Q3 —
  this is the largest, most load-bearing single decision in this proposal.
- **`observation` schema**: a new `sourceIdempotencyKey` column (text, nullable, unique per tenant) —
  see §5 on real (DB-enforced) dedupe replacing FEAT-026's in-memory stub.
- New seed/fixture data for the synthetic driver's mapping rows (dev/test only, mirrors
  `db/seed/chemistry-catalog.sql`'s own placeholder framing).

## 3. Architecture consulted

- **KB-29 Analyzer Integration** — ingestion pipeline steps 3-6 (correlate, map, dedupe, emit) are
  this proposal's actual scope; steps 1-2 (protocol-specific receive/parse) are explicitly deferred.
- **`domain/analyzer-integration` Skill** (drafted this session from FEAT-026) — entry #1 confirms the
  common raw-result shape is already defined and shouldn't be reinvented; entry #3 is the exact
  warning this proposal's `sourceIdempotencyKey` column resolves (in-memory dedupe was flagged there
  as insufficient the moment Observations get written); entry #7 confirms issue #260's FK is already
  closed, so a bad correlation now fails loudly (23503), not silently.
- **`database-design` Skill entries #2/#4** — the new `instrument_analyte_mapping` table and the
  `sourceIdempotencyKey` column both follow this repo's "real DB constraint over app-level check"
  convention (entry #4's own lesson from issue #260).
- **KB-30 HL7** — read for the ACL pattern (HL7 stays at the edge, never touches domain tables
  directly); not directly applicable to *this* proposal's scope since no real HL7 parsing happens
  here, but the eventual real driver (once the instrument is known) should follow it.
- Existing code read directly: `apps/api/src/observation/observation.controller.ts` (`draft()`/
  `finalize()`'s private write-path methods — the refactor target), `packages/db/src/schema/
  specimen.ts` (`specimen.accessionNumber`, `specimenFulfillment`), `packages/db/src/schema/
  test-catalog.ts` (`testAnalyte` — the analyte-membership check a correlated result must pass).

## 4. Skills loaded

- `domain/analyzer-integration` (this session's own draft).
- `domain/hl7-v2` — **does not exist yet**, and per the same reasoning FEAT-026 used for
  `domain/analyzer-integration` itself, not drafted speculatively here either: no real HL7 code
  exists in this proposal's scope to draw real findings from. Draft it once a real HL7 driver is
  actually built (i.e., once the real instrument is known and happens to speak HL7, not ASTM).
- `engineering/database-design`, `engineering/testing` — as above.

## 5. Assumptions & autonomous decisions

- **No unit-conversion engine exists anywhere in this codebase today** — grepped, confirmed. KB-29's
  own text ("conversions run through the same unit engine as everything else") describes
  target-state, unbuilt infrastructure. **Resolved (§10 Q1): a minimal `conversionFactor` column on
  the mapping row** (`instrument_value * conversionFactor = canonical_value`, defaulting to `1`) —
  not a full unit-engine (no unit-graph, no automatic UCUM-pair lookup), just the one multiply this
  phase needs. `observation.valueNum` stores the already-converted canonical value;
  `observation.unit`/`unitId` snapshot the canonical unit, same as every other write path — the raw,
  as-instrument-reported value is preserved separately in the queue's own persisted `rawPayload`
  (KB-29 step 1), never lost, just not the value actually stored on the Observation.
- **Correlation logic**: `rawResult.specimenId` is treated as the specimen's `accessionNumber` (a
  barcode string, matching KB-29's own "instrument sample ID/barcode → accession" framing) —
  resolved via `(tenantId, accessionNumber)` lookup, then `specimenFulfillment` to find candidate
  `orderedTest` rows, then the mapped `analyteId` checked against that `orderedTest`'s
  `testDefinition`'s `testAnalyte` membership to pick the specific `orderedTest`. A specimen
  fulfilling more than one `orderedTest` for the same analyte (unusual but not schema-forbidden) is
  an ambiguous match — treated as an unmatched result (see §10 Q2), not resolved by guessing.
- **No auto-verification exists yet** (FEAT-031, still "Not Started") — an analyzer-ingested result
  this phase lands exactly where a human `draft()` call would (status `registered`/`preliminary`,
  same flags/critical-detection), awaiting the same human verification every result requires today.
  KB-29's own example ("an in-range, QC-passed glucose then auto-verifies with no human touch")
  describes FEAT-031's future behavior, not anything this proposal builds or should attempt to
  approximate.
- **Real, DB-enforced dedupe** (not FEAT-026's in-memory stub, per `analyzer-integration` Skill entry
  #3's own explicit warning): `observation.sourceIdempotencyKey`, unique per tenant, set from
  `rawResultIdempotencyKey()` on every driver-originated write. A retried/duplicate message hits the
  unique constraint and is treated as the already-recorded success (idempotent response), not a 409
  — matching issue #36's own AC #2 literally ("correctly deduplicated").

## 6. Risks

- **The `observation-write.service.ts` refactor touches the single most heavily-tested write path in
  the app** (`observation.controller.ts`, TASK-051 onward, dozens of e2e tests across FEAT-014/015/
  018/023/025). Extraction must be behavior-preserving — every existing `observation.e2e-spec.ts`
  assertion must still pass unchanged. This is the proposal's largest real risk, not the new driver
  code itself.
- Unmatched-result handling (§10 Q2) is currently undecided; whichever choice is made, it must not
  silently drop a real instrument result (KB-29's own explicit requirement: "unmatched results park
  in a pending-match queue rather than being dropped").
- No unit conversion (§5) means this phase cannot honestly claim to handle a real instrument
  reporting in a non-canonical unit — a real gap for whenever the actual instrument is identified,
  not something to quietly work around with a fudge factor.

## 7. Acceptance criteria

(narrowed from issue #36's own two, per this proposal's explicit scope-reduction — see §1)

- [ ] A synthetic driver, mapped via a published `instrument_analyte_mapping` row, correlates a raw
      result to the correct `orderedTest` by accession number and analyte, and writes a structured
      `Observation` through the same range-resolution/flagging/critical-detection path a human
      `draft()` call uses.
- [ ] A retried/duplicate message (same idempotency key) is deduplicated via a real Postgres unique
      constraint on `observation.sourceIdempotencyKey`, not just an in-memory check — the literal
      AC #2 from issue #36.
- [ ] An unmatched result (unknown accession, or an analyte not on the matched order) is parked, not
      dropped and not written as a malformed Observation (per whichever §10 Q2 resolution is chosen).
- [ ] Every existing `apps/api` e2e test still passes unchanged after the write-path refactor.

## 8. Testing plan

- Unit tests: correlation logic (accession → specimen → orderedTest → analyte match, including the
  ambiguous-match and no-match cases), mapping lookup (published/draft/archived version selection).
- Integration/e2e: full pipeline test via the synthetic driver — ingest → correlate → map → write →
  confirm the resulting `Observation` carries correct flags/range exactly as an equivalent
  `draft()` call would produce for the same value.
- Regression: full existing `apps/api` e2e suite (currently 272 tests) must stay green through the
  `observation-write.service.ts` extraction — this is the refactor's actual acceptance bar, not a
  nice-to-have.
- RLS isolation test for the new `instrument_analyte_mapping` table.

## 9. Rollback plan

The write-path refactor is the one piece with real blast radius (touches shipped code). Mitigated by
requiring the full existing e2e suite to pass unchanged before merge (§7/§8) — if it can't be made to
pass without behavior change, the refactor itself is the wrong shape and should be revisited before
merging, not shipped with a known regression. The new table/column are additive and reversible
(`DROP TABLE`/`DROP COLUMN`) with no data-loss risk since nothing depends on them yet.

## 10. Questions requiring human approval — RESOLVED 2026-08-09

0. **Real instrument identity — RESOLVED.** Not yet known; proceed with a protocol-agnostic driver
   skeleton (this proposal's own scope), real ASTM/HL7 parsing deferred to a follow-up once the
   design partner's instrument is identified.
1. **Unit conversion gap (§5) — RESOLVED: add a minimal `conversionFactor` column now**, not
   deferred. A plain multiply-on-ingest factor, not a full unit-engine — see §2/§5 for the exact
   shape.
2. **Unmatched-result handling — RESOLVED: reuse the gateway's existing queue/retry.** The api
   rejects an unmatched result with a distinguishable "unmatched, not a hard failure" response
   (not a plain 4xx the forwarder would otherwise treat as a permanent failure); the item stays
   queued on the gateway side and the forwarder retries it on the normal interval — reuses FEAT-026's
   existing store-and-forward mechanism rather than building a second, parallel one. A genuinely
   unmatched result (bad barcode, wrong tenant, order not yet accessioned) may resolve once
   reception/accessioning catches up.
3. **The `observation-write.service.ts` extraction (§2/§6) — RESOLVED: yes, extract.** Real refactor
   risk on shipped, heavily-tested code, accepted deliberately — KB-29 explicitly requires identical
   treatment ("range resolution, delta, critical detection, QC gate... run exactly as for any other
   result"), and the rejected alternative (duplicating the logic into the gateway-ingest path) would
   let the two copies silently drift the next time either changes. Written up as **ADR-0027**.
