# World-Class Assessment — Fresh, September 23, 2026

**This is a fresh assessment performed against the current state of the repository and application.
Previous ratings were not used as the basis for the current score.** `docs/world-class-assessment-2026-09.md`
(5.5/10), `docs/world-class-final-assessment-2026-09.md` (5.8/10, with later post-publication updates),
and `docs/project-completeness-audit-2026-09.md` were read for historical context only. Every score
and claim below traces to direct inspection performed in this session: reading source files and
migrations, running the unit test suites locally, checking the last green CI run's job list, reading
the Keycloak realm export and Docker Compose/Terraform infra, and reading the deploy workflow's
actual steps. Where I relied on a prior session's own live-browser evidence (documented in
`docs/pilot/PILOT-USER-GUIDE.md`) rather than re-driving the browser myself this session, I say so
explicitly and do not present it as this session's own E3+ proof.

---

## 1. Executive verdict

**This is a serious, unusually honestly-engineered single-tenant-proven LIS pilot, not a world-class
LIS.** The engineering discipline is genuinely strong — real PostgreSQL RLS with `NOBYPASSRLS`, real
append-only triggers enforcing the "verified data never mutates" invariant at the database layer (not
just in application code), a real hash-chained audit log, a real HMAC-signed immutable report
version table with its own append-only/supersession triggers, a real CI pipeline that seeds four
real discipline catalogs and runs 72+ e2e specs plus a dedicated cross-tenant RLS leak check against
a real Postgres, and a real (if narrow) production deployment reachable over a hardened Tailscale
mesh. The synoptic/structured-reporting engine is genuinely generic (Protocol → Version → Element →
Response Option → Condition, all versioned, all with real conditional-visibility JSON) — not
hardcoded per organ. Against that: there is no real AI (a deterministic phrase-template engine
answers `AI_PROVIDER=template`), FHIR support is one read-only resource endpoint, billing is a thin
cash/mobile-money-stub edge with no refunds or outstanding-balance handling, protocol *authoring* has
no UI or API (every synoptic protocol enters the system only via a hand-written SQL seed file), and
several proof/demo API routes that exist purely for e2e testing are mounted unconditionally in every
environment including production. Nothing here has been used by a real design partner in anger on
real patient data; every workflow proof is either an automated test or a single session's own manual
click-through against seeded fixtures.

---

## 2. Evidence standard applied

Per dimension below I cite the E0–E6 level actually reached, using this session's own direct
verification. I do not carry forward an E-level asserted by a prior assessment without re-checking
it; where I did re-check and it held, I say "re-confirmed this session."

---

## 3. What I actually did this session

- Read `AGENTS.md` (567 lines) in full for the five invariants, PR conventions, and known gotchas.
- Enumerated `apps/api/src` (33 modules), `apps/web/app` (34 routed pages), `apps/gateway`,
  `apps/interop`, and every workspace package; counted test files by directory (130 total test
  files: 72 API e2e specs, 31 API unit specs, 9 web Playwright e2e specs, others across
  gateway/interop/domain).
- Read all 69 migration files' `CREATE TABLE`/`ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`/
  `CREATE TRIGGER` statements directly; cross-referenced every `CREATE TABLE` against
  `ENABLE ROW LEVEL SECURITY` to find the true set of tables without RLS.
- Read `packages/db/src/audit.ts` (hash-chain construction), `case-report-signature.ts` (HMAC
  signing), `rls-isolation-check.ts` (the structural + live-leak dual check), and the four DB
  triggers that enforce append-only/status-transition invariants at the Postgres layer.
- Read `apps/api/src/ai/*` in full: the provider registry, the stub provider, and the template
  provider — confirmed no real model vendor call exists anywhere in the codebase.
- Read `infra/keycloak/lis-realm.json` (session lifetimes, client configs, committed dev secrets,
  user profile config) and `infra/docker-compose.staging.yml`/`docker-compose.pilot.yml`/
  `main.tf`/the two infra scripts (`backup-staging-db.sh`, `restore-drill.sh`).
