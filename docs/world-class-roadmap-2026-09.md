# World-Class Roadmap — September 2026

**Author:** Claude Code. **Purpose:** translate the 5.5/10 world-class assessment into a real,
sequenced plan — not a feature wishlist, not a GitHub-issue-number crawl. **Scope honesty up
front:** this mission (production deployment, live HL7/FHIR proof, real analyzer harness, full
security review, full UX overhaul) is genuinely multi-week-to-multi-month work. This document sets
the plan; the accompanying session does real, bounded, verifiable work against it and reports
exactly what was and wasn't achieved — it does not claim completion it hasn't earned.

---

## 0. Methodology: the six-level maturity model (per mission instruction §5)

Every major capability in this document is scored on this scale, not "done/not done":

| Level | Meaning |
|---|---|
| 1 — Implemented | Code exists. |
| 2 — Automated-tested | Relevant unit/e2e tests pass. |
| 3 — Integrated | UI → API → database path works, confirmed by reading the actual wiring. |
| 4 — Environment-proven | Works in the intended deployment environment (not just local dev). |
| 5 — Operationally-proven | Works with realistic data and a realistic workflow, live-verified in a real browser. |
| 6 — Pilot-proven | A real intended user (or a faithful stand-in for one) has successfully operated it. |

"Milestone closed" in this project's own GitHub history has repeatedly meant Level 1-2. The
purpose of this model is to stop conflating that with Level 5-6, which is what the assessment's
own "field-proven" language actually requires.

---

## 1. Independent gap-analysis baseline (re-verified, not re-trusted)

Cross-checking `docs/world-class-assessment-2026-09.md` against the codebase again, in addition to
the two corrections already made in that document (issues #671/#672 genuinely fixed, not merely
acknowledged):

