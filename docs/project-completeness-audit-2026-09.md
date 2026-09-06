# Project Completeness Audit — September 2026

**Author:** Claude Code, independent pass, 2026-09-05/06. **Method:** repository/architecture
inspection (55 knowledge-base documents, 55 ADRs, `apps/api/src`'s 38 modules, `apps/web` routes,
`packages/domain`/`packages/db`), full GitHub milestone/issue backlog inventory (280 issues, 15
milestones, cross-checked against actual code rather than trusted at face value), and the two most
recent live-verification sources already in this repo: `docs/pilot/PILOT-USER-GUIDE.md` (three
real-browser passes, 2026-08-26→28, functional/RBAC-focused) and
`docs/ux-responsiveness-audit-2026-09-05.md` (this week, UX-focused, three P0-P2 fixes already
shipped as a direct result — #800/#802, #803/#804, #805/#806). This report does not re-litigate
either — it adds the one lens neither took: **is this a complete, production-credible LIS, judged
against its own stated scope, not a generic ideal.**

---

## Executive Summary

This is **not** a narrow MVP. The knowledge base (`lis-engineering/knowledge-base/00`–`55`)
describes an extremely ambitious vision — a metadata-driven, standards-native, multi-discipline LIS
that could run "a two-person clinic lab or a national reference network." The remarkable finding of
this audit: **the team has actually built against nearly the entire roadmap**, not just the AP
pilot slice this week's UX audit focused on. Fifteen milestones (M0–M14) exist; 250 of 280 GitHub
issues are closed (89%); real, working code exists for chemistry, haematology, QC/Westgard/
Levey-Jennings, critical-value escalation, a generic workflow/reflex/auto-verification engine, a
template engine + visual report designer, HL7 v2 + FHIR R4 + patient/clinician portals, billing +
tenancy tiers + i18n + self-service onboarding, microbiology culture/antibiogram/AMR surveillance,
and — the deepest, most recently hardened area — Anatomic Pathology with a real generic synoptic
protocol engine, two-tier cytology, WSI viewing, and human sign-out with step-up digital signatures.

But breadth is not depth, and this audit's job is to tell the two apart. Two genuinely significant
**false-completeness** findings anchor this report:

1. **"Governed AI" (M9/EPIC-008, fully closed) has no real AI in it.** The provider abstraction,
   PHI-minimization layer, and evaluation harness are real and well-built — but the only provider
   ever implemented is `StubProvider` (`apps/api/src/ai/providers/stub-provider.ts`, literally
   returns `"no live model configured"`) and a hard-coded phrase-lookup table
   (`template-provider.ts`) for haematology morphology descriptions. Every "AI-drafted narrative" a
   pathologist or hematologist sees today is either a stub string or a canned sentence keyed off a
   grade — never a model call. This is honestly self-documented in the code's own comments, but the
   milestone/epic framing ("Governed AI: closed") will read as "the product has AI" to anyone who
   trusts the backlog instead of the code.
2. **"Automate" (M6, mostly closed) has never ingested a result from a real analyzer.** The generic
   edge-gateway ingestion pipeline, idempotency, and correlation logic are real and tested — but
   `FEAT-027: Analyzer #1 driver` is still open. No physical or even simulated real-vendor analyzer
   protocol has ever been wired up; every result in this system today was entered manually or
   synthetically via direct API calls in tests.

Neither of these is a bug — both are exactly what their own ADRs (ADR-0037, and the billing
equivalent ADR-0041 for mobile money) say they'd be: real extension points, deliberately stubbed
until a real consumer needs the live thing. The gap is between that honest engineering reality and
how "closed milestone" reads from the outside. **This report treats "architecturally real,
functionally stubbed" as its own classification, not simply COMPLETE.**

**Overall verdict, in one line:** this is a genuinely capable **Pilot-ready** system for its actual
current target (a single-tenant AP/histology/cytology laboratory, the one the last three months of
work has been driving toward), with real, deep, structured-first clinical data underneath — but it
is not **production-ready** for the multi-discipline, standards-integrated, AI-augmented vision the
knowledge base describes, and several of the milestones that look closed are closed at "real
scaffolding, stub behind it," not "field-usable."

---

## Overall Completeness: **~58%** against the project's own full stated scope (00–55 vision);
## **~85%** against the actual, current AP-pilot target the last 10 sessions have been building toward

Two numbers are given deliberately, because the audit brief's own scope-fairness rule cuts both
ways here: judging this project only against the generic-LIS ideal would understate real, working
depth (chemistry/haematology/QC/microbiology are further along than the current UX-audit lens
suggested); judging it only against this week's AP pilot would overstate how close the *whole
platform* is to the vision's own stated ambition (multi-discipline, standards-native, AI-ready,
analyzer-integrated). Both numbers are defensible; neither alone is the honest answer.

## Maturity Level: **Level 3 — Pilot-ready** (for the AP/histology/cytology track specifically)

- **Why Level 3, not Level 2:** the AP workflow is genuinely end-to-end, live-verified, with real
  audit trails, real step-up-authenticated digital signatures, real RBAC, real PDF generation and
  email delivery, and a design-partner-facing pilot guide with a clean exit-gate scorecard
  (zero 🔴/🟠 rows, 2026-08-28). That is materially more than "functional MVP."
- **Why not Level 4 (Production-ready):** (a) the shared dev/demo tenant is not clean and requires a
  manual reset before any real use (an operational gap, not code, but a real one); (b) no real
  payment gateway exists behind billing (stub only); (c) no real analyzer has ever fed a result into
  the system; (d) the "AI" milestone has zero live model calls behind it; (e) DR/backup is
  single-droplet, staging-only, no PITR/multi-region (correctly scoped down per ADR-0044, but still
  a real production gap for anyone relying on this for irreplaceable clinical data); (f) chemistry
  reference ranges/critical thresholds are explicitly flagged as "not yet lab-reviewed" (issue #171,
  `needs-clinical-review`) — meaning even the *oldest*, most-built-out discipline has an
  unresolved clinical-safety sign-off gate, not just AP.