- Read `.github/workflows/pr.yml` and `deploy-staging.yml` in full (every job, every step) —
  not summarized from memory.
- Ran `pnpm test` across the whole workspace locally against the running local Postgres/Keycloak
  stack (started prior to this session): `packages/domain` (42/42 pass), `apps/interop` (11/11),
  `apps/gateway` (16/16), `apps/api` (228/228 pass, run standalone after an initial flaky failure
  under parallel load), `apps/web` (46/46 pass, same flakiness note — one Keycloak-refresh test
  timed out once under load, passed standalone).
- Confirmed via `gh run view`/`gh run list` that the most recent PR-checks run (PR #825, merged)
  passed all four jobs (`build-and-test`, `rls-isolation-check`, `storybook-a11y`, `web-e2e`), and
  that the last 10 `deploy-staging.yml` runs on `main` are all green.
- Started `apps/web`'s dev server locally and confirmed it serves (HTTP 307 redirect to auth, as
  expected for an unauthenticated request) alongside the already-running API/Postgres/Keycloak/MinIO
  containers — I did not complete a full authenticated click-through this session; the live-workflow
  evidence cited for UI-level claims below is `docs/pilot/PILOT-USER-GUIDE.md`'s own prior-session
  browser passes, credited as such, not as this session's own E3 proof.
- Read the AP schema (`case`, `block`, `slide`, `block_fulfillment`, `case_report_version`,
  `case_narrative`), the synoptic-protocol schema (protocol/version/element/response-option/
  concept-block, all six tables), the billing schema, the FHIR controller, and the gateway's
  ingest/forward/queue pipeline files directly.
- Confirmed the AP report PDF renderer (`case-report-render.ts`) does carry patient name, MRN, DOB,
  referring facility, and ordering provider — a fix already present in the code, not something I
  added.
- Confirmed the API's own capability-check "proof controller" (`auth/capability-check.controller.ts`)
  — five routes that insert real demo patients/orders to prove audit/capability behavior — is
  registered unconditionally in `AuthModule` with no `NODE_ENV` gate, unlike the Swagger docs route
  in `main.ts` which *is* correctly gated to non-production.

---

## 4. Dimension scores