| Capability | Level today | Evidence | Correction to prior claim? |
|---|---|---|---|
| AP case→sign-out→report→invoice chain | **6 — Pilot-proven** | Live-walked twice independently this week with fresh synthetic patients, real step-up re-auth, real PDF, real payment | No change — this was already the strongest claim in the prior report and holds |
| Chemistry/haematology result entry | **5 — Operationally-proven** | Live-verified this week (found and fixed the #808 blocking bug in the process) | Upgraded from the prior report's own "never live-verified" finding — now genuinely proven, once |
| Critical-value notification/escalation | **6 — Pilot-proven** | Built #809 this week specifically because it was stuck at Level 2; now live-verified full loop (create→escalate→acknowledge→read-back persisted) | Upgraded from Level 2 in the prior report |
| Case-status DB-level integrity (#671) | **4 — Environment-proven** | Real Postgres trigger exists and is exercised by every live-verified sign-out this session | **Correction**: prior report said "acknowledged, not fixed" — wrong, verified fixed by direct code read |
| HL7 v2 / FHIR R4 | **3 — Integrated** | This pass started the real `apps/interop` MLLP server and sent real ORM^O01 messages over raw TCP with correct MLLP framing (`AA` + real order created on a valid MRN; `AR` correctly rejecting an unmatched MRN, not silently dropping it); separately, a real patient/order/specimen/result chain was created via the API and fetched back through `GET /fhir/Observation/:id`, spec-correct. **Not Level 4/5**: both proofs ran against local dev, one time each, via raw TCP/API calls rather than the deployed staging environment or a real HL7-sending system/EHR. | Upgraded from Level 2 — the real wiring is now confirmed to work end to end, once, in dev. Still the largest *remaining* proof gap relative to AP: no environment-proven or repeated-use evidence exists yet. |
| Analyzer integration (`gateway-ingest`) | **3 — Integrated** | This pass started the real `apps/gateway` service, manually seeded one `instrument_analyte_mapping` row (no UI/API exists for this table — see #812), and POSTed one realistic raw result through the real queue → forward → correlate → write pipeline, confirmed via a DB query showing `source: 'analyzer'`. **Not Level 4/5**: local dev only, one synthetic result, no real or simulated analyzer device/driver involved (`FEAT-027` still open), and the mapping had to be seeded by hand because no config path exists yet. | Upgraded from Level 2 — the pipeline's real wiring is now proven, once, in dev. Decision 1 below covers whether to invest further (a real HL7 ORU-generating simulator) toward Level 4. |
| "Governed AI" | **1 — Implemented** | Confirmed again: `StubProvider` returns `"no live model configured"` literally; `TemplateProvider` is a hard-coded phrase table | No change |
| Production environment | **4 — Environment-proven** | **Correction (this pass):** prior rows in this table said "0 — does not exist," based on the separate, blocked, opt-in "public-IP pilot" runbook (`docs/pilot-remote-access.md`, HTTP-only, not yet wired to a working SSH key). Deeper inspection of `infra/main.tf`, `infra/docker-compose.staging.yml`, and `.github/workflows/deploy-staging.yml` — plus the last 5 green `deploy-staging.yml` runs with real health-check retries — found a *separate, already-working* production-mode deployment: a hardened droplet, Keycloak in `start` mode, real Let's Encrypt-backed HTTPS via Tailscale Serve, deploy-time-injected secrets, and a firewall exposing only SSH (restricted IP)/80/443/Tailscale. Reachable only over Tailscale's private mesh, not the public internet; no HTTP security headers configured (no helmet, no CSP/HSTS/X-Frame-Options); Swagger docs endpoint unguarded. | **Correction** — the "does not exist" claim was wrong; the real gap is narrower (private-network-only, unhardened HTTP headers, no security review) |
| Synoptic protocol engine | **6 — Pilot-proven** (Breast, Colorectal — repeatedly live-filled in full across sessions) / **3 — Integrated** (Lung, Prostate, Cervical Cytology/Bethesda — this pass opened each live in a real browser for the first time and filled one field, confirming correct rendering, conditional logic, and the progress indicator, but did not complete a full realistic form) / **1 — Implemented** (Colon-Rectum-CAP, Breast-Biomarker — still never opened) | This pass closed the "never opened by a human" gap for 3 of the 5 previously-untested protocols | Corrected from "2 of 7 tested" — now 5 of 7 have real browser evidence at some level, 2 remain untouched |
| Tenant isolation (RLS) | **5 — Operationally-proven**, arguably **6** | `TenantContextInterceptor`'s parameterized `set_config` binding, a dedicated CI job (`rls-isolation-check`) run on every PR, cross-tenant probe accounts confirmed denied in live sessions | No change — this remains the strongest infrastructure claim in the codebase |
| Tablet/mobile responsive layout | **1 — Implemented** (code exists) | Three consecutive sessions have been unable to get past Level 1 because the Chrome-automation tooling itself is broken (`resize_window` confirmed non-functional, product feedback already drafted) | No change — this is a tooling gap blocking verification, not a code defect |

**What this baseline changes about the roadmap's priorities:** the two things most worth doing
immediately are (a) closing the interoperability/analyzer proof gap, since it's the largest
*unproven-vs-claimed* gap and doesn't require a product decision to attempt with a simulator, and
(b) getting the tablet/mobile tooling actually working, since it's the one blocker that has
defeated three separate sessions and needs a different approach, not a fourth identical attempt.

---

## 2. A. What prevents 10/10 today

In order of leverage, not issue number:

1. **The real production environment is private-network-only and missing HTTP security headers.**
   Correction from an earlier version of this document: a hardened, production-mode environment
   already exists (see §1 correction) — the actual leverage item is a security review pass and
   adding CSP/HSTS/X-Frame-Options headers, not standing up an environment from zero.
2. **The gap between "closed" and "field-proven" recurs across AI, interop, and analyzer
   integration** — three independent instances of the same pattern, not three unrelated gaps.
3. **Tablet/mobile has never been visually verified**, blocking a real UX confidence claim.
4. **The AP report renderer and the synoptic template engine are architecturally disconnected** —
   the platform's own best asset doesn't yet reach its own best output.
5. **Five of seven seeded synoptic protocols have never been opened by a human.**

## 2. B. What must be completed (not redesigned — finished)

- Security review + HTTP header hardening (CSP/HSTS/X-Frame-Options/X-Content-Type-Options) of the
  existing staging droplet's production deployment. **Superseded from an earlier version of this
  bullet:** the "raw IP + self-signed HTTPS" plan is moot — the droplet already has real
  Tailscale-backed HTTPS in production mode; per Mathew's decision (after this correction surfaced),
  no further public-IP/TLS work is planned for now — just correcting the record and doing the
  security-header + review work above.
- A real, credible analyzer-integration proof via a standards-compliant simulator (hardware not
  available — this is the mission's own explicitly sanctioned fallback, not a shortcut).
- A real, live HL7 message round-trip and a real FHIR resource fetched and rendered in a browser.
- The remaining five synoptic protocols opened and filled once each by a live-walked test, so
  every seeded protocol has moved past Level 1.

## 2. C. What must be verified (code exists, proof doesn't)

- Every "closed" milestone touching AI, interoperability, or analyzer integration needs an
  explicit re-statement of its actual maturity level, not its GitHub status.
- The patient-merge feature (FEAT-065) — flagged in the completeness audit as having **no
  live-verified evidence found anywhere**, despite closed status.
- WSI path-traversal/size-cap hardening (#660) and synoptic repeating-groups (#666) — both closed
  with language suggesting acknowledgment rather than resolution; flagged, not yet re-verified.

## 2. D. What must be redesigned

**Nothing, on current evidence.** This is a deliberate, evidence-based answer, not a placeholder —
the mission itself warns against refactoring without evidence, and nothing found in this pass or
the prior two audits shows the core architecture (RLS tenancy, structured-Observation model,
synoptic engine, transactional/audit discipline) is wrong. The one architectural inconsistency
worth eventually closing (report-renderer/template-engine disconnect, item A.4 above) is a
*completion* gap, not a *design* flaw — the template engine's own architecture already anticipates
this, it just hasn't been wired to the AP report path yet.

## 2. E. What should NOT be built yet

Restated and extended from the prior assessment: more AI provider infrastructure beyond wiring one
real provider into the existing abstraction; a second payment gateway; multi-region/PITR disaster
recovery; additional synoptic protocols beyond what a named design partner's real case mix needs;
scanner-integrated WSI ingestion without a real scanner vendor relationship; any new laboratory
discipline beyond the five that already exist; a general-purpose "template authoring UI" for
non-engineers before the five unopened protocols prove the current metadata model actually
suffices for real content (building an authoring UI for an unproven data model is the textbook
premature-abstraction risk this project has otherwise correctly avoided).

## 2. F/G/H/I. What requires a decision, clinical validation, real external integration, or production deployment

Covered in full in the dedicated `DECISIONS REQUIRED FROM MATHEW` section below — not scattered
through this list, per the mission's own instruction to keep proposals separate from requirements.

---

## 3. DECISIONS REQUIRED FROM MATHEW

### Decision 1 — Analyzer integration: simulator scope and honesty framing

**Problem:** No real analyzer hardware is available. The mission explicitly allows a "realistic,
standards-compliant simulator" as a substitute, but how far that simulator goes changes what can
honestly be claimed afterward.
**Recommended proposal:** Build a minimal HL7 v2 ORU-generating simulator (a script, not a new
product surface) that sends realistic, correctly-formatted messages through the *real* existing
`gateway-ingest`/`interop-bridge` pipeline — proving the real code path end to end — and document
the result explicitly as "simulator-proven, not hardware-proven."
**Why:** This is the honest middle ground between "still Level 2" and overclaiming "analyzer
integration verified" off a fake result.
**Alternatives:** (a) Leave it at Level 2 until real hardware exists — defensible, but leaves the
biggest interoperability gap untouched for an indefinite time. (b) Build a fuller simulator
(multiple message types, error injection) — more thorough, more effort, arguably premature before
even one real analyzer relationship exists.
**Advantages:** Closes a real, named gap without inventing a hardware claim; reuses existing code
paths rather than adding new ones.
**Disadvantages:** Still not hardware-proven — must never be described as "analyzer integration
complete" externally.
**Recommendation:** Option (a) minimal simulator, explicitly labeled.
**Blocked until decided:** the specific message types/volume the simulator should exercise.

**Resolved 2026-09-07.** Mathew chose a corrected version of option (a): a JSON simulator against
the real `apps/gateway` edge, not an HL7 ORU-inbound listener — this problem statement's own
"gateway-ingest/interop-bridge pipeline" phrasing turned out to be inaccurate on closer code
inspection (no HL7 ORU-inbound listener exists anywhere; `apps/gateway`'s `/ingest` is JSON-only and
architecturally unrelated to `interop-bridge`'s HL7 ORU-outbound generation). Built as
`apps/gateway/scripts/simulate-instrument.sh`, executed live. Result: analyzer integration stays
Level 3 (repeating a proof doesn't raise its level) but surfaced a real, previously-unknown
reliability defect — `ForwarderService.drain()` permanently blocks its entire local queue behind
any one non-retryable (4xx) correlation failure, not just genuinely-transient network failures.
Filed as issue #820, not fixed here (the correct fix is itself a design decision about where
permanently-unmatched results get parked). See `world-class-final-assessment-2026-09.md` §23 for
the full record.

### Decision 2 — Interoperability live-verification: how much is worth proving now?

**Problem:** HL7/FHIR code exists and is unit-tested but has never been driven live, and there is
no current design-partner need for either channel (per the completeness audit's own finding).
**Recommended proposal:** Do the minimum real proof — one real HL7 ORU message round-tripped
through the real gateway into a real observation, one real FHIR Observation fetched via the real
API and rendered in a real browser — and stop there until a real integration partner exists.
**Why:** Matches the "prove it exists, don't build ahead of need" discipline this codebase already
holds itself to elsewhere.
**Alternatives:** Full conformance-suite-style verification against the HL7/FHIR spec — thorough,
but speculative effort with no current consumer.
**Advantages of the minimal proof:** Converts "built, never proven" into "proven once, real
consumer needed for more" — an honest, bounded claim.
**Disadvantages:** Doesn't cover every message type/profile the code technically supports.
**Recommendation:** the minimal proof.
**Blocked until decided:** none — proceeding with the minimal proof this session as clearly
non-controversial engineering verification work, not a scope decision.

### Decision 3 — Should the five unopened synoptic protocols be live-filled by this session's own testing, or reserved for a real pathologist?

**Problem:** Lung, Prostate, Cervical Cytology (Bethesda), Colon-Rectum-CAP, and Breast Biomarker
have real, cited content but have never been filled by a human — testing them well requires
clinical judgment about realistic values, which I can approximate but not clinically validate.
**Recommended proposal:** I live-fill each once with plausible, clearly-synthetic values to prove
the *engine* (rendering, conditional logic, validation, storage) works for all seven, explicitly
not claiming clinical content review — that stays a separate, named gap requiring a real
pathologist (already tracked: #171/#483-equivalent for these protocols).
**Why:** Separates "does the software work" (I can verify) from "is the content clinically sound"
(needs a real pathologist) — exactly the distinction the mission asks me to preserve.
**Alternatives:** Leave all five untested until a real pathologist is available — safer,
slower, leaves the biggest named AP gap untouched.
**Recommendation:** proceed with engine-only verification this session, flag clinical review as a
separate, still-open item.
**Blocked until decided:** none — proceeding, since this doesn't require inventing clinical policy,
just exercising the existing engine with placeholder-but-clearly-synthetic data.

### Decision 4 — Production TLS approach given "no domain yet" (superseded by correction)

**Problem, as originally framed:** assumed no real production HTTPS existed, so the choice was
self-signed/raw-IP HTTPS now vs. a real domain later. **This premise was wrong.** Deeper inspection
found the existing staging droplet already terminates real, Let's Encrypt-backed HTTPS via Tailscale
Serve in production mode — genuine TLS, not self-signed, just reachable only over Tailscale's
private mesh rather than the public internet.
**Resolution (Mathew's decision once this surfaced):** "Neither yet — just correct the assessment
record and move to other work." No raw-IP/self-signed work is planned. The separate, still-blocked
public-IP pilot path (`docs/pilot-remote-access.md`) remains a distinct, opt-in track, unchanged by
this correction — it's blocked on an SSH key never added to the droplet's `authorized_keys`, not on
TLS.
**Standing note, still true:** a future real-domain migration will still require a Keycloak
issuer-URL change that invalidates all previously-issued tokens — a one-time, disruptive, but
unavoidable step whenever a real domain is eventually added, independent of this correction.
**Blocked until decided:** nothing — record corrected, no infra action taken or pending.

**No other unresolved product/clinical/scope decisions identified** beyond these four and the ones
already carried forward from the completeness audit (chemistry live-verification — now done; AI
external-readiness framing — restated as Decision 1 in the world-class assessment, unchanged; demo
tenant hygiene — already executed this week).

---

## 4. Sequencing (highest leverage first)

1. **Interoperability minimal live proof** (Decision 2) — no blocker, highest ratio of credibility
   gained to effort spent, closes the single largest "claimed vs. proven" gap.
2. **Analyzer simulator proof** (Decision 1) — same class of work, same session.
3. **Five remaining synoptic protocols, engine-only verification** (Decision 3).
4. **Production-environment record correction** (Decision 4, superseded) — the existing droplet
   already has real, Tailscale-backed production HTTPS; no raw-IP/self-signed work needed. Done as a
   documentation correction to both assessment docs, not an infra change.
5. **Security review pass** (read-only, safe, no infra risk) — IDOR/privilege-escalation spot
   checks against the real RBAC matrix (verified this pass: RLS enforces tenant isolation
   structurally, not just via app-level filters), session/CORS/CSRF review (session cookies confirmed
   correctly configured: httpOnly, secure-in-production, sameSite=lax), secrets-at-rest review.
   New findings from this pass: no HTTP security headers configured anywhere (no
   `@fastify/helmet`, no Next.js `headers()` config) — no CSP/HSTS/X-Frame-Options/
   X-Content-Type-Options on the API or web app; the Swagger docs endpoint (`/v1/docs`) has no auth
   guard or environment gate.
6. **UX fixes for anything newly found** during the above live-verification passes — not a
   separate speculative UX sweep, but fixes earned by actually using the software for 1-4.
7. **Documentation pass** describing what's real as of this work, not aspirational.
8. **Re-run the world-class assessment** with new evidence, producing
   `docs/world-class-final-assessment-2026-09.md` with an honestly-earned score.

This is the order the rest of this session's work follows.
