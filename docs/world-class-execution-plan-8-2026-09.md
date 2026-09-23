# World-Class Execution Plan — Path to 8/10

**Date:** 2026-09-24. **Author:** Claude Code. **Baseline:** `docs/world-class-assessment-2026-09-fresh.md`
(overall 5.7/10, 2026-09-23), re-verified against the current repository state — not blindly trusted.
This document is the single source of truth for the path from the current, evidence-verified 5.7/10
to a defensible 8/10.

**Governing rule throughout:** an initiative earns a place in this plan only if it produces a
real, material improvement in *proven* maturity — moving a capability up the evidence ladder
(E0→E6, defined in §1) — not because it makes the codebase larger or the assessment checklist
longer. Where the honest answer is "defer," this plan says so.

---

## 0. What changed since the baseline assessment (verified this session, not assumed)

1. **Fixed:** the capability-check proof-controller production exposure (assessment §5/§9,
   issue #827) — merged in PR #828 (`0c4c669`), all 5 CI jobs green, verified locally against the
   real Postgres/Keycloak stack. This item is **closed**, not carried into this plan as a gap.
2. **New finding, not in the baseline assessment:** `pnpm audit` (run fresh this session) reports
   **53 vulnerabilities in the dependency tree: 32 high, 2 critical, 14 moderate, 5 low.** The two
   critical findings are both in `next@16.2.12` (`apps/web`): an unauthenticated RCE
   (GHSA-p293-qw3h-jr36) and an unauthenticated RCE via the Image Optimization API when AVIF files
   are used (GHSA-2xp9-vwfh-vxw4), both patched at `next@16.3.3+`. This is a real, currently-live
   gap in the exact production deployment this plan is trying to make credible — it did not exist
   as a named finding in the baseline assessment because that assessment never ran `pnpm audit`.
3. **New finding:** `@nestjs/platform-express` is a declared dependency of `apps/api` but is never
   imported anywhere in `apps/api/src` (confirmed by grep) — the API runs on the Fastify adapter
   exclusively. It exists purely as unused weight that pulls in `multer` (the source of most of the
   32 high-severity findings) transitively. Removing it is a pure subtraction with no functional
   risk.
4. Everything else in the baseline assessment (RLS/audit/append-only triggers, the synoptic engine,
   the thin billing edge, FHIR's single endpoint, the stub/template-only AI, CI structure, staging
   deployment shape) was spot-re-checked this session and **holds unchanged** — no other regression
   or improvement found.

---

## 1. Evidence ladder (used throughout this document)

- **E0 — Claimed:** documented/planned only.
- **E1 — Implemented:** code exists.
- **E2 — Automated-tested:** unit/integration/e2e tests exist and pass.
- **E3 — End-to-end verified:** a realistic workflow driven through the real application
  (manually or programmatically), not just fixtures in a test harness.
- **E4 — Environment-proven:** verified in the actual deployed environment under realistic
  infrastructure.
- **E5 — Operationally proven:** used under realistic operational conditions — representative
  workflows, real data volume, real failures, real recovery, real monitoring.
- **E6 — Real-user proven:** used by a real laboratory/design partner with genuine operational
  feedback.

The plan's job is to move a *small, deliberately chosen* set of capabilities from E1–E3 to E4–E6,
not to raise every score simultaneously.

---

## 2. What is actually blocking 8/10 (ranked by real contribution to maturity)

Ranked by how much moving it would change an independent, skeptical reviewer's verdict — not by
effort or by how the baseline assessment's table happened to order dimensions.

1. **Zero E5/E6 evidence anywhere in the system.** This is, by a wide margin, the single largest
   gap. Every clinical capability — however well-engineered — tops out at E2/E3. No amount of
   additional code changes this; only a real pilot does. **This is the #1 blocker.**
2. **No independent security assurance, plus two live, unpatched critical CVEs in the exact
   dependency tree the production deployment runs.** A skeptical reviewer who runs `pnpm audit`
   (a five-second check) finds a critical unauthenticated RCE in the web app's own framework
   version. This is a credibility-destroying finding that costs nothing to fix and should not
   still be true when this plan is being read.
3. **Production reachable only over a private Tailscale mesh, never by a real external user**, and
   backup/restore automation that is a documented *manual runbook* (a human must SSH in and install
   a crontab entry), not something CI/deploy actually installs or verifies — so nobody actually
   knows today whether the real droplet's backup cron job is even running.
4. **No design-partner pilot exists yet**, and the one concrete pilot-adjacent effort in flight
   (temporary public-IP phone access for testing, per `docs/pilot-remote-access.md`) is blocked on
   DigitalOcean console access that only Mathew can grant.
5. **UX has not been independently re-verified live** since 2026-08-28 (per the pilot user guide);
   the architecture (server-rendered forms with no draft-save) has a known, real failure mode
   (refreshing mid-form loses all input silently) that would visibly embarrass the product in front
   of a real user on day one.
6. Everything else (billing depth, FHIR breadth, histology stain/IHC workflow, real AI) is **already
   correctly gated on real design-partner demand** in this repo's own backlog (see #489, #551,
   ADR-0050, ADR-0041) — building any of it now, ahead of that demand, would not move the needle on
   maturity and would be exactly the "more code ≠ more maturity" mistake this plan exists to avoid.