- **What would move it to Level 4:** design-partner clinical sign-off on the AI phrasing (#483) and
  the chemistry golden dataset (#171); a real payment provider wired in if any real tenant needs
  online payment; at least one real analyzer connected end-to-end; the demo-tenant hygiene fixed
  operationally; and the P0/P1 gaps in this report closed.

---

## Scoring Methodology

Each area below is scored 0–100% by triangulating three signals, not by counting closed GitHub
issues:

1. **Code presence** — does the domain/API/UI/persistence chain genuinely exist (verified by
   reading the actual controller/service/schema/page, not by trusting an issue title)?
2. **Live-verified evidence** — has this been driven through a real browser against a real running
   stack (cited to `PILOT-USER-GUIDE.md`'s specific Part, this week's UX audit, or this audit's own
   spot-checks), or is it code-inspection-only?
3. **Depth vs. surface** — is there a real vendor/model/protocol behind an abstraction, or a stub?
   (This is where the AI and billing findings above get weighted down hard.)

| Area | Weight | Score | Rationale |
|---|---|---|---|
| Core clinical workflow (patient→order→specimen→result, Chemistry/Haematology) | 20% | 75% | Real, structured Observation model; QC/Westgard/critical escalation built and tested; but the golden reference dataset is explicitly unreviewed (#171) and no real analyzer has ever fed it |
| Anatomic Pathology (Histology + the case/synoptic/sign-out spine) | 20% | 80% | The deepest, most live-verified track in the whole system; real synoptic engine, real step-up signatures, real audit; genuine gaps remain (repeating groups, unit/precision qualifiers, only 2 of 7 seeded protocols ever opened live) |
| Cytology | 8% | 65% | Two-tier screen→review→sign-out is real and live-verified; only Bethesda/cervical is live-tested, workflow-policy configurability explicitly deferred (#552) |
| Histology (as a discipline distinct from the AP case spine) | 5% | 40% | Blocks/slides/accessioning exist and work; no tissue-processing/embedding/sectioning tracking, no special-stain/IHC ordering workflow beyond a generic "add test" reflex — this week's EPIC-013 v1 QC-batch feature is the first real step toward this, still narrow |
| Reporting (composition, templates, PDF, delivery) | 10% | 70% | Real template engine + versioned protocol engine + PDF + email delivery, live-verified; the case-report PDF renderer is itself hard-coded per issue #669, not template-driven yet — ironic given the template engine exists for the numeric-panel side |
| Billing | 8% | 55% | Real invoice/payment/balance/facility-statement flow, live-verified; no real payment gateway (stub only); no refunds/reversals (#489 open); no per-facility pricing; currency is unvalidated free text |
| Platform (auth, RBAC, tenancy, audit, admin) | 15% | 80% | Genuinely strong — RLS-backed tenant isolation, capability-based RBAC confirmed via a real e2e matrix spec, real audit trail with step-up provenance, self-service onboarding that creates a real isolated tenant |
| Interoperability (HL7/FHIR/portals) | 6% | 45% | Real, tested code exists (HL7 v2 ACL, FHIR R4 observation façade, patient/clinician portals) but is narrow (FHIR is read-only Observation export only) and has **zero live-verified evidence** anywhere in this repo's own testing history — built and unit-tested, never driven through a real browser/real HL7 message in anger |
| AI | 4% | 15% | Real, well-designed extension architecture; **zero real model integration** — see Executive Summary |
| Production readiness (security/reliability/observability/DR/deploy) | 4% | 60% | Real CI gates (RLS isolation check, invariant checks, a11y, e2e), real staging deploy pipeline, real (if minimal) backup+restore-drill; no production environment exists yet at all — everything cited is staging |

**Weighted overall: ~66%** using this table's own weights — the difference from the "58% vs 85%"
headline figures reflects that this table weights the *built-out* disciplines (chemistry/
haematology/platform) more heavily than a pure "what does the current pilot need" view would,
while still being pulled down hard by AI/interop/production-readiness's real thinness. Treat all
three numbers (58/66/85) as different valid answers to different questions, not a contradiction —
this is explicitly a judgment call named in the audit's own instructions, disclosed rather than
hidden behind one false-precision figure.

### Separate sub-scores

| Dimension | Score |
|---|---|
| Functional completeness (does the code exist and basically work) | 72% |
| Clinical workflow completeness (Chemistry/Haematology/Microbiology loop) | 70% |
| AP completeness | 80% |
| Cytology completeness | 65% |
| Reporting completeness | 70% |
| Billing completeness | 55% |
| Platform completeness | 80% |
| Production readiness | 45% |

---

## Capability Matrix

Legend: 🟢 COMPLETE · 🟡 FUNCTIONAL BUT INCOMPLETE · 🟠 PARTIAL · 🔵 UI-ONLY · 🟣 BACKEND-ONLY ·
⚪ PLANNED · 🔴 MISSING · ⚫ OUT OF SCOPE · ❓ NEEDS PRODUCT DECISION

### Platform

| Capability | Status | Evidence |
|---|---|---|
| Authentication (Keycloak/OIDC) | 🟢 | Real OIDC login, session-cookie split fix (issue #762 investigation), step-up re-auth for sign-out — all live-verified (`PILOT-USER-GUIDE.md` §0.1, §9.5) |
| Tenant isolation | 🟢 | Postgres RLS, not app-level checks (ADR per KB-38); cross-tenant probe accounts (`test-user-2/6`) confirmed denied |
| RBAC/capabilities | 🟢 | Full allow/deny matrix has a real e2e spec (`rbac-matrix.e2e-spec.ts`, PR #785) plus a live UI/UX pass confirming denial messaging and hidden controls |
| Audit logging | 🟢 | Real `audit_event` table, a dedicated in-app Audit trail section on case detail (issue #714), step-up provenance captured (`context.step_up`) |
| Organization settings | 🟡 | Works and persists, but currency is unvalidated free text (`[DESIGN DECISION REQUIRED]`, `PILOT-USER-GUIDE.md` §2.2), no logo upload (URL-only) |
| User management | 🟢 | Real Keycloak-backed CRUD, role change, enable/disable, live-verified end to end (`PILOT-USER-GUIDE.md` §3) |
| Self-service onboarding | 🟢 | Creates a real isolated tenant with starter catalog + SLA targets + report templates; the session-cookie-size bug that made it *completely* unusable was found and fixed this same pilot-readiness push — a real save, not a footnote |
| Multi-tenancy tiers (schema/DB isolation per ADR-0039) | 🟣 | FEAT-045 closed, code exists (tenant registry + schema-scoped connection resolver); **no live-verified evidence** this repo's own testing has actually exercised a second isolation tier in a real request |

### Patient Management

| Capability | Status | Evidence |
|---|---|---|
| Registration | 🟢 | Live-verified, MRN server-generated, duplicate detection (hard block on National ID, soft warn-and-confirm on name+DOB) both confirmed real |
| Search/list | 🟡 | Works, but 50-row hard cap with no pager (deliberate ADR-0013 deferral), only Name column sortable |
| Demographic editing | 🟢 | Real, audited (before/after captured), MRN correctly immutable |
| Patient-facing history/audit visibility | 🔴 | Corrections are audited server-side but no patient-facing screen surfaces that trail |
| Patient merge | 🟣 | FEAT-065 closed, ADR-0052 describes a real design (survivor/tombstone, FK rewrite) — **no live-verified UI/workflow evidence found in this audit or the pilot guide**; worth a direct check before relying on it |

### Referrals

| Capability | Status | Evidence |
|---|---|---|
| Referring facilities (create + list) | 🟡 | Works, live-verified; **no edit/delete route exists at all** — a typo in a facility's phone/address can never be corrected through the UI (`PILOT-USER-GUIDE.md` §4.8, `[DESIGN DECISION REQUIRED]`) |
| Facility as invoice payer | 🟢 | Live-verified end to end into a real facility statement |
| Per-facility pricing | 🔴 | Confirmed by schema grep: `test_definition.priceCents` is a single flat value, no facility-price table anywhere |

### Orders

| Capability | Status | Evidence |
|---|---|---|
| Order creation/booking | 🟢 | Live-verified, catalog-driven, priority/facility/requesting-doctor captured |
| Order lifecycle/status | 🟢 | `ordered`→`received`/`in_process`→terminal states, confirmed via real request logs |
| Cancellation | 🟢 | Real `CancelOrderButton`, gated correctly |
| Amendment (order-level, not case-level) | 🔴 | No order amendment path found distinct from cancel+re-order |
| Order search | 🟡 | `q` search added this week (#748); still capped at 100 with no pager |

### Specimens

| Capability | Status | Evidence |
|---|---|---|
| Accessioning (AP) | 🟢 | Real accession-number scheme (ADR-0049), duplicate-order rejection via a real DB constraint |
| Specimen rejection | 🟢 | Rejection reason captured, status visible in UI, live-verified |
| Barcode/label printing | 🟡 | KB-24 (Barcoding) exists as an architecture doc; a specimen-label print-preview route exists (frontend-design Skill entry #5 references it) — **not directly re-verified this pass**, worth a dedicated check before claiming complete |
| Specimen type controlled vocabulary | 🔴 | Specimen type is free text at accession — a typo silently breaks the two-tier cytology check (self-documented risk in `PILOT-USER-GUIDE.md` §9.1) |
| General (non-AP) specimen reception/collection queue | 🟢 | `/reception`, `/collection-queue` exist and are role-gated, confirmed reachable |

### Laboratory Workflow (generic, non-discipline-specific)

| Capability | Status | Evidence |
|---|---|---|
| Work queues/worklist | 🟢 | Live, filterable by priority/date/stage, SLA/TAT column present |
| Metadata-driven workflow engine (FEAT-029) | 🟢 | Closed, real; the AP case status machine explicitly does **not** use it as its source of truth — see False Completeness below |
| Reflex rules engine | 🟢 | Real (FEAT-030), confirmed consumed by cytology's ASC-US→HPV reflex (issue #661) |
| Auto-verification | 🟢 | Closed as deny-by-default (FEAT-031) — a conservative, safety-appropriate default |
| Assignment | 🟡 | Worklist has an "Assignee" column; no evidence of a real assignment *action* (claim/reassign) beyond display |

### Test Catalog

| Capability | Status | Evidence |
|---|---|---|
| Catalog browse/view | 🟢 | Real, seeded with priced LOINC/UCUM-coded chemistry/haematology/microbiology + AP procedures |
| Catalog admin UI (create) | 🟠 | Create-only screen, missing price/billing-code/specimen-type/active-flag fields even though the schema has them (`PILOT-USER-GUIDE.md` §5.2) — a genuine UI/backend gap, not a backend gap |
| Reference ranges | 🟢 | Sex/age/method-varying ranges modeled and seeded; population-derived ranges explicitly deferred (#519) |
| Pricing | 🟡 | Flat, single price per test; no per-facility/payer pricing; a test created without a price is correctly rejected at invoice time with a clear message, not a crash |

### Results

| Capability | Status | Evidence |
|---|---|---|
| Manual result entry | 🟢 | Real, structured `Observation` rows, not free text — the core thesis is genuinely implemented |
| Analyzer-fed results | 🔴 | Generic ingestion pipeline exists and is tested; **no real analyzer has ever produced a result** (#36 open) |
| Delta checks | 🟢 | FEAT-025 closed, real |
| Critical-value notification + escalation + read-back | 🟢 | FEAT-021/TASK-065/066 closed; escalation timer is real, not just a flag |
| QC gating (Westgard/Levey-Jennings) | 🟢 | Real engine + chart UI, closed and (per milestone) tested |
| Result amendment | 🟡 | Case-level amendment exists and is live-verified for AP; **no evidence found of an equivalent amendment path for a plain numeric chemistry/haematology result** post-verification |

### Anatomic Pathology

| Capability | Status | Evidence |
|---|---|---|
| Case/Specimen/Block/Slide hierarchy | 🟢 | Live-verified tree rendering, real accession-number scheme per level |
| Gross/microscopic/diagnosis narrative | 🟢 | Live-verified persistence; **not append-only** — editable at any pre-sign-out status (self-documented schema comment), a real, disclosed integrity gap |
| Synoptic protocol engine | 🟢 | Generic, versioned, conditional-visibility, requirement-tiered (required/conditional/recommended) — genuinely sophisticated; live-verified for Breast + Colorectal only |
| Additional CAP/ICCR protocols (Lung, Prostate, beyond the 2 live-tested) | ⚪ | Seeded, never opened/filled live by anyone (#551 open) |
| Repeating groups (multifocal tumors, multiple nodal basins) | 🔴 | Confirmed missing by the engine's own code (issue #666 closed as *acknowledged*, not *solved* — the underlying schema still has no data path per this audit's own code read) — **re-verify**: closed-issue status here may reflect a partial fix; treat as PARTIAL, not fully resolved, until re-checked |
| Unit/precision qualifiers on quantity elements | 🟡 | Issue #663 closed; confirmed live in this week's own testing (a `mm` unit rendered correctly) |
| Concept-block reuse across protocols (staging/margins library) | ⚪ | Issue #667 closed as a decision, not yet built as reusable infrastructure |
| Biomarker/ancillary panel modeling | 🟢 | Linked-panel mechanism exists and works (confirmed live this week: "Breast Biomarker Panel (ER/PR/HER2)") |
| Sign-out / human verification / step-up digital signature | 🟢 | ADR-0051; live-verified with real HMAC-signed report versions and captured `auth_time` |
| Amendment (post-sign-out) | 🟢 | Live-verified with a real reason captured |
| Case detail patient identity | 🟢 | **Was a P0 gap (issue #800) — fixed this week (PR #802)**, now shows name/MRN/order link |
| Case-level report PDF rendering | 🟠 | Hard-coded renderer, not template-driven (issue #669 closed as *acknowledged*) — will need real work once repeating structure/protocol variety grows |
| Case status single-source-of-truth | 🟠 | Issue #672 (closed) documents the status enum's derived sets being independently re-computed in 3-4 frontend files — a real architectural smell, closed as a decision not a fix per this audit's own read of the issue title |
| DB-level status-transition constraint | 🔴 | Issue #671 (closed as acknowledged): illegal transitions are blocked only in application code, no DB constraint |

### Cytology

| Capability | Status | Evidence |
|---|---|---|
| Screening → pending_review → sign-out | 🟢 | Live-verified, `PILOT-USER-GUIDE.md` §11 |
| Reject/return-to-screening | 🟢 | Real backend route + UI (issue #639 closed) |
| Bethesda-coded reporting + adequacy | 🟢 | Live-verified for cervical/Pap |
| Two-tier workflow policy configurability | ⚪ | Explicitly deferred (#552 open) — every case today uses one fixed policy |
| ASC-US→HPV reflex | 🟢 | Confirmed real and consuming the reflex-rule engine (#661) |
| Additional structured cytology systems (non-cervical) | 🔴 | #550 open — cervical/Bethesda is the only one that exists |

### Histology (as its own discipline, distinct from the AP case spine above)

| Capability | Status | Evidence |
|---|---|---|
| Block/slide creation | 🟢 | Part of the AP case spine, live-verified |
| Tissue processing/embedding/sectioning tracking | 🟠 | This week's EPIC-013 v1 (specimen-processing-batch QC) is the *first* real step here — batch-level pass/fail against one real evidenced paper form (tissue processing/microtomy/H&E), deliberately narrow, not a general histology-lab-operations module |
| Special stain / IHC ordering as a first-class workflow | 🟡 | Exists only as a generic "add reflex test" on a block — functional, but not a dedicated stains/IHC worklist with its own turnaround tracking |
| Slide/result relationship (which stain produced which finding) | 🔴 | No structured link found between a slide and the specific narrative/synoptic finding it supports |

### WSI / Digital Pathology

| Capability | Status | Evidence |
|---|---|---|
| WSI metadata + upload | 🟢 | Real MinIO-backed object storage (ADR-0054), DZI pre-tiling (ADR-0055) |
| Image viewing | 🟢 | Real OpenSeadragon-based viewer, live-verified (both rejection paths + valid upload confirmed live per `PILOT-USER-GUIDE.md` §12) |
| Path-traversal/size-cap protection on ZIP upload | 🟡 | Issue #660 closed as *acknowledged self-documented gap* in `dzi-unzip.service.ts` — re-verify this was actually hardened, not just tracked |
| Tablet-width viewer layout | ⚪ | **Never visually verified by any session, including this one** — three consecutive sessions have hit the identical tooling wall (`ux-responsiveness-audit-2026-09-05.md` §0/§7) |
| Scanner integration (real vendor scanner → auto-ingest) | 🔴 | Upload is manual/API-driven only; no scanner protocol integration exists |
| AI-assisted image analysis for synoptic pre-fill | ⚪ | Explicitly deferred (#546 open) |

### Reporting

| Capability | Status | Evidence |
|---|---|---|
| Numeric/panel report templates (config-driven, versioned) | 🟢 | FEAT-032 closed, real template engine |
| Visual report designer | 🟢 | FEAT-047 closed — a structured canvas over the template engine (ADR-0042), not a full authoring suite |
| AP case report PDF | 🟢 (content) / 🟠 (architecture) | Content is real and correct, live-verified (patient/specimen/narrative/synoptic/signature all present in the downloaded PDF); the renderer itself is hard-coded rather than template-driven (#669) |
| Report email delivery (patient/facility) | 🟢 | Real, live-verified (MailHog-confirmed in earlier sessions; this week's own environment-hygiene note flags the *dev* `.env` pointing at real Gmail instead of MailHog — an operational risk, not a code gap) |
| Preliminary/final report states | 🟢 | ADR-0047 — an endpoint-selected field, not a new state machine, a reasonable scoping choice |
| Cumulative/trend reports | 🟢 | FEAT-033 closed |
| Operational reports (TAT, workload) | 🟢 | FEAT-034 closed |
| AI-drafted narrative/summary | 🟠 | **Real UI/workflow exists; the "AI" behind it is a stub or a canned lookup table, never a model call** — see Executive Summary |

### Billing

| Capability | Status | Evidence |
|---|---|---|
| Pricing at order time | 🟢 | Live-verified, correct currency handling (issue #765 fix confirmed still holding) |
| Invoice generation (cash + facility) | 🟢 | Live-verified, idempotent (double-click confirmed not to duplicate) |
| Payment recording | 🟢 | Live-verified, overpayment correctly rejected with a real 400 |
| Facility consolidated statement | 🟢 | Live-verified, correct date-range/total math |
| Real payment gateway (card/mobile money) | 🟠 | Stub provider only (`stub-mobile-money-provider.ts`) — ADR-0041 correctly discloses this |
| Refunds/reversals | 🔴 | #489 open, explicitly named gap |
| Invoice/statement email delivery | 🟢 | Shipped this session cycle (issue #711, invoice-email PR #790) — closes what the earlier UX-audit-era `PILOT-USER-GUIDE.md` still listed as missing |
| Financial audit trail | 🟢 | Same `audit_event` mechanism as clinical actions — no separate, weaker trail for money |

### Notifications

| Capability | Status | Evidence |
|---|---|---|
| Email (reports, invoices) | 🟢 | Real SMTP integration (Gmail-app-password or MailHog), live-verified |
| SMS | 🔴 | No SMS/telecom-provider integration found anywhere in the codebase |
| In-app workflow notifications (e.g. "case assigned to you") | 🔴 | No push/in-app notification mechanism found beyond the worklist itself being the passive queue |
| Critical-value escalation notification | 🟢 | Real, distinct from generic notifications — this is the one channel that's genuinely built to a clinical-safety standard (timers, read-back capture) |

### Administration

| Capability | Status | Evidence |
|---|---|---|
| User/role/org/catalog/facility admin | 🟢 | All live-verified this pilot-readiness cycle |
| Billing administration (pricing rules, payer config) | 🟠 | Exists only implicitly via the catalog admin's missing price field (#5.2 above) |
| Audit trail admin view (cross-case, queryable) | 🟡 | Per-case audit trail exists; no evidence of a global, filterable audit-log admin screen |

---

## End-to-End Workflow Assessment

Tracing UI → SDK → API → domain → persistence → workflow → audit → output for the workflows the
audit brief names, using `PILOT-USER-GUIDE.md`'s own live-verified evidence (cited by its Part
number) rather than re-driving each one from scratch this pass:

**Patient → Order → Payment.** 🟢 Fully live-verified, `PILOT-USER-GUIDE.md` Parts 6/8/15. Every
link in the chain is real: MRN generation, duplicate detection, catalog-driven booking, invoice
generation with correct pricing/currency, payment recording with correct balance math, all captured
in the audit trail. **No broken link found.**

**Patient → Order → Specimen → Laboratory workflow → Result (non-AP).** 🟡 The individual pieces
(registration, booking, worklist, result entry, QC gating, critical escalation) are each real and
individually tested — but this audit found **no single live-verified trace of this exact full
chain end to end** in either `PILOT-USER-GUIDE.md` or this week's UX audit; both focused on the AP
track. This is a real evidentiary gap, not necessarily a functional one — recommend a dedicated
live pass before treating the chemistry/haematology loop as equally proven to the AP one.

**AP: Patient → Order → Case → Specimen/Part → Gross → Microscopy → Diagnosis → Synoptic → Review →
Sign-out → Report.** 🟢 The single most thoroughly proven chain in the entire system —
`PILOT-USER-GUIDE.md` Parts 8/9/10/14, re-confirmed independently at the 2026-08-28 exit gate on a
*brand-new* self-signup tenant (not just the seeded one), and again this week during the #800/#803
fix verification. **This is real, not a demo.**

**Cytology: Order → Case → Screening → Review → Finalization → Report.** 🟢 Live-verified,
`PILOT-USER-GUIDE.md` §11. Narrower scope than AP (one structured system, one fixed workflow
policy) but genuinely complete for that scope.

**Report: Completed case → signed report → retrieve report → PDF.** 🟢 Live-verified repeatedly,
including a real dev-server access-log cross-check that ruled out a false "503" the browser
automation tool itself reported (`PILOT-USER-GUIDE.md` §23) — a good example of this project's own
evidentiary discipline.

**Billing: Order → invoice → payment → balance.** 🟢 Live-verified, `PILOT-USER-GUIDE.md` §15/§16,
re-confirmed at the independent exit gate.

**Verdict on this section:** every workflow the brief names as "AP/Cytology/Reporting/Billing" is
genuinely proven end to end. The one gap is the **plain chemistry/haematology clinical loop** —
built, unit/e2e-tested at the API layer, but not demonstrably driven through a real browser
end-to-end the way the AP track has been. Given this is nominally the *oldest, most foundational*
part of the system (M4/M5, "the thesis milestone"), that's a notable evidentiary asymmetry worth
closing before calling the whole platform equally proven.

---

## AP Assessment

Already the most-documented area of this repo. Summary judgment: **genuinely the strongest part of
the product**, both in depth (a real generic synoptic engine sourced from ICCR content, not a
per-organ hard-coded form) and in live-verification rigor (three independent passes, an
independent exit-gate re-run, and this week's own two shipped fixes). The remaining gaps are
specific and named, not vague: repeating groups, unit/precision on more elements, only 2 of 7
seeded protocols ever actually filled live, the report PDF renderer being hard-coded rather than
template-driven, and the case-status derived-set duplication across frontend files. None of these
block the current pilot; several would need attention before a second/third design-partner lab with
different protocol needs comes on board.

## Cytology Assessment

Real and complete for its one supported system (cervical/Bethesda). The explicit deferral of
workflow-policy configurability (#552) and additional structured systems (#550) means this is
correctly scoped as "cytology V1," not "cytology," and should be marketed/sold as such.

## Histology Assessment

The weakest of the three AP sub-disciplines relative to what a real histology *lab* (not just an AP
*case*) needs operationally — tissue processing, embedding, sectioning, and stain/IHC as their own
tracked workflows are thin-to-absent. This week's EPIC-013 v1 is a genuine, real first step (a real
paper form digitized), but it's one form, one discipline slice, not a histology-lab-operations
module. **This is a reasonable place to be for a pilot with one design-partner pathology lab**,
but it is the part of "Anatomic Pathology" most likely to feel incomplete to a technologist (as
opposed to a pathologist) at that lab.

## Reporting Assessment

Two report engines exist side by side: a real, mature, versioned template engine for numeric/panel
reports (with a visual designer on top), and a hard-coded PDF renderer for AP case reports. Both
produce correct, live-verified output today. The architectural question — whether the AP renderer
should eventually move onto the same template engine — is real but not urgent; issue #669 already
tracks it as a known, deliberate near-term debt, not a silent gap.

## Billing Assessment

Solid for the one thing it does today (manual cash/facility billing with correct math and audit).
Correctly, honestly scoped away from being a real payments processor (ADR-0041). The two real gaps
— refunds/reversals and per-facility pricing — are both already named in the backlog, not new
findings.

## Platform Assessment

The strongest area of the whole system by evidence density: RLS-backed tenant isolation, a real
RBAC e2e matrix, real audit provenance including step-up method/timestamp, and a self-service
onboarding path that has been independently exit-gate re-verified on a genuinely fresh tenant. This
is not "looks secure" — it's "has been adversarially tested against its own claims" (the negative
RBAC test with a zero-role account, the cross-tenant isolation probes).

## Security/Reliability Assessment

- **Security:** strong tenant isolation and RBAC (above). Two disclosed, real gaps: the
  self-signup route is deliberately unauthenticated with no rate limiting/CAPTCHA/email
  verification (self-documented in `onboarding.controller.ts`, `[DESIGN DECISION REQUIRED]` before
  any public internet exposure); and the dev `.env`'s real Gmail SMTP credentials sitting where
  MailHog should be is an operational hygiene risk, not a code one.
- **Reliability:** invoice generation is confirmed idempotent under a double-click; a network
  interruption mid-submit was tested and confirmed to leave zero partial writes, just a generic
  (not purpose-built) error screen (issue #775, fixed this session cycle for the *uncaught network
  error* class specifically). No evidence of load/concurrency testing beyond this.
- **Data integrity:** the structured-Observation thesis is real, not aspirational — this is the
  project's single biggest genuine strength. Two disclosed integrity gaps: AP narrative fields are
  not append-only pre-sign-out, and case-status transitions are enforced only in application code,
  not at the DB level.
- **Observability:** `Sentry correlation IDs` exist as a closed task (TASK-010); no further
  observability depth (dashboards, alerting, SLOs) was found or claimed anywhere in this repo.

---

## Architecture Assessment

**Coherent and disciplined**, more so than most projects at this scope. Evidence: 55 ADRs, each
with a real "Alternatives rejected" section and an honest trade-off statement (not just a decision
log — an argued one); a single canonical knowledge base that downstream ADRs consistently cite;
zero `TODO`/`FIXME` comments found anywhere in `apps/api/src`, `apps/web/app`, or `packages/*/src`
(this repo tracks debt as GitHub issues, not inline comments — a real, positive process signal, not
an absence of debt).

**Real, load-bearing debt already identified by the team itself** (not new findings, cited here
because a completeness audit must weigh them): the AP case-status enum's derived sets are
recomputed independently in 3-4 frontend files (#672), and status-transition legality has no DB
constraint (#671). Both are the kind of "duplicated business logic, no compiler help" pattern that
gets more expensive the more the status machine grows — worth fixing before, not after, a second
discipline adopts the same case-spine pattern AP established.

**The synoptic/template architecture can evolve into the broader vision.** ADR-0050 already frames
synoptic protocols as "generic, versioned data... not per-organ bespoke code" — this is the right
foundation, and this audit found nothing suggesting a rewrite is needed. The gaps (repeating groups,
concept-block reuse, unit precision) are additive extensions to an already-correct model, not
evidence the model itself is wrong.

**No evidence of over-engineering found.** If anything, several areas (billing, AI, DR) are
deliberately *under*-built relative to their milestone names — but each is under-built by an
explicit ADR decision, not by accident, which is the opposite of a maturity red flag.

---

## Documentation Assessment

| Document | Status |
|---|---|
| Root `README.md` | **Insufficient** — three lines, points to `AGENTS.md` and the pilot guide; no quickstart, no architecture summary a first-time visitor could use |
| `AGENTS.md` | **Sufficient, unusually good** — 567 lines of hard-won, specific operational knowledge (exact `gh` CLI gotchas, exact PR-conventions, exact path quirks on this Windows box) |
| Knowledge base (00–55) | **Sufficient, exceptional depth** — but is a *vision* document, not a *current-state* document; a reader would need to cross-reference the actual codebase (as this audit did) to know what's real vs. aspirational |
| ADRs (55) | **Sufficient** — each real, argued, cited by the code that implements it |
| `docs/pilot/PILOT-USER-GUIDE.md` | **Sufficient, exceptional** — genuinely one of the most rigorous "acceptance test manual" documents this auditor has seen, with live-verification dates, corrections-in-place, and honest "not yet verified" flags rather than assumed-passing claims |
| API documentation (OpenAPI) | Exists (`openapi.json`, SDK-generated) — **sufficient for internal consumption**, no evidence of published/external-facing API docs |
| Deployment/operational runbooks | **Partial** — `infra/scripts/README.md` and the staging deploy workflow exist; no equivalent production runbook exists because no production environment exists yet |
| User-facing documentation (for lab staff, not developers) | **Missing** — nothing found beyond the developer-facing pilot guide; a real lab's front-desk/technologist/pathologist staff would need training material this repo doesn't have |

---

## False Completeness Findings

This section is the audit brief's own explicit priority. Ranked by how likely each is to surprise
someone trusting the backlog instead of the code:

1. **"Governed AI" milestone closed; zero live model calls exist anywhere in the codebase.**
   (Detailed in Executive Summary.) Confirmed via direct code read (`stub-provider.ts`,
   `template-provider.ts`) and a repo-wide grep for any LLM vendor SDK — none found.
2. **"Automate" (analyzer integration) milestone mostly closed; no real analyzer has ever produced a
   result.** `FEAT-027: Analyzer #1 driver` remains open — the generic ingestion pipeline is real
   and tested, but every result in this system's entire history was entered manually or via direct
   test API calls, never through an actual instrument protocol.
3. **"Billing & payments (incl. mobile money)" closed; the mobile-money provider is a stub.**
   Disclosed honestly in ADR-0041's own title, but the milestone-level framing ("Commercial
   Readiness: closed") doesn't carry that caveat forward.
4. **AP case report PDF looks template-driven (the numeric side has a real template engine) but is
   actually hard-coded** (#669) — a reader who knows the template engine exists could reasonably
   assume it renders every report; it renders only the numeric/panel side.
5. **"Interoperability & Portals" (HL7/FHIR/patient/clinician portals) closed; zero live-browser
   verification exists anywhere in this repo's own testing history for any of it.** Real, tested at
   the unit/API level — but unlike AP, cytology, billing, and RBAC (all independently re-verified
   live at least once), this audit found no evidence anyone has ever opened `/portal/results` or
   `/clinician` in a real browser against real data, or sent a real HL7 message through the gateway
   end to end.
6. **Case detail patient identity — already found and fixed this week (#800/#802).** Included here
   for completeness of the pattern: this is the clearest possible example of "has a route, has a
   database table, has a UI, was closed via other issues touching the same page — but a core piece
   was silently missing" until a UX-focused pass (not a functional one) caught it. **The fact that
   dozens of functional passes on this exact page never caught it is itself evidence that
   functional/RBAC testing and UX/completeness testing catch genuinely different classes of gap** —
   worth institutionalizing both, not treating either as a substitute for the other.
7. **Currency is a free-text field with a `<datalist>` hint, not a validated enum** — "Organization
   settings: closed" doesn't convey that typing `banana` as a currency code succeeds silently.

---

## Missing Capabilities

Distinguishing **required for current scope** from **valuable future** from **enterprise-can-wait**,
per the brief's own instruction:

**Required before the current AP pilot could be called done, not yet built:**
- A real, tested demo-tenant reset/seed procedure baked into the pilot runbook as a mandatory
  pre-demo step (exists as a manual command today — `pnpm db:reset` — but isn't gated/automated,
  and the shared tenant is measurably getting dirtier session over session, per this week's UX
  audit: 272 → 613 fixture rows in ten days).

**Valuable, near-term, already named in the backlog (not new findings):**
- Additional CAP/ICCR protocols beyond Breast/Colorectal (#551).
- Synoptic repeating groups for multifocal tumors (#666).
- Referring-facility edit/delete.
- Per-facility/payer pricing.
- Invoice refunds/reversals (#489).
- Catalog admin UI price/billing-code fields.

**Valuable, longer-term, correctly not yet built:**
- A real analyzer connection (chemistry/haematology automation only pays off with real instrument
  volume — reasonable to defer until a design partner actually needs it).
- A real payment gateway (same reasoning — cash/manual billing is a legitimate V1 for a pilot).
- SMS notifications (no evidence any current workflow actually needs same-session SMS urgency
  beyond critical-value escalation, which already has its own dedicated, non-SMS mechanism).

**Enterprise-tier, reasonably out of scope for a while:**
- Multi-region/PITR disaster recovery (ADR-0044 already correctly defers this).
- A patient-facing portal beyond the existing basic results view.
- Full HL7/FHIR EHR interoperability certification.
- Real AI model integration (defensible to defer until a design partner explicitly asks for
  AI-assisted drafting and is willing to review its output before it ships as "AI-ready").

---

## Unnecessary/Speculative Work

Genuinely little found — a positive signal given the project's own broad ambition. Two candidates,
neither severe:

1. **The "Governed AI" architecture (provider abstraction, PHI-minimization, eval harness) was built
   before any real model consumer exists.** Defensible as "build the safety rails before the risky
   thing," per the vision's own "AI-ready, not AI-dependent" principle — but it is real effort spent
   on infrastructure for a capability that, per this audit, has zero live usage anywhere yet. Not
   recommending it be removed; flagging that the *next* AI-related work should be "wire in one real
   provider and get one real design-partner sign-off," not "add more providers/capabilities" to an
   already-built abstraction layer with nothing behind it.
2. **Multi-tenancy schema-isolation tiers (ADR-0039/FEAT-045)** exist with no live-verified evidence
   they're exercised by any current tenant. Reasonable to have built once, given multi-tenancy is a
   vision-level "core, not enterprise-tier" principle (KB-00) — but genuinely unverified whether the
   generic RLS-only path (which every live-verified tenant in this audit actually uses) needs this
   heavier mechanism at all yet.

Nothing found that looks like a rewrite-driven-by-taste rather than evidence, and nothing found that
duplicates existing functionality.

---

## P0 — Must Fix

*(For pilot credibility with the current AP-focused design partner. Distinct from this week's UX
audit's own P0/P1/P2, which are already resolved — #800/#802, #803/#804, #805/#806.)*

1. **Demo/pilot-tenant hygiene has no enforced procedure.** The shared tenant is getting
   measurably dirtier every session (272→613 fixture rows in ten days) with no gate preventing a
   real demo from accidentally running against it. Recommend: a pre-flight check in the pilot
   runbook itself (e.g., a script that refuses to proceed if the worklist has >N rows), not just a
   documentation reminder.
2. **Chemistry/haematology end-to-end has never been live-verified the way AP has.** Given this is
   the platform's own "thesis milestone" (M4), this asymmetry is worth closing with one real
   browser pass before any claim that "the whole platform" is pilot-ready, not just its AP slice.

## P1 — Important

1. Real design-partner clinical sign-off on the AI-generated narrative phrasing (#483) and the
   chemistry golden dataset (#171) — both already tracked, both block calling either discipline
   "clinically validated," not just "functionally working."
2. AP case-status transition legality has no DB-level constraint (#671) and its derived sets are
   duplicated across 3-4 frontend files (#672) — real, growing architectural debt on the system's
   most active discipline.
3. Interoperability (HL7/FHIR/portals) has zero live-browser verification anywhere — before this
   milestone is presented as "done" to anyone outside engineering, at least one real end-to-end pass
   (send an HL7 message, view a FHIR Observation, log into the patient portal) should happen.
4. Referring-facility edit/delete does not exist at all — a real operational gap the moment a real
   facility's contact details change.
5. AP case report PDF is hard-coded, not template-driven (#669) — fine today, will become a real
   bottleneck the moment protocol/report variety grows past what one hard-coded renderer can express.

## P2 — Valuable

1. Additional CAP/ICCR protocols beyond Breast/Colorectal.
2. Synoptic repeating-group support (#666).
3. Per-facility/payer pricing.
4. Invoice refunds/reversals (#489).
5. Catalog admin UI price/billing-code/specimen-type/active-flag fields.
6. A queryable, cross-case admin audit-log screen (today's audit trail is per-case only).

## P3 — Future

1. Real analyzer integration (#36).
2. Real payment gateway.
3. SMS notification channel.
4. Real AI model behind the existing governed-inference architecture.
5. Multi-region/PITR disaster recovery.
6. Scanner-integrated WSI ingestion.

---

## GitHub Backlog Assessment

- **280 total issues, 250 closed (89%).** A genuinely healthy ratio for a project at this depth.
- **Every EPIC (2 through 8, plus 13) is kept open indefinitely as a tracking umbrella**, labeled
  `roadmap`, even once every concrete sub-task under it is closed. This is a deliberate, consistent
  pattern (not backlog rot) — but it means "open issue count" is a misleading completeness signal on
  its own; this audit weighted actual sub-issue closure, not epic-open/closed state.
- **M13 (Anatomic Pathology)'s 8 open issues are all EPIC-012 follow-ups** — additional protocols,
  workflow configurability, AI image analysis, cancer-registry submission, an eCC vendor license
  path. All are genuinely next-phase, correctly not yet started, not stale or duplicate.
- **No duplicate issues found** in the areas this audit inspected closely (AP, billing, platform).
- **One issue this audit would recommend re-opening or re-verifying, not closing further:** #660
  (WSI zip path-traversal/size-cap) and #666 (synoptic repeating groups) were both closed with
  language in their own titles suggesting acknowledgment rather than resolution — recommend a
  direct code check before treating either as done. **Not independently re-verified in this pass**
  (time-boxed); flagging for a follow-up, not asserting they're wrong.
- **No new GitHub issues filed by this audit** — every gap found either (a) is already tracked
  under an existing issue/epic, (b) requires a product decision (below, not filed as an
  implementation issue per the brief's own instruction), or (c) is the kind of broad
  process/evidentiary gap (e.g., "chemistry has no live e2e trace") that's better captured in this
  document than as a single actionable issue.

---

## DECISIONS REQUIRED FROM MATHEW

### Decision 1 — Should the chemistry/haematology clinical loop get a dedicated live end-to-end verification pass before this platform is described as "pilot-ready" beyond AP specifically?

**Proposal:** Run one real browser pass — register a patient, book a CBC + chemistry panel, receive
the specimen, enter results, trigger QC/critical-value paths, verify, generate a report — mirroring
the rigor `PILOT-USER-GUIDE.md` already gave the AP track.
**Why:** This is the platform's own foundational "thesis milestone," and it currently has *less*
live-verification evidence than the newer AP track, which is backwards for a claim about overall
platform maturity.
**Alternatives:** Accept the existing API/unit-test coverage as sufficient, given this discipline is
older and has had more total engineering time even without a recent live pass.
**Impact:** Affects how confidently "pilot-ready" can be claimed for any design partner whose
primary discipline is chemistry/haematology rather than AP.
**Recommendation:** Do the pass — it's a few hours of work against a system that almost certainly
already works, and closes a real evidentiary gap cheaply.
**Status:** WAITING FOR MATHEW

### Decision 2 — Is "Governed AI" ready to be marketed/discussed with a design partner as a real capability, or should it stay internal until a real model is wired in?

**Proposal:** Do not present AI narrative drafting as a live capability to any external party until
at least one real model call exists behind it and one design partner has reviewed real output
(closing #483 for real, not just architecturally).
**Why:** Today, every "AI" output is either a stub string or a hard-coded phrase table — presenting
this externally as "AI-ready" without that caveat risks a credibility problem the moment someone
asks to see it draft something novel.
**Alternatives:** (a) Wire in one real, cheap model now, even before a design partner explicitly
asks, to remove the gap proactively. (b) Leave the milestone framed as internal architecture only
and simply don't discuss "AI" externally yet.
**Impact:** Affects sales/pilot narrative, and how much near-term engineering time goes toward a
real model integration vs. other P1/P2 items.
**Recommendation:** Option (b) short-term (cheapest, lowest-risk), revisit (a) only once a specific
design partner asks for it.
**Status:** WAITING FOR MATHEW

### Decision 3 — Should the demo/pilot tenant get an automated pre-flight hygiene check, or is a documented manual `pnpm db:reset` step sufficient?

**Proposal:** Add a lightweight script (`scripts/check-pilot-tenant-clean.sh` or similar) that fails
loudly if the seeded tenant's worklist exceeds a threshold, run manually before any real demo.
**Why:** The manual-reminder approach has already failed once in practice (this week's audit found
613 fixture rows despite the existing documented warning from ten days earlier).
**Alternatives:** Keep it as a documentation-only reminder; accept the operational risk as
acceptably low given it's caught by a human check each time so far.
**Impact:** Small engineering cost; meaningfully reduces the risk of an embarrassing first
impression during an actual design-partner demo.
**Recommendation:** Build the check — it's cheap and the failure mode it prevents is expensive
(a design partner's very first screen full of test fixtures).
**Status:** WAITING FOR MATHEW

### Decision 4 — Interoperability (HL7/FHIR/portals): worth a live-verification investment now, or defer until a real EHR/referring-system integration is actually requested?

**Proposal:** Defer further HL7/FHIR investment (beyond what's already built and unit-tested) until
a specific integration partner is identified; do not spend P1-tier effort proving it live absent a
real consumer.
**Why:** Unlike AP/billing/platform, nothing in this audit found evidence any current design partner
or pilot plan actually needs interoperability yet — building live-verification rigor for a capability
with no current consumer is exactly the kind of premature investment the brief warns against.
**Alternatives:** Do the live-verification pass anyway, purely to convert "closed, untested live"
into "closed, proven," independent of near-term need.
**Impact:** Engineering time allocation between this and the P0/P1 items above.
**Recommendation:** Defer, but downgrade this milestone's *external* framing from "done" to
"built, not yet field-proven" until a real integration exists.
**Status:** WAITING FOR MATHEW

### Decisions already surfaced and tracked in the existing backlog (not new — listed here for completeness of this audit's own decision inventory, not requiring separate resolution beyond what's already tracked)

- Additional CAP/ICCR synoptic protocols beyond Breast/Colorectal v1 (#551).
- Two-tier cytology workflow configurability per case category (#552).
- Additional structured cytology systems beyond cervical Bethesda (#550).
- CAP eCC vendor license path for SDC-XML import (#548).
- Automated cancer-registry submission from synoptic atoms (#547).
- AI-assisted image analysis for synoptic pre-fill (#546).
- Cytology-histology correlation analytics (#554).
- Synoptic protocol update/reconciliation process for ICCR revisions (#553).
- Additional culture specimen types beyond urine (#507).
- Selective/cascade antibiotic-reporting policy (#506).
- MALDI-TOF/molecular organism ID integration (#509).
- Expert-system intrinsic-resistance/MDR flagging (#510).
- Reference-range derivation from real population data vs. literature values (#519).
- CDC-to-warehouse analytics pipeline (#520).
- Outstanding balances and refunds policy (#489).

**No unresolved product decisions were invented by this audit beyond Decisions 1-4 above** — every
other open question this audit encountered was already correctly captured as a tracked, undecided
backlog item by the team itself, which is itself a positive maturity signal.

---

## Recommended Implementation Sequence

1. **Decision 3's hygiene check** (cheap, prevents an embarrassing demo) — do this regardless of
   which other decisions land.
2. **P0 #2: chemistry/haematology live end-to-end pass** — cheap, closes the platform's biggest
   evidentiary asymmetry, likely surfaces zero real bugs (this is a "prove it," not "fix it," step).
3. **P1 #1: clinical sign-offs (#171, #483)** — these are design-partner/clinical-reviewer work
   items, not engineering ones; start them now since they're on someone else's calendar, not
   blocked by any other item here.
4. **P1 #2: AP case-status architecture cleanup (#671/#672)** — do this before, not after, a second
   discipline reuses the case-spine pattern; the cost of fixing it only grows.
5. **P1 #4: referring-facility edit/delete** — small, real, operational gap.
6. **P2 items**, roughly in the order already reflected in the M13 EPIC-012 follow-up backlog —
   the team's own prioritization there looked sound on inspection, no reordering recommended.
7. **P3 items** — genuinely fine to defer until a specific external trigger (a design partner asking
   for AI, a real analyzer becoming available, a real payment need) makes each one concrete rather
   than speculative.

---

## Final Verdict

**1. How complete is the project today?**
~58% against the full multi-discipline vision the knowledge base describes; ~85% against the actual
AP-pilot target the last several months of work have been driving toward; ~66% on this audit's own
weighted capability-matrix methodology. All three are honest answers to different questions — see
Scoring Methodology.

**2. What can the system genuinely do today?**
Run a real, structured-data-first anatomic pathology laboratory pilot end to end: register a
patient, book a facility- or cash-billed order, accession a specimen into a case, build out its
part/block/slide hierarchy, enter gross/microscopic/diagnosis narrative, record a real ICCR-sourced
synoptic protocol for breast or colorectal specimens (with conditional fields, requirement tiers,
and linked biomarker panels), upload and view a whole-slide image, have a pathologist sign it out
with a real step-up-authenticated digital signature, generate and email a correctly formatted PDF
report, generate and collect payment on an invoice, and audit every one of those actions with full
provenance — all under real Keycloak authentication, real Postgres row-level tenant isolation, and
a real capability-based RBAC system independently verified to deny what it should deny. Cytology
(cervical/Bethesda) works the same way through its own two-tier screen→review→sign-out path.
Underneath all of that, real chemistry/haematology/microbiology catalogs, QC engines, and a generic
workflow/reflex engine exist and are unit/API-tested, even though this audit didn't find live-browser
proof of the chemistry/haematology loop specifically.

**3. What can it not do?**
Ingest a result from a real laboratory analyzer. Process a real payment through any actual gateway.
Draft a genuinely AI-generated narrative (today's "AI" is a stub or a lookup table). Let staff edit
or delete a referring facility's details once created. Track tissue processing/embedding/sectioning
or a dedicated stains/IHC workflow as first-class operations distinct from a generic "add test"
action. Send or receive a real HL7 message or FHIR resource in anger (built, never field-proven).
Handle more than one synoptic protocol per organ type live in practice, or a multifocal tumor's
repeated findings. Issue a refund. Run in production at all — everything cited in this report ran
against a local dev stack or a single staging droplet.

**4. Is it pilot-ready?**
**YES, WITH CONDITIONS** — for its actual current target (a single AP/histology/cytology design
partner). Conditions: fix the demo-tenant hygiene gap before any real demo; get the two named
clinical sign-offs (#171, #483) in motion if either discipline's automated content will be shown to
the design partner; be explicit that chemistry/haematology hasn't had the same live-verification
rigor as AP if that discipline comes up in the pilot conversation.

**5. Is it production-ready?**
**NO.** No production environment exists (only local dev and one staging droplet). No real payment
gateway, no real analyzer, no real AI model, no live-proven interoperability, and DR is explicitly,
correctly scoped to staging-only single-droplet restore drills, not a production-grade posture.

**6. Top 10 remaining gaps, ranked:**
1. No enforced demo-tenant hygiene (P0).
2. Chemistry/haematology has no live end-to-end proof (P0).
3. "AI" has zero real model behind it (P1/decision).
4. Clinical sign-offs outstanding on both AI phrasing and the chemistry golden dataset (P1).
5. AP case-status architecture debt (#671/#672) growing on the system's most active discipline (P1).
6. Interoperability has zero live-browser proof (P1/decision).
7. Referring-facility edit/delete doesn't exist (P1).
8. AP report PDF hard-coded, not template-driven (P1).
9. No real payment gateway, no refunds (P2/P3).
10. No real analyzer ever connected (P3).

**7. What should NOT be built yet?**
More AI provider infrastructure (the abstraction layer is already built and unused — wire in one
real provider only once a design partner asks, don't expand the framework further first). A second
real payment gateway before the first design partner needs online payment at all. Multi-region/PITR
disaster recovery. Additional synoptic protocols beyond what a real, named design partner's specimen
mix actually requires. Scanner-integrated WSI ingestion absent a real scanner vendor relationship.

**8. What decisions are needed from Mathew?**
The four numbered above (chemistry live-verification investment, AI external-readiness framing,
demo-tenant automated hygiene check, interoperability live-verification timing) — plus the fifteen
already-tracked backlog decisions listed for completeness, which don't need fresh resolution beyond
their existing tracked state.

**9. If nothing happened except implementing the already-approved backlog, how far would that take
the project?**
Materially further on AP specifically (more protocols, repeating groups, workflow configurability)
and on microbiology/analytics (more specimen types, resistance flagging, population-derived ranges)
— but it would **not** close any of this report's P0/P1 items, none of which currently have an
approved implementation plan in `docs/plans/`. The backlog is healthy and well-prioritized for
*deepening what exists*; it does not yet contain the specific fixes this audit is recommending,
because most of them (the chemistry live-verification gap, the AI-framing decision, the demo-hygiene
automation) are evidentiary/process findings this audit itself surfaced, not previously-filed issues.

**10. Shortest credible path from here to a genuinely usable production LIS:**
- **Stage 1 (weeks):** Close this report's P0s and P1s above. Get the two clinical sign-offs moving
  in parallel (they're not on the engineering critical path). Stand up one real, minimal production
  environment (even single-droplet, matching staging's own honest scoping) — production-readiness
  cannot be claimed while zero production environments exist, regardless of code quality.
- **Stage 2 (1-2 months):** Whichever of Decisions 1/2/4 get approved, execute them. Close the P2
  backlog items already well-prioritized in EPIC-012's own follow-ups. If a second design-partner
  discipline (chemistry/haematology, or microbiology) becomes real, give it the same live-
  verification rigor AP already has — don't let "closed at the API layer" stand in for "proven,"
  the way this audit found it currently does for interop and (partially) for the base clinical loop.
- **Stage 3 (ongoing, trigger-driven, not calendar-driven):** Real analyzer integration, real
  payment gateway, real AI model — each only once a specific real-world trigger (a design partner's
  actual instrument, actual payment need, actual request for AI drafting) makes the investment
  concrete rather than speculative, consistent with this project's own demonstrated (and correct)
  discipline of not building ahead of real evidence.
