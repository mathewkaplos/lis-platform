# Implementation Proposal: FEAT-037 — FHIR R4 façade
Status: APPROVED
ADR: none required — library adoption is verified but not a load-bearing architectural decision on the scale of ADR-0011/0026/0027 (a mapper + one read-only route, no new data model)   Date: 2026-08-10   Backlog ID: FEAT-037

## 1. Goal
Satisfy the one stated acceptance criterion: a FHIR `Observation` resource generated from an
internal `Observation` validates against the R4 base profile — proven with a real FHIR validator,
not asserted from a hand-read of the spec. KB-31's own full target (SMART on FHIR, bulk `$export`,
`Patient`/`ServiceRequest`/`DiagnosticReport` mapping, CapabilityStatements) is the destination;
this task builds the first real facade route and mapping, narrowly scoped to what's asked.

## 2. Affected files
- New `apps/api/src/fhir/` module: `observation-mapper.ts` (pure mapping function), `fhir.controller.ts`
  (the facade route), `fhir.module.ts`.
- New `domain/fhir-mapping` Skill (`lis-engineering`) — referenced by this issue's own "Required
  Skills" but does not exist yet; authored from this task's real findings (same discipline as
  `domain/hl7-v2`/`engineering/authz`).

## 3. Architecture consulted
- KB-31 (FHIR Integration) — "FHIR is a facade over an ACL, not the internal model"; the
  Observation→Observation mapping table (code/value/unit/range/interpretation) this task implements
  a first real slice of.
- KB-30 (HL7) / FEAT-036 — closest existing ACL precedent in this repo (external-standard facade,
  translating from the same `codeSystemValue`-backed LOINC catalog FEAT-036's ORU builder already
  established as this schema's real coded-identity source, not `analyte`'s own bare `display`).
- `engineering/api-design` — route/response conventions for the new facade endpoint.

## 4. Skills loaded
- `engineering/api-design`.
- `domain/analyzer-integration` / FEAT-036's own ORU-generation work — the closest in-repo precedent
  for "read a verified Observation's resolved LOINC/value/unit/range/flags and serialize into an
  external standard's resource shape" (`InteropOruDataService`/`buildOru`), reused as the template
  for this mapper's own shape rather than designed from scratch.
- `domain/fhir-mapping` — does not exist yet; authored during this task.

## 5. Assumptions & autonomous decisions
- **Library adoption, verified before committing (§10 Q1 confirms the choice, not whether to
  verify):** real npm/GitHub research found the well-known `fhir` package is **deprecated** —
  its own README and npm metadata explicitly redirect to **`fhir-tool`** (same repo, actively
  maintained, last pushed 2026-03-07). Smoke-tested directly: `new Fhir().validate(resource)`
  returns `{valid, messages}`, defaulting to FHIR **4.0.0** — confirmed against both a real
  structurally-valid Observation (`valid: true`, only info/warning-level terminology-binding
  messages, no errors) and a deliberately incomplete one (`valid: false`, real `error`-severity
  messages for missing required `status`/`code`). `@types/fhir`'s bundled `r4.d.ts` (`fhir4`
  namespace) gives compile-time R4 types for constructing the resource, paired with `fhir-tool`
  for runtime validation.
- **v1 scope: `dataType: 'quantity'` observations only.** The seeded chemistry catalog is 14/14
  quantity (`domain/clinical-chemistry` entry #6, already documented) — mapping `coded`/`text`/
  `ordinal`/other data types to their own FHIR `value[x]` shapes is real, deliberately deferred
  follow-up work, not silently assumed solved (same narrowing FEAT-036's ORM mapper applied to
  single-OBR messages).
- **Only already-`verified` (or later) Observations are eligible.** A `registered`/`preliminary`
  internal result has no stable FHIR `status` mapping worth exposing externally yet — mirrors
  `InteropOruDataService`'s own "verified only" gate (FEAT-036).
- **The route is unversioned (`/fhir/Observation/:id`), not under `/v1`.** KB-31 explicitly frames
  FHIR as a second, independent facade surface, not a mapping of the internal REST API's own
  versioning scheme — matches `/auth`/`/health`'s existing precedent for routes outside the `/v1`
  resource-contract namespace (`engineering/api-design` entry #3), extended here for the same
  reason (a different contract entirely, not a new internal resource).
- **Auth reuses the existing bearer-token mechanism (`JwtAuthGuard`) — SMART on FHIR is explicitly
  out of scope.** KB-31 names SMART on FHIR as the target auth model, but building real SMART
  (dynamic client registration, `patient/Observation.read`-style scopes, launch context) is its own
  multi-day feature, not something a single "resource validates" AC asks for. Flagged, not silently
  assumed solved — see §10 Q3.

## 6. Risks
- **Terminology-binding warnings are expected, not bugs.** `fhir-tool`'s bundled base R4 definitions
  don't include the full LOINC/UCUM value sets, so a real LOINC code will always produce an
  `info`/`warning`-severity "not found in value set" message — the test must assert `valid: true`
  and the absence of `error`/`fatal`-severity messages specifically, not a zero-message response.
- **`domain/fhir-mapping` Skill doesn't exist yet** — authored from this task's real findings, same
  risk profile FEAT-036 accepted for `domain/hl7-v2`.
- Status-code mapping (internal `observation.status` → FHIR `Observation.status`) has no existing
  precedent in this repo and real ambiguity for `reported`/`rejected` — flagged as §10 Q2, not
  assumed.

## 7. Acceptance criteria
(from issue #46, verbatim)
- [ ] A FHIR Observation resource generated from an internal Observation validates against the R4
      base profile

## 8. Testing plan
- Unit tests for the mapper (`observation-mapper.spec.ts`): given a real verified `quantity`
  Observation's resolved data, the mapped FHIR resource is passed through `fhir-tool`'s real
  `validate()` and asserted `valid: true` with zero `error`/`fatal` messages.
- e2e (`fhir-observation.e2e-spec.ts`, real Postgres + Keycloak, matching this repo's own standard):
  build a real verified Observation through the actual draft/finalize/verify HTTP flow (same
  pattern `interop-oru-data.e2e-spec.ts` established), call `GET /fhir/Observation/:id`, and run
  the *actual HTTP response body* through `fhir-tool`'s validator — not just the mapper's own unit
  output — plus a 404 for a non-existent/not-yet-verified observation and a 401 for no token.
- RLS/tenant isolation is inherited from the existing `observation` table read path (no new
  tenant-scoped table this task introduces) — no new RLS isolation test needed.

## 9. Rollback plan
Entirely additive: a new module/route, no changes to existing tables or read paths. Rollback is
removing the module from `AppModule`'s imports.

## 10. Questions requiring human approval — RESOLVED 2026-08-10

1. **Adopt `fhir-tool` (+ `@types/fhir` for types) as a new dependency?** **RESOLVED: yes.**
   Verified via real installation and a real validate() smoke test (§5) — the maintained successor
   to the deprecated `fhir` package.

2. **Internal `observation.status` → FHIR `Observation.status` mapping.** **RESOLVED: as
   proposed** — `registered→registered`, `preliminary→preliminary`, `verified→final`,
   `reported→final`, `amended→amended`, `corrected→corrected`, `cancelled→cancelled`,
   `rejected→entered-in-error`.

3. **SMART on FHIR auth — confirmed deferred?** **RESOLVED: yes**, reuse the existing
   `JwtAuthGuard` bearer mechanism. A future task building a real third-party app ecosystem will
   need to revisit this route's auth model.