**Conclusion: the biggest blocker is not missing features. It is missing proof — operational,
security, and real-user proof — layered on top of a foundation that is already unusually solid for
its stage.** The plan below is built around closing that proof gap as directly and cheaply as
possible, plus fixing the two concrete, no-decision-required security gaps found this session.

---

## 3. Explicitly NOT building on the path to 8/10

Each of these has a real, defensible reason to defer — not laziness, not scope-avoidance.

| Not building | Why |
|---|---|
| Real AI model integration | No design partner has named a need the deterministic template provider fails to serve; issue #546 already exists as the entry point if/when one does. Building this now buys zero maturity — the assessment explicitly penalizes AI theater, not AI absence. |
| Broader FHIR resource coverage | No named integration partner exists yet. A second/third FHIR resource with no real consumer is the same "unproven code" pattern already flagged, just more of it. |
| Protocol-authoring UI | ADR-0050's own stated philosophy: generalize only after real evidence of need. The current SQL-seed-only authoring path is a genuine, deliberate scope cut, not an oversight — issue #551 already tracks it correctly. |
| Full billing (refunds, outstanding balances, insurance) | #489 is already correctly gated on unresolved business-process decisions (reminder mechanics, refund-approval thresholds) that only Mathew can make. Building schema/UI ahead of those decisions risks building the wrong thing. |
| Full histology stain/IHC/slide-tracking workflow | No design partner has named this as blocking their pilot. The block/slide/fulfillment schema already exists for when it's needed; building the full workflow speculatively is effort spent on potential, not proof. |
| Kubernetes / distributed architecture / microservices split | The current single-droplet, modular-monolith architecture has never been shown to be a scaling bottleneck under any real load. No evidence exists that this is a constraint at pilot scale. |
| A mobile app | Nothing in the current gap analysis points at a mobile-app-shaped problem; the web app's responsive behavior is the actual open question (see UX workstream), and that's a CSS/interaction problem, not a "build a native app" problem. |
| Additional synoptic protocols beyond the existing 7 | Issue #551's own text: pick these up "as real specimen volume/demand signals which organ sites matter next" — not before. |
| Speculative analyzer integrations beyond the one already scoped | FEAT-027 (#36) is already blocked on the design partner naming their actual instrument model — building a generic multi-analyzer story ahead of that is guessing at a spec nobody has given yet. |

---

## 4. Workstreams

### A. Production & Security Hardening (P0)

**Verified current state:**
- The capability-check production exposure is fixed (§0.1).
- `next@16.2.12` carries two live critical unauthenticated-RCE CVEs. **P0 — fix before anything
  else in this plan.**
- `@nestjs/platform-express` is unused dead weight pulling in most of the 32 high-severity findings
  (`multer`). **P0 — remove.**
- RLS (`NOBYPASSRLS` app role, dual structural+live-leak CI check), the audit hash chain, and the
  append-only triggers are real and E2–E3 proven (re-confirmed this session) — this workstream is
  not about rebuilding these, it's about the layers around them.
- No independent security review has ever occurred. All security evidence is internally generated.
- Keycloak realm: `accessTokenLifespan: 300`, `ssoSessionIdleTimeout: 1800` — reasonable; no
  `bruteForceProtected` or `passwordPolicy` configured at the realm level — a real, low-effort gap.
- Backup exists (`pg_dump` cron) and a real automated restore-drill script exists, but **both are
  manual-runbook cron installs, not deploy-automated, and there is no evidence in this session that
  either has ever actually run successfully against the real production droplet.**

**Actions:**
1. **P0, autonomous:** `pnpm update next` to `>=16.3.3` in `apps/web`, re-run the full web test/e2e
   suite, redeploy. No product decision required.
2. **P0, autonomous:** Remove `@nestjs/platform-express` from `apps/api/package.json`; confirm the
   app still builds/boots on Fastify alone (it already does — the dependency is unused); re-run
   `pnpm audit` and record the new vulnerability count.
3. **P0, autonomous:** Re-run `pnpm audit` after both fixes; triage the remaining high/moderate
   findings for any other unused-dependency removals before accepting any as "acceptable residual
   risk, tracked."
4. **P1, autonomous:** Add `bruteForceProtected: true` and a real `passwordPolicy` to the Keycloak
   realm config (a JSON change, no product decision).
5. **P1, requires Mathew (infra access):** Actually install the backup and restore-drill cron jobs
   on the real production droplet (per `infra/scripts/README.md`'s own documented steps), then wait
   for one real cron cycle and confirm a `PASS` line in `/var/log/lis-restore-drill.log` on the
   droplet itself. **This is the evidence upgrade from "a script exists" (E1) to "backup/restore is
   environment-proven" (E4)** — nothing else moves this number.
6. **P2, requires an external party (Mathew to commission):** A scoped, independent security review
   (does not need to be a full paid pentest at this stage — even a structured internal review by
   someone who did not write the code, following the checklist in §11, is a real step up from
   "the team reviewed its own work").

### B. Real Operational Proof — the Pilot Program (P0, the centerpiece of this plan)

This is the single highest-leverage workstream. See §10 for the full program design. Summary here:
the target is one real (or credibly realistic) design-partner-style deployment, run for a defined
minimum period, generating E5 evidence for the clinical core workflow and E4 evidence for the
production environment actually being reachable and usable by someone outside the engineering team.

**Immediate blocker (Mathew-only):** `docs/pilot-remote-access.md` documents a real, already-started
effort (an SSH keypair was generated specifically for this) blocked purely on DigitalOcean console
access to add the public key to the droplet. This is the literal first domino — nothing in this
workstream can proceed past "engineer clicked through it themselves" until this is unblocked.

### C. Clinical Workflow Maturity

**Verified current state:** the full chain (Patient → Order → Payment → Collection → Accession →
Specimen → Work queue → Result → Verification → Report → Amendment → Audit) exists and is
automated-tested (E2) across chemistry, haematology, microbiology, and AP. No dead ends were found
in source. The minimum credible pilot scope does **not** require every discipline — it requires one
discipline exercised completely and convincingly.

**Decision needed:** which single discipline anchors the first pilot (see §16, Decision 1).

**Action:** no new clinical features — the existing chain is sufficient breadth for a first pilot.
The work here is entirely about *proving* the existing chain (Workstream B), not extending it.

### D. AP / Histology / Cytology

**Verified current state:** AP's case/block/slide/report-version/narrative schema is real, with
database-enforced append-only signed reports and a genuinely generic synoptic engine (7 protocols
live). This is the strongest clinical differentiator in the product and should be the pilot's
flagship discipline if the design partner is AP-capable (see Decision 1).

**Essential for a first AP pilot (already present, needs only E4/E5 proof, not new code):**
case lifecycle, synoptic reporting, sign-out, amendment, report PDF with correct clinical identity.

**Important for 8/10 but not pilot-blocking:** nothing — the current AP slice is already sufficient
for a credible pilot.

**Advanced/future, explicitly deferred:** special stains, IHC ordering/tracking, WSI-based
diagnosis workflows beyond the existing viewer. No design-partner need has been named for any of
these; do not build them speculatively.

### E. UX & Workflow Efficiency

**Verified current state:** no independent, live UX re-verification happened this session (the web
dev server was confirmed to boot and serve, nothing more). The most recent live evidence is
`docs/pilot/PILOT-USER-GUIDE.md` (dated through 2026-08-28), which already documents one concrete,
real, unfixed usability hazard: mid-form refresh silently loses all input, with no warning, on every
multi-step form in the app (case accession, order booking, etc.) — a genuine "first real user gets
burned by this" risk.

**Actions:**
1. **P1, autonomous:** A `beforeunload` confirmation prompt (or a lightweight `sessionStorage`
   draft-save/restore) on the highest-risk multi-step forms (case accession, order booking) — a
   small, well-scoped fix for a real, already-documented hazard. No product decision required; this
   is pure defensive UX, not a new feature.
2. **P1, autonomous:** A fresh, live browser pass (desktop + one tablet viewport) immediately before
   the pilot kicks off, re-confirming or correcting the 2026-08-28 findings, rather than trusting a
   month-old pass.
3. **P2:** Do not attempt a comprehensive accessibility audit beyond what `storybook-a11y` already
   covers (component-level) unless the pilot's actual users surface a real barrier — speculative
   a11y work with no named user need is the same anti-pattern as speculative features.

### F. Reliability / Observability / Operations

**Verified current state:** Sentry DSN is wired into the staging compose file; beyond that, no
dashboards, alerting, or SLO tracking exist. Health checks exist and are used correctly in CI/deploy.
Memory limits are hand-tuned per container on a single 1GB-RAM droplet.

**Actions:**
1. **P1, autonomous:** Confirm Sentry is actually receiving events from the real production
   deployment (trigger one deliberate test error, verify it appears in the Sentry project) — moves
   "DSN is wired" from E1 to E4.
2. **P1, autonomous:** A minimal uptime check (even a free external ping service against the
   Tailscale-reachable health endpoint, or a scheduled GitHub Actions workflow hitting `/health`)
   so a production outage is discovered proactively, not by a user complaint that can't happen yet
   because there are no external users.
3. **P2, requires Mathew (infra access):** Complete Workstream A action 5 (real cron-verified
   backup/restore) — listed here too because it is simultaneously a security and an operations
   deliverable.
4. **Not necessary yet:** APM, distributed tracing, log aggregation platforms — no evidence of a
   real operational problem these would solve at current (zero real-user) scale.

### G. Interoperability

**Verified current state:** one FHIR endpoint (`GET Observation/:id`), a real but never-live-verified
HL7 v2 inbound path, and a real gateway ingest→queue→forward pipeline with its first admin UI/API
(instrument-analyte mapping) shipped in PR #825.

**Decision needed:** does the chosen pilot design partner (Decision 1) actually require any
interoperability at all for a first pilot? Most likely answer: **no** — a first pilot with manual
result entry and no external system integration is both realistic and sufficient to generate real
E5/E6 evidence on the core workflow.

**Action:** none in this plan unless Decision 1's partner names a real, concrete interoperability
requirement. Do not expand FHIR or HL7 coverage speculatively (§3).

### H. Billing / Commercial Readiness

**Verified current state:** cash + one stub mobile-money provider, no refunds, no outstanding
balances (#489, correctly gated on unresolved business-process decisions).

**Decision needed:** does the pilot need real payment collection at all, or can it run on the
existing cash-only path (already E2-tested) for its duration? See §16, Decision 2.

**Action:** none beyond what already exists, unless Decision 2 says otherwise.

### I. Performance and Scale

**Verified current state:** no load testing has ever been performed; no evidence exists that
performance is currently a blocker at pilot scale (single lab, small number of concurrent users).

**Action:** **P2, autonomous, cheap, and worth doing before the pilot regardless:** a lightweight
one-time measurement — API p50/p95 latency for the 5-10 highest-traffic real endpoints (worklist,
result entry, order creation) under a simple concurrent-request script against a realistically
seeded local/staging database — just enough to confirm there is no obvious, embarrassing latency
problem waiting to surface in front of a real user. Do not build a full performance-testing harness
or introduce Kubernetes/distributed architecture without evidence of an actual bottleneck.

### J. Testing Strategy

**Verified current state (re-confirmed this session):** 130 test files; 228/228 API unit tests pass
locally; the full local e2e run showed 11 failing spec files, and this session **confirmed via
`git stash` that these failures are pre-existing local dev-database state drift, not caused by any
change made this session** — CI's own last green run (PR #825) ran the identical suite clean against
a fresh Postgres. This is a real, if minor, finding: the shared local dev database has accumulated
enough drift over months of sessions that a full local e2e run is no longer a reliable signal,
even though CI's fresh-DB runs remain trustworthy.

**Actions:**
1. **P2, autonomous:** Document (in `AGENTS.md` or a Skill) that a full local e2e run against the
   long-lived shared dev DB is not a trustworthy signal on its own — `pnpm db:reset` before a full
   local e2e run, or trust CI's fresh-DB run instead, should be the stated convention. This is a
   real, cheap fix to a real, confirmed-this-session gap in institutional knowledge.
2. **Not necessary:** adding tests to raise the count. Every existing test protects a real,
   identified risk already; the gap is proof breadth (E3+), not test quantity.

---

## 5. Priority matrix

| Initiative | Current State | Target State | Evidence Now | Target Evidence | Business Value | Risk Reduction | Effort | Priority |
|---|---|---|---|---|---|---|---|---|
| Upgrade `next` past the critical RCE | Vulnerable version live | Patched | E1 (vulnerable) | E4 (patched + redeployed) | High | Critical | XS | **P0** |
| Remove unused `@nestjs/platform-express` | Dead, vulnerable dependency | Removed | E1 | E4 | Medium | High | XS | **P0** |
| Unblock pilot phone-access (DO console) | Blocked on Mathew | Unblocked | E0 | — | Critical | — | XS (Mathew) | **P0** |
| Run and complete a real pilot | No real pilot | E5/E6 evidence on core workflow | E2/E3 | E5/E6 | Critical | Critical | L | **P0** |
| Real backup/restore cron, verified on droplet | Manual runbook, unverified | Cron installed, one PASS logged | E1 | E4 | High | High | S (Mathew access) | **P1** |
| Independent security review | None | Scoped review completed | E0 | E2-equivalent (reviewed) | High | High | M (external) | **P1** |
| Keycloak brute-force/password policy | Not configured | Configured | E1 (absent) | E1 (present) | Medium | Medium | XS | **P1** |
| Mid-form-refresh data-loss mitigation | Known, documented, unfixed | Fixed on highest-risk forms | E3 (bug confirmed live) | E3 (fixed, re-verified) | Medium | Medium | S | **P1** |
| Fresh live UX pass before pilot | Last live pass 2026-08-28 | Current | E3 (stale) | E3 (fresh) | Medium | Medium | S | **P1** |
| Sentry receiving real production events | Wired, unconfirmed | Confirmed via test event | E1 | E4 | Medium | Medium | XS | **P1** |
| Minimal uptime monitoring | None | Basic external check live | E0 | E4 | Medium | Medium | XS | **P1** |
| Document dev-DB drift / full-e2e-run convention | Undocumented, confirmed real gap | Documented | E0 | E1 | Low | Low | XS | **P2** |
| Lightweight latency measurement | Unmeasured | Measured, recorded | E0 | E2-equivalent (measured) | Low | Medium | S | **P2** |
| Fresh full world-class assessment after pilot | N/A | Completed | — | — | Critical | — | M | **Gate 4/5** |
| Broader FHIR / real AI / full billing / IHC-histology | Deferred by design | Unchanged | E1 (partial) | Unchanged | None yet | None yet | — | **P3 / partner-dependent** |

---

## 6. Maturity gates: 5.7 → 6.5 → 7.0 → 7.5 → 8.0

### Gate 1 — Secure Foundation (target: 5.7 → 6.5)
Must be true:
- No known critical/high-severity unpatched vulnerability in a dependency actually reachable in
  production (`next` RCE fixed, `platform-express` removed, `pnpm audit` re-run clean of
  critical/high findings that aren't explicitly triaged-and-accepted).
- Keycloak realm has brute-force protection and a password policy configured.
- The capability-check exposure fix (already done) stays merged and regression-tested.
- **Evidence:** a `pnpm audit` run with zero unaddressed critical/high findings, committed as a
  dated artifact; the Keycloak realm diff; CI green.

### Gate 2 — Production-credible (target: 6.5 → 7.0)
Must be true:
- Backup + restore-drill cron jobs are actually installed on the real droplet, and at least one
  real `PASS` line exists in the droplet's own restore-drill log.
- Sentry confirmed receiving real events from production.
- A basic external uptime check is live.
- An independent (even if internal-but-not-the-author) security review has been completed against
  the checklist in §11, with findings triaged.
- **Evidence:** the restore-drill log excerpt, a Sentry test-event screenshot/link, the uptime
  check's own dashboard, the security review's write-up.

### Gate 3 — Pilot-ready (target: 7.0 → 7.5)
Must be true:
- The mid-form-refresh data-loss hazard is fixed on the pilot's actual workflow forms.
- A fresh live UX pass has been completed against the pilot's actual chosen discipline (Decision 1).
- The pilot design partner, users, data approach, and duration (§10) are all decided and documented.
- Pilot phone/remote access is unblocked and working.
- **Evidence:** the UX pass write-up, the pilot program document with Mathew's sign-off, a
  successful test login from outside the engineering team's own machines.

### Gate 4 — Pilot-proven (target: 7.5 → 8.0, provisional)
Must be true:
- The pilot has run for its full defined minimum duration (§10) with the defined metrics actually
  collected.
- At least one real production incident, error, or friction point was encountered and resolved
  during the pilot — and the response itself is evidence (not just the absence of problems).
- The chosen core clinical workflow completed end-to-end multiple times with real (or realistic,
  per Decision 3) data, by real intended users, not engineers.
- **Evidence:** the pilot metrics report (§10), incident/response log, user feedback summary.

### Gate 5 — 8/10 (final)
Must be true, independent-reviewer-defensible:
- A completely fresh world-class assessment (same rigor as `world-class-assessment-2026-09-fresh.md`,
  run by an agent instructed not to inherit this plan's optimism) is performed **after** Gate 4, and
  independently concludes 8/10 or better on its own evidence — this plan does not get to declare
  victory by checklist completion alone (§14 of the assessment mission, carried forward here).
- **This gate is not satisfied merely because every task above is marked done.**

---

## 7. Definition of "Done" (applies to every initiative in this plan)

An initiative in this plan is **not** done at "PR merged." It is done when, as applicable to its
nature:
- Code complete, automated-tested (E2), **and**
- End-to-end verified against the real running application (E3), **and**
- Verified in the actual deployment environment where relevant (E4), **and**
- Documented (what changed, why, how to verify it again), **and**
- For anything operational (backup, monitoring, security): a real failure/recovery scenario has
  been exercised, not just designed.

"Merged to main" and "CI green" are necessary, not sufficient, conditions for any item above P2.

---

## 8. Security assurance plan (Workstream A, detailed)

Internally verifiable now (this session already did items 1–6):
1. Application security review (RLS, guards, capability checks) — done, re-confirmed.
2. Authentication review (Keycloak config, token lifespans) — done; gaps found (§4.A).
3. Authorization review (capability model, RBAC) — done, strong (E2–E3).
4. Tenant isolation — done, strong (E2–E3, dual structural+live-leak CI check).
5. RLS verification — done, strong.
6. Database privilege review (`NOBYPASSRLS`, `REVOKE UPDATE, DELETE` on audit table) — done, strong.
7. Dependency scanning — done this session, found real critical findings (§0.2).

Requires independent review (cannot self-certify credibly):
8. API security beyond capability checks (rate limiting, input validation depth, injection surface).
9. File/object storage access-control review (MinIO bucket policies, signed-URL handling).
10. Secrets management review (rotation, blast radius if a secret leaks).
11. Container security (base image CVEs, non-root execution, read-only filesystems where feasible).
12. Network exposure review beyond the firewall rules already documented.
13. Logging/audit review for sensitive-data leakage into logs.
14. Incident response — no documented process exists; needs at least a one-page runbook.

Requires a real security professional (do not attempt to self-certify as "penetration tested"):
15. An actual penetration test — explicitly **not** required for Gate 3/4 in this plan; a scoped
    internal/independent *review* (item 8-14 above) is the honest, achievable bar for 8/10. A full
    pentest is appropriate once there is a real paying customer or real patient data at stake, not
    before — claiming pentest-level assurance without one would itself be a false-completeness
    finding of the kind this whole exercise exists to prevent.

---

## 9. Reliability/operations plan (Workstream F, detailed)

Evidence requirement, stated the disciplined way the mission asked for:

- Not: "Backup system implemented."
  **Instead:** "Production backup cron confirmed installed on the droplet (`crontab -l` output);
  restore-drill cron confirmed installed; at least one real `PASS` line with a recorded
  restoration time exists in `/var/log/lis-restore-drill.log` on the actual droplet."
- Not: "Sentry is wired."
  **Instead:** "A deliberate test error was thrown in the real production API; it appears in the
  Sentry project within N minutes, with the correct environment tag."
- Not: "Health checks exist."
  **Instead:** "An external, independent monitor (outside the deploy workflow itself) has pinged
  the production health endpoint continuously for at least one week with a recorded uptime
  percentage."

---

## 10. Pilot proof program (the centerpiece of this plan)

### Scope
One real (or as-real-as-available) laboratory workflow, anchored on the discipline chosen in
Decision 1 (§16) — most likely AP, the strongest current differentiator (§4.D) — run through the
full chain: Patient → Order → Collection → Accession → Specimen/Case → Result/Synoptic Report →
Verification/Sign-out → Report delivery → Amendment (if one occurs naturally) → Audit.

### Users
- **Reception/administrative** — patient registration, order booking.
- **Technologist/collector** — specimen collection, accessioning.
- **Pathologist** (if AP is the chosen discipline) or **lab technologist + verifier** (if a
  chemistry/haematology discipline is chosen) — result entry, synoptic reporting, sign-out.
- **Lab administrator** — user/role setup, org settings.
- Referring clinician and finance roles are **not required** for the first pilot unless Decision 1's
  partner specifically needs them — keep the pilot's user surface minimal and real.

### Data
**Decision needed (§16, Decision 3):** synthetic/de-identified data is the default recommendation —
avoids any regulatory/consent complexity for a first pilot, and is fully sufficient to generate real
E5 evidence on workflow mechanics, usability, and reliability (the things this plan is actually
trying to prove). Real patient data should only be considered for a *later* pilot phase, after
Decision 3 explicitly authorizes it with appropriate consent/regulatory grounding — this plan does
not assume that authorization exists.

### Duration
**Minimum 2 weeks of active use**, not a single afternoon — long enough to encounter at least one
real operational hiccup (a typo needing correction, a report needing amendment, a login-session
timeout during a busy moment) rather than only the happy path a single demo session would show.

### Metrics collected
- Task completion time for each workflow stage (order → result → signed report).
- Number and nature of system errors encountered (with severity).
- Number of user-reported points of friction (open-ended, not just a satisfaction score).
- Report amendment rate (expected to be non-zero — the point is whether the amendment mechanism
  itself works smoothly, not that amendments never happen).
- Any downtime, however brief, and its cause.
- Support requests raised to the engineering team, and their resolution time.

### Acceptance criteria
- The full chosen-discipline workflow completes end-to-end at least 10 times by the pilot's real
  users (not engineers) without engineering intervention mid-task.
- No data-loss incident occurs (the mid-form-refresh hazard must be fixed before the pilot per
  Gate 3).
- At least one real report reaches a signed, delivered state through the real UI.
- Users can articulate at least one specific improvement they'd want — silence is not a passing
  signal; it usually means engagement was too shallow to be real evidence.

### Evidence collection
A simple shared log (even a spreadsheet) capturing: timestamp, user role, action, outcome,
friction/error noted — reviewed weekly during the pilot, summarized at the end into the Gate 4
pilot metrics report referenced in §6.

---

## 11. (Security assurance plan — see §8, integrated above to avoid duplication.)

## 12. (Performance and scale — see §4.I, integrated above.)

## 13. (Testing strategy — see §4.J, integrated above.)

---

## 14. Phase roadmap

### Phase 0 — Immediate Safety (days, not weeks)
- Upgrade `next` past the critical RCE; remove `@nestjs/platform-express`; re-run `pnpm audit`.
- Configure Keycloak brute-force protection and a password policy.
- Confirm Sentry receives a real test event from production.
- **No Mathew decision required for any Phase 0 item** — all are engineering-only.

### Phase 1 — Production Credibility (1-2 weeks, gated on Mathew infra access for one item)
- Install and verify the real backup/restore-drill cron on the droplet (needs DO/droplet access).
- Commission and complete the scoped internal/independent security review (§8, items 8-14).
- Add a minimal external uptime check.

### Phase 2 — Pilot Readiness (1-2 weeks, parallelizable with Phase 1)
- Fix the mid-form-refresh data-loss hazard on the pilot's actual forms.
- Run a fresh live UX pass on the pilot's chosen discipline.
- Resolve Decisions 1-3 (§16) with Mathew.
- Unblock and complete the phone/remote-access runbook (Mathew: DO console access).
- Prepare the pilot program document (§10) with the specific partner/users/data named concretely.

### Phase 3 — Real Pilot (minimum 2 weeks, per §10)
- Run the pilot. Collect the defined metrics. Do not intervene engineering-side except for genuine
  incident response (and log every intervention as evidence, not as a thing to hide).

### Phase 4 — Evidence & Refinement (1-2 weeks after Phase 3)
- Fix whatever the pilot actually surfaced — and only that. Do not use this phase to sneak in
  unrelated backlog items.
- Compile the pilot metrics report.

### Phase 5 — 8/10 Assessment
- Run a completely fresh world-class assessment, structured exactly like
  `world-class-assessment-2026-09-fresh.md`, performed as if this plan did not exist — no score is
  assumed in advance. **This document does not declare 8/10. Only that fresh assessment can.**

---

## 15. Explicitly Not Building on the Path to 8/10

See §3 — the full list and reasoning lives there to avoid duplication. Summary: real AI, broader
FHIR, protocol-authoring UI, full billing, full histology workflow, Kubernetes/microservices, a
mobile app, speculative additional synoptic protocols, and speculative analyzer integrations are all
explicitly deferred, each for a stated, evidence-based reason, not by default inertia.

---

## 16. Decisions Required from Mathew

### Decision 1 — Which discipline anchors the first pilot?
**Why it matters:** the pilot program (§10) needs one concrete workflow, not an abstract "the
system." The choice determines which users are recruited and what "done" looks like.
**Options:**
- **AP (Recommended).** Strongest current differentiator (§4.D) — genuinely generic synoptic engine,
  database-enforced signed/append-only reports, real case/block/slide hierarchy. A convincing AP
  pilot is also the most defensible evidence for an "advanced/world-class" claim later.
- Chemistry or haematology. Simpler workflow, faster to run, but proves a much more commodity
  capability — less differentiating evidence per unit of pilot effort.
**Consequences:** AP requires recruiting a pathologist's time, a real constraint; chemistry/
haematology is easier to recruit for but produces weaker evidence toward "world-class."
**Recommended information needed to decide:** whether a pathologist's time is realistically
available for the pilot's 2-week minimum duration.

### Decision 2 — Does the pilot need real payment collection?
**Why it matters:** determines whether Workstream H (billing) needs any work at all before the
pilot.
**Options:**
- **No — run the pilot on the existing cash-only path (Recommended).** Already E2-tested; billing
  depth is not what this plan is trying to prove.
- Yes — the partner specifically needs invoicing/payment as part of the proven workflow.
**Consequences:** "No" keeps Phase 2 shorter and avoids opening #489's unresolved business-process
questions under pilot time pressure. "Yes" would require resolving #489's own open questions first.
**Recommended information needed to decide:** whether the chosen pilot partner (Decision 1) actually
bills patients as part of the workflow being demonstrated.

### Decision 3 — Real patient data, de-identified data, or synthetic data for the pilot?
**Why it matters:** materially changes the regulatory/consent posture and how fast the pilot can
start.
**Options:**
- **Synthetic/de-identified data (Recommended).** No consent/regulatory complexity; still produces
  real E5 evidence on workflow mechanics and usability, which is what this plan is actually trying
  to prove first.
- Real patient data with consent. Stronger ultimate evidence (closer to true E6) but requires a
  consent/regulatory process this plan does not currently have any groundwork for.
**Consequences:** starting with synthetic data means a *second*, later pilot phase would be needed
before claiming genuine real-patient-proven (E6) status — but that sequencing is itself the
responsible path, not a shortcut.
**Recommended information needed to decide:** whether the chosen partner (Decision 1) has patients
whose data can be realistically de-identified for a short pilot, or would need to use real
records regardless.

### Decision 4 — Who grants DigitalOcean console access to unblock pilot remote access?
**Why it matters:** this is the literal first blocking domino for the entire pilot program (§4.B).
**Options:** Mathew provides console access directly, or resets/shares droplet root access through
whatever channel is actually available.
**Consequences:** nothing in Phase 2/3 can proceed without this.
**Recommended information needed to decide:** none — this is purely an access-logistics action, not
a judgment call. It is listed as a decision only because only Mathew can execute it.

If any of these are answered before the plan is executed, note the answer directly in this
document's revision history rather than a separate thread, so the plan stays the single source of
truth.

---

## 17. What can be executed autonomously vs. requires Mathew approval

**Agent can execute autonomously (no product/business/clinical judgment required):**
- `next` upgrade and dependency cleanup (Phase 0, all items).
- Keycloak brute-force/password-policy configuration.
- Sentry test-event verification.
- Mid-form-refresh data-loss mitigation (a defensive UX fix, not a new feature).
- Minimal uptime-check setup.
- Fresh live UX pass and write-up.
- Lightweight latency measurement.
- Documenting the dev-DB-drift testing convention.
- Drafting the pilot program document's mechanics (once Decisions 1-3 are answered).
- Compiling the Phase 4 evidence report and running the Phase 5 fresh assessment.

**Requires Mathew approval or action:**
- Decisions 1-4 (§16).
- Granting DigitalOcean console/droplet access.
- Commissioning the independent security review (an external-facing, potentially paid, engagement).
- Recruiting real pilot users (a pathologist's time, reception staff, etc. — outside engineering's
  control).
- Any actual data-sharing arrangement if Decision 3 later moves toward real patient data.

---

## 18. Final 8/10 acceptance criteria

An independent, skeptical reviewer would reasonably rate this LIS 8/10 when **all** of the following
are true and evidenced, not merely asserted:

1. **Secure production operation:** zero unaddressed critical/high dependency vulnerabilities;
   Keycloak hardened; the capability-check-class exposure class of bug has a documented convention
   preventing recurrence.
2. **Independent security assurance:** a completed, dated review (not self-certified) with findings
   triaged and the high-severity ones closed.
3. **Real backup/restore proof:** a logged, successful restore-drill run against the actual
   production droplet, with a recorded restoration time.
4. **A meaningful real (or realistic) pilot:** at minimum, synthetic/de-identified data run by real
   intended users (not engineers) for at least 2 weeks, on one complete clinical workflow, with
   collected metrics and at least one real incident-and-response.
5. **Stable clinical workflow proof:** the chosen discipline's full chain completes repeatedly
   without engineering intervention.
6. **Demonstrated AP capability** (if AP is the chosen pilot discipline, per Decision 1): a real
   synoptic report, signed, delivered, through the actual UI, by a pathologist who is not an
   engineer on this project.
7. **Reliable reporting:** the PDF report chain (already clinically complete per the baseline
   assessment) proven under real pilot use, not just fixture-driven tests.
8. **Operational monitoring:** Sentry confirmed live, uptime monitored, at least one real
   production error observed and triaged through the real pipeline.
9. **Strong tenant isolation and audit integrity:** already true (E2-E3); simply must not regress.
10. **Acceptable UX:** the known data-loss hazard fixed; a fresh live pass confirms no other
    comparable hazard exists on the pilot's actual workflow.
11. **Appropriately scoped interoperability:** whatever the pilot partner actually needed (possibly
    none) — not "more FHIR resources," but "the FHIR/interop surface the real pilot required, if
    any, actually worked."
12. **Realistic performance:** the lightweight latency measurement shows no embarrassing slowness at
    pilot scale.
13. **Documented incident/recovery procedures:** the incident-response runbook (§8, item 14) exists
    and was exercised at least once, even informally, during the pilot.

A fresh, independent world-class assessment performed after Gate 4 is the only thing that actually
certifies 8/10 — this plan sets the conditions for that assessment to reasonably conclude it, and no
step in this plan substitutes for actually running it.

---

## Revision history

- 2026-09-24: Initial version, authored against `world-class-assessment-2026-09-fresh.md`
  (2026-09-23 baseline), with this session's own re-verification (§0) including two new findings
  (Next.js critical CVEs, unused vulnerable dependency) not present in the baseline assessment.
- 2026-09-24 (later same day): **Phase 0 executed.** See
  `docs/plans/task-phase0-security-hardening.md` for full evidence. Summary:
  - `next` upgraded `16.2.12 -> 16.3.6` (both critical RCE advisories resolved, independently
    re-verified via `pnpm audit`).
  - `@nestjs/platform-express` could not be cleanly excluded from the dependency tree (it's an
    *optional peer* of both `@nestjs/core` and `@nestjs/testing`, which pnpm's default
    `auto-install-peers` resolves regardless of removing api's own explicit dependency, and
    `peerDependencyRules.ignoreMissing` does not prevent this — confirmed by direct testing, not
    assumed). Instead, the actually-vulnerable package underneath it (`multer@2.2.0`, pinned by
    `@nestjs/platform-express@11.1.28`) was forced to `2.4.0` via a `pnpm-workspace.yaml` override
    — the real security outcome (multer's 3 high + 1 low findings gone from `pnpm audit`) achieved
    without the broader, riskier change of disabling `auto-install-peers` workspace-wide.
  - Combined effect: `pnpm audit` went from 53 findings (2 critical, 32 high, 14 moderate, 5 low)
    to 41 (0 critical, 25 high, 12 moderate, 4 low) — the Next.js bump also incidentally cleared
    `sharp`'s two high-severity findings.
  - Keycloak realm hardened: `bruteForceProtected`, a generous `failureFactor`/wait-time policy
    that never permanently locks a real user out, and a minimal `passwordPolicy` — verified against
    a real re-imported local Keycloak, confirmed via the admin API that the settings actually took
    effect, and confirmed the existing seeded `test-user` credential still logs in and the full API
    e2e auth-related suite still passes.
  - Sentry production-event verification: **blocked**, honestly documented rather than claimed —
    this session has no credentials or network access to the real Sentry project (the DSN is a
    GitHub Actions secret injected only into the production droplet at deploy time). Verifying this
    remains a Phase 0 follow-up for whoever has that access.
  - All local verification (build/typecheck/lint/unit tests across api/web/gateway/interop, the
    full API e2e suite, gateway/interop e2e) passed with no regressions relative to the pre-Phase-0
    baseline. The local web Playwright e2e suite showed pre-existing, already-documented `next dev`
    cold-compile flakiness (see `apps/web/e2e/auth.ts`'s own header comment) — not a regression;
    the real CI `web-e2e` job (production build, not dev mode) is the authoritative gate for this
    suite, per this plan's own Testing Strategy workstream (§4.J) finding that a local ad hoc run is
    not a trustworthy signal on its own.
