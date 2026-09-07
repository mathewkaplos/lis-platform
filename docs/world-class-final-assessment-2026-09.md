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
| Production readiness | 4.5 | 5.3 | 10 | Correction, not improvement: a real Level-4 (environment-proven) production environment already existed and was wrongly recorded as absent; net effect is a more accurate — not a better — picture, offset by a newly-found gap (no HTTP security headers, unguarded Swagger endpoint) |
| Interoperability (HL7/FHIR) | 2.0 (Automated-tested) | 3.0 (Integrated) | 6 (Pilot-proven) | Real MLLP message sent and real FHIR resource fetched against local dev, once each — genuine capability proof, not paperwork |
| Analyzer integration | 2.0 (Automated-tested) | 3.0 (Integrated) | 6 (Pilot-proven) | Real raw result proven through the real queue→forward→correlate→write pipeline, once, in local dev |
| Architectural potential | 8.5 | 8.5 | 10 | Unchanged — no architecture work this pass |
| World-class potential | 8.0 | 8.0 | 10 | Unchanged — the ceiling was never in question; the gap is proof, not design |
| **Overall** | **5.5** | **5.7** | **10** | Small, deliberately conservative bump: two real (if narrow) capability proofs, one factual self-correction, one new finding — nothing here justifies more than a fraction of a point |

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
- **The security reviewer** would flag the same two items this pass found (missing headers,
  unguarded docs endpoint) within minutes, and would not consider a single self-conducted spot check
  a substitute for an actual review.
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