| Dimension | Score | Evidence level | Basis |
|---|---:|---|---|
| Product quality | 6.0 | E2–E3 | Coherent patient→order→specimen→result→report chain exists and is tested; several edges thin (billing, outstanding balances) |
| LIS domain maturity | 6.5 | E2–E3 | Real discipline catalogs (chemistry, haematology, microbiology, AP) seeded and tested in CI |
| AP | 7.0 | E2–E3 | Real case/block/slide hierarchy, append-only signed report versions, amendment chain, real ICCR/CAP-sourced synoptic protocols; not field-proven |
| Histology | 4.5 | E1–E2 | Block/slide/fulfillment schema exists; no stain/special-stain/IHC tracking, no slide-tracking workflow beyond a WSI viewer |
| Cytology | 5.0 | E2 | Two-tier and Pap/Bethesda e2e specs exist (`cytology-two-tier`, `cytology-pap`, `cytology-reflex-hpv`); no independent live workflow evidence this session |
| Synoptic/structured reporting | 7.5 | E2–E3 | Genuinely generic 6-level model (protocol/version/element/option/condition/response), versioned, conditional JSON logic real; **authoring is SQL-seed-only — no UI/API to create a protocol** |
| Template engine | 7.0 | E2–E3 | Report-template designer + rendering pipeline, pdfkit-based, content-hash-pinned; separate from synoptic engine, not unified |
| Patient management | 6.0 | E2–E3 | CRUD, merge, contacts, referring facility exist and tested |
| Orders | 6.5 | E2–E3 | Order lifecycle, reflex, worklist all tested |
| Specimen management | 6.5 | E2–E3 | Accessioning, expiry, processing-QC (new this session's own history, PR #796/797) |
| Results | 6.5 | E2–E3 | Delta-check, flagging, calculated fields, cumulative reports all have e2e specs |
| Reporting | 6.5 | E2–E3 | Real PDF with correct clinical identity fields (confirmed this session); no report retrieval portal beyond clinician/patient portal read endpoints |
| Billing | 3.5 | E1–E2 | Invoice/payment schema real but thin: cash + one stub mobile-money provider only, no refunds, no outstanding-balance screen (still open per issue #489) |
| Work queues | 6.0 | E2 | Worklist, collection-queue, culture-reads pages exist with SLA tracking |
| UX | 5.5 | E1–E2 (this session) | Not independently re-verified live this session; prior pilot-guide passes (E3–E5, but dated, not re-confirmed) found real persistence bugs and a "refresh loses everything" gap still present in the architecture |
| Accessibility | 5.0 | E2 | `storybook-a11y` CI job exists and passes; no full-app a11y audit evidenced |
| Security | 5.0 | E1–E2 | RLS/NOBYPASSRLS real; **but unconditionally-mounted proof/demo routes that create real DB rows exist in every environment including production, with no `NODE_ENV` gate** — a real, avoidable exposure the Swagger-route precedent shows the team knows how to fix and simply hasn't applied here |
| Tenant isolation | 7.5 | E2–E3 | Real RLS with a paired structural-sweep + live cross-tenant-write leak check, run as its own CI job against a fresh Postgres; re-confirmed this session by reading the check's own SQL |
| Auditability | 7.5 | E3 | Real SHA-256 hash chain per tenant, verified via `verifyAuditChain`; `REVOKE UPDATE, DELETE` on the audit table from the app role; concurrency-tested against real interleaved writes (`audit-chain-concurrency-check.ts`) |
| Data integrity | 7.0 | E2–E3 | DB-level append-only triggers (not just app checks) for `observation` and `case_report_version`; a dedicated case-status transition-guard trigger; real check constraints throughout |
| Interoperability | 3.0 | E2 | One FHIR `GET Observation/:id` endpoint; no Patient/ServiceRequest/DiagnosticReport/Specimen FHIR resources exist |
| Analyzer integration | 3.0 | E2 | Real gateway ingest→queue→forward→correlate pipeline exists and is unit/integration tested; no UI/API for the `instrument_analyte_mapping` table's own prerequisite existed until PR #825 (this repo's most recent merged PR) |
| AI | 1.0 | E1 | No model vendor call anywhere in the code; `template` provider is a deterministic phrase-lookup/assembly engine, correctly self-labeled as such in code comments and (per commit `d33ed0f`) in the UI |
| Engineering quality | 7.5 | — | Real triggers, real RLS, real CI discipline (openapi/schema drift gate, RLS-isolation as its own job, storybook a11y, web e2e against a real built API); AGENTS.md's own extensive incident log shows a team that learns from real failures rather than hiding them |
| Architecture | 7.5 | — | Modular monolith with clean package boundaries (`@lis/domain`, `@lis/db`, `@lis/sdk`, `@lis/ui`); generic synoptic-protocol data model is real architectural investment, not just a feature |
| Scalability | 5.5 | — | RLS-based multi-tenancy is architecturally sound for growth; current production is a single 1GB-RAM droplet with hand-tuned per-container memory limits — no load-tested ceiling exists |
| Reliability | 5.5 | E2–E4 | Real backup (`pg_dump` cron) + a real automated restore-drill script that spins up a scratch Postgres and restores into it; no evidence the restore drill has actually been observed succeeding in production logs this session |
| Testing | 7.0 | E2 | 130 test files, 72 API e2e specs against a real seeded Postgres+Keycloak, CI-enforced OpenAPI/SDK-drift gate; no load/chaos/pen testing |
| Observability | 4.0 | E1–E2 | Sentry DSN wired in staging compose; no dashboards, alerting, or SLO tracking evidenced beyond the restore-drill's own log file |
| Production readiness | 5.0 | E4 | Real hardened droplet, real HTTPS via Tailscale Serve, real firewall (only SSH/80/443/Tailscale exposed), 10/10 recent deploys green — but Tailscale-mesh-only (never public-internet-reachable), never third-party security-reviewed, never used by a real external user |
| Documentation | 7.0 | — | Exceptionally thorough AGENTS.md incident log, ADRs, and a genuinely detailed pilot user guide with real bug findings recorded in place, not scrubbed |
| Maintainability | 7.0 | — | Consistent module patterns, migrations never edited after the fact, real Implementation-Proposal-before-code discipline evidenced in the breadcrumb history |
| Extensibility | 7.0 | — | The synoptic-protocol data model is the strongest extensibility evidence — six new organ/panel protocols added via seed files with zero schema changes since it was generalized |
| **Overall world-class maturity** | **5.7** | — | See §6 |

---

## 5. What genuinely changed since the last assessment (regressions and improvements, verified)

- **Improved, verified this session:** the AP case-report PDF (`case-report-render.ts`) does carry
  real patient name/MRN/DOB/referring-facility/ordering-provider — the "clinically incomplete
  report" gap the mission's own §14 warns against does not currently apply to this renderer.
- **Improved, verified this session:** PR #825 (the most recent merged PR on `main`) shipped a real
  admin UI + API for `instrument_analyte_mapping` — the previous assessment's own finding that this
  table had "no UI/API... manually seeded" for the analyzer-integration proof is now fixed.
- **Unchanged weakness, re-confirmed this session:** FHIR is still exactly one read-only resource
  endpoint. This is not a regression — it was already this narrow — but no assessment should imply
  broader FHIR coverage exists.
- **New finding this session, not previously flagged in either prior assessment document I read:**
  the capability-check proof controller (five routes under `/auth/capability-check`, including two
  that insert real `order`/`patient` rows) has no environment gate at all, unlike the structurally
  identical Swagger-docs gate in the same codebase (`main.ts`'s `NODE_ENV !== 'production'` check).
  This is a real, concrete, fixable security gap — not hypothetical — since these routes are
  reachable in the actual production deployment today, gated only by requiring a valid JWT with the
  right capability, which is a real guard but not the same as "does not exist in production."

---

## 6. How the overall 5.7 was reached

Not an average of the table above. The overall score is anchored by three facts that dominate what
"world-class" means for a clinical system: (1) real data-integrity and tenant-isolation enforcement
at the database layer, independently CI-checked — this is genuinely strong and above what most
early-stage health-tech products ship; (2) real breadth across disciplines with real, if shallow,
end-to-end test coverage; and (3) the near-total absence of real-world proof — no design partner has
used this on real patients, no security review has occurred, AI and FHIR are minimal, and even the
one production environment has never been reached from outside a private mesh network. A system can
be architecturally excellent and still not be world-class if nothing has actually been proven against
reality at scale; that gap is the single largest factor holding this below 7.

---

## 7. Top 10 genuinely exceptional things

1. **Database-enforced append-only clinical data** (`fn_observation_append_only`,
   `fn_case_report_version_append_only`) — the "verified data never mutates" invariant is enforced by
   a Postgres trigger that raises an exception, not by an application-layer check that a bug could
   bypass. This is the correct way to implement Constitution Law #2 and most systems at this stage
   don't bother.
2. **A real SHA-256 hash-chained audit log** with `REVOKE UPDATE, DELETE` on the table from the
   application role and a concurrency-tested chain-integrity verifier. Tamper-evidence, not just
   tamper-logging.
3. **A dual structural + live-leak RLS isolation check**, run as its own CI job against a dedicated
   fresh Postgres specifically because a shared, e2e-polluted database would produce false negatives
   — a subtle correctness issue the team found and fixed rather than shipping a check that looked
   green but proved nothing.
4. **A genuinely generic synoptic-protocol data model** (protocol → version → element → response
   option → condition, plus a separate reusable concept-block library) that has absorbed 7+ real
   organ/panel protocols via pure data seeding with zero schema changes since generalization.
5. **HMAC-signed, append-only, amendment-chained case report versions** with content-hash pinning
   that excludes incidental PDF metadata — a real attempt to make "what was actually signed"
   independently verifiable.
6. **A CI-enforced API-contract drift gate** (`openapi.json`/`packages/sdk/schema.ts` regenerated and
   diffed every PR) — prevents the SDK from silently lying about the API's real shape.
7. **A dedicated case-status transition-guard trigger** enforcing the legal state machine
   (`accessioned → pending_review → signed_out → amended`) at the database layer, not just in
   controller logic.
8. **An honestly-documented pilot user guide** (`docs/pilot/PILOT-USER-GUIDE.md`) that records real
   bugs found live (a persistence flicker, a lost-on-refresh form) in place rather than only
   documenting successes — genuinely rare engineering-culture evidence.
9. **A real automated restore-drill** that spins up a scratch Postgres and restores the latest backup
   into it on a schedule, not just a backup script that has never been proven to actually restore.
10. **AGENTS.md's incident log** — dozens of real, dated, root-caused production/CI failures with
    their actual fixes, used as living institutional memory rather than deleted once resolved.

---

## 8. Top 10 weaknesses preventing world-class status

1. **No real AI, anywhere.** Current: `template` provider is deterministic phrase assembly.
   Evidence: `apps/api/src/ai/providers/template-provider.ts`. Impact: any AI-adjacent claim must be
   described as "narrative templating," never "AI-assisted." World-class standard: real model calls
   with PHI-handling, versioning, and human-oversight controls. Gap: total. Direction: do not build
   this speculatively — wait for a real design-partner need (issue #546 already exists for this).
2. **FHIR is one endpoint.** Current: `GET /fhir/Observation/:id` only. Evidence: `fhir/` module.
   Impact: cannot claim FHIR interoperability to a prospective lab partner. World-class standard: a
   real Patient/ServiceRequest/DiagnosticReport/Specimen resource set, live-tested against a real
   consumer. Gap: large. Direction: build only against a named integration partner's actual need.
3. **Unconditionally-mounted proof/demo routes reachable in production.** Current:
   `auth/capability-check.controller.ts`'s five routes have no `NODE_ENV` gate, unlike the Swagger
   route in the same file's sibling module. Impact: a valid-but-compromised token with `enter_result`
   or `verify` capability can create arbitrary demo patient/order rows in production. World-class
   standard: test-only routes never ship in a production build. Gap: concrete, fixable in under an
   hour. Direction: **must fix** — gate identically to the Swagger precedent already in the codebase.
4. **Protocol authoring has no UI or API.** Current: every synoptic protocol enters the system via a
   hand-written SQL seed file (`db/seed/synoptic-protocol-*.sql`). Impact: adding or editing a
   protocol requires an engineer and a migration/seed change, not a lab administrator. World-class
   standard: a real authoring workflow for structured-reporting content. Gap: large, but a legitimate,
   deliberate scoping choice per ADR-0050 ("generalize only after real evidence") — not a hidden gap.
5. **Billing is thin.** Current: cash + one stub mobile-money provider, no refunds, no outstanding-
   balance screen. Evidence: `packages/db/src/schema/billing.ts`, issue #489 still open. Impact: not
   usable for a lab with real payer/insurance workflows. World-class standard: a real billing
   subsystem. Gap: large, but explicitly gated on undecided business-process questions, not silently
   skipped.
6. **No independent security review.** Current: internal RLS/audit review only, no third-party
   penetration test, no load test. Impact: security claims rest entirely on the team's own analysis.
   World-class standard: an independent pen test before any real-patient data. Gap: total.
7. **Histology is schema-only for special stains/IHC.** Current: block/slide/fulfillment tables
   exist; no special-stain or IHC ordering/tracking workflow. Impact: cannot support a real histology
   lab's stain workflow today. World-class standard: full stain-order-to-result tracking. Gap: large,
   correctly scoped as "not yet built" rather than claimed complete.
8. **Never used by a real design partner on real patients.** Current: every workflow proof is either
   an automated test or a single engineer's own manual click-through against seeded fixtures. Impact:
   this is the single largest gap between "well-engineered" and "world-class" — no field-proven
   evidence exists anywhere in the system. World-class standard: E5/E6 evidence (realistic workflow,
   real-user proof). Gap: total on every clinical dimension.
9. **Production reachable only over a private Tailscale mesh.** Current: never exposed to the public
   internet, never accessed by anyone outside the engineering team. Impact: "production readiness" is
   real but self-contained — no external user has ever touched it. World-class standard: a production
   environment serving real external traffic. Gap: large.
10. **No observability beyond a wired Sentry DSN and a restore-drill log file.** Current: no
    dashboards, no alerting, no SLO tracking. Impact: an incident in production would be discovered
    reactively, not proactively. World-class standard: real monitoring/alerting. Gap: large.

---

## 9. False completeness — explicitly searched for

- **The capability-check proof controller** looks like ordinary application code (it has real
  `@Audit` decorators, real capability guards) but exists purely to prove the audit/capability
  mechanism works, and yet ships unconditionally in production — the opposite failure mode from
  "looks unfinished but isn't": this looks like a real feature and is actually test scaffolding with
  real write access.
- **FHIR "interoperability"**: code exists, is unit-tested, but is a single resource type with no
  live third-party consumer ever having called it. Do not count this as proven interoperability.
- **Analyzer integration**: the gateway→queue→forward pipeline is real and tested, but until PR #825
  (merged just before this session) there was no way for an admin to actually configure an
  instrument's analyte mappings without a manual DB insert — a backend capability with no usable
  front door. This is now fixed, but is exactly the "backend exists, UI didn't" pattern the mission
  asks to search for, confirmed present until very recently.
- **AI**: the UI correctly labels template-drafted narratives as non-AI as of commit `d33ed0f`
  ("stop labeling template-drafted narratives as 'AI' to users") — this is the system correcting its
  own false-completeness, worth crediting rather than flagging as still-wrong.
- **Restore drill**: the script is real and automated, but I found no evidence in this session of a
  successful real execution log from the actual production droplet — the mechanism is proven in
  design, not proven in the one place it matters (production data actually restoring).

---

## 10. Decisions required from Mathew

**No unresolved product decisions identified in this pass.** The open product-scope questions I found
(billing refunds/outstanding-balances, protocol-authoring UI, histology stain workflow) are already
tracked as explicitly gated on undecided business-process input in existing open issues (#489 and
others) — this assessment does not surface a new one.

---

## 11. Must fix / should improve / future / not necessary

**Must fix**
- Gate `auth/capability-check.controller.ts`'s routes behind the same `NODE_ENV !== 'production'`
  check `main.ts` already uses for Swagger — a real, concrete, low-effort production exposure.

**Should improve**
- A first independent security review (even a scoped internal one) before any real-patient pilot.
- A logged, verified restore-drill success against production, not just a script that exists.

**Future**
- Broader FHIR resource coverage, once a real integration partner names a concrete need.
- A protocol-authoring UI, once real design-partner usage justifies the investment (per ADR-0050's
  own stated philosophy).
- Real billing (refunds, outstanding balances), once payer/business-process decisions are made.

**Not necessary**
- Building real AI model integration speculatively — no current evidence of a design-partner need
  that the deterministic template provider fails to serve.
- A public-internet-facing production deployment before a real pilot user is lined up.

---

## 12. Final rating

### Overall current world-class rating: **5.7 / 10**

- Product: 5.8/10
- Engineering: 7.5/10
- Domain: 6.3/10
- UX: 5.5/10 (not independently re-verified live this session — see §3)
- Security: 5.0/10
- Architecture: 7.5/10
- Production: 5.0/10
- Interoperability: 3.0/10
- Clinical maturity: 5.5/10
- World-class potential: 8.0/10

These are not averaged into the overall — the overall reflects the judgment in §6: strong
engineering and data-integrity foundations, held back by the almost complete absence of real-world
proof and by a few concrete, fixable security/scope gaps.

---

## 13. Classification

**Professional early-stage LIS.**

Not a Basic/Strong MVP — the database-layer invariant enforcement, hash-chained audit, and generic
synoptic engine are real engineering investments beyond MVP scope. Not an Advanced or World-class
LIS — no field-proven use, thin billing/interop/AI, and a live unpatched production-exposure gap.
"Professional early-stage" captures both the real engineering seriousness and the real immaturity of
proof.

---

# BRUTAL FINAL VERDICT

### 1. How world-class is it TODAY?
Not world-class. A genuinely well-engineered pilot-stage LIS with real data-integrity discipline and
zero field-proven clinical use.

### 2. What is genuinely exceptional?
The database-enforced append-only/hash-chain/RLS-isolation trio (§7 items 1–3) — this is
better-than-typical engineering for a system at this stage of real-world proof.

### 3. What is merely good?
The synoptic-protocol engine's design, the report-template/PDF pipeline, and the CI discipline
(contract-drift gate, dedicated RLS job) — solid, competent, not yet stress-tested by real use.

### 4. What is weak?
AI (non-existent as real AI), FHIR (one endpoint), billing (thin), histology (schema-only for
stains/IHC), observability (a Sentry DSN and a log file).

### 5. What remains unproven?
Everything clinical, against reality: no design partner, no real patient, no real external user, no
security review, no production traffic from outside the team's own Tailscale mesh.

### 6. What would prevent an international laboratory from trusting it today?
No independent security review; no real-user track record; thin billing; a live, unpatched
production route that writes real database rows outside the intended feature surface.

### 7. What would an experienced healthcare CTO criticize?
That "production" has never served a real external request, and that the strongest security claims
(RLS, audit) have never been externally red-teamed despite the internal rigor being real.

### 8. What would a pathologist criticize?
No protocol-authoring workflow — every new synoptic protocol requires an engineer, not a
pathologist, to add. Histology stain/IHC tracking does not exist yet.

### 9. What would a security reviewer criticize?
The unconditionally-mounted capability-check proof controller in production, and the absence of any
third-party review to date.

### 10. What would a software architect admire?
The trigger-enforced append-only invariants and the generic synoptic-protocol data model — both are
architecturally correct choices that most teams at this stage skip.

### 11. What are the five highest-leverage improvements?
1. Gate the capability-check proof controller out of production.
2. Get one real design partner onto real (de-identified where needed) data for a real workflow.
3. Commission an independent security review before any real-patient pilot.
4. Prove the restore drill against production, with a logged successful run.
5. Decide and ship the billing gaps (#489) once the business-process questions are answered.

### 12. What should NOT be built?
Real AI model integration, broader FHIR coverage, or a protocol-authoring UI — none has a named
real-world need yet; building any of them now would be effort spent on potential, not proof.

### 13. What decisions do you need from Mathew?
None new this pass — see §10.

### 14. Is it genuinely world-class today?
**NO.** Evidence: zero real-user/field-proven (E6) capability exists anywhere in the system; every
clinical claim tops out at E2–E3 (automated-tested or end-to-end-verified-with-fixtures); a live,
unconditionally-mounted production route can write real database rows outside its intended purpose;
AI and FHIR are minimal; billing is thin. The engineering foundation (RLS, audit chain, append-only
triggers, generic synoptic engine) is genuinely strong and above the bar most projects at this stage
reach — but strong foundations without field proof is not the same as world-class, and the honest
score reflects that distinction.
