# Phase 0 decision doc: role model, billing cadence, fee schedule, delivery
Status: DRAFT — needs design-partner + internal sign-off, not an Implementation Proposal
Tracks: #698 (part of EPIC #697, Pilot Readiness)

This is not code and not an Implementation Proposal — it's the artifact #698 asks
for: a written decision on the four questions everything in Phase 1–2 depends
on. Each question below has the evidence that grounds it (from the live
pilot-readiness audit) and a recommended default, so the design-partner
conversation can confirm/adjust rather than start from a blank page. Once each
question has a real answer, update this file's own "Decision" line and flip
its Status to APPROVED — #701 (role model), #702 (org-owner grant), #703
(user management), #704 (facility billing), #705 (procedure codes), and #711
(delivery) all cite this doc directly.

## 1. Role structure

**Current state (confirmed via code + live test):** Keycloak realm roles are
`technologist`, `verifier`, `qa`, `clinician`, `patient`, plus three
machine/service roles. `apps/api/src/auth/capabilities.ts`'s own comments
admit this repeatedly: *"no dedicated registrar/front-desk role exists in
Keycloak yet,"* *"no dedicated reception/accessioning role,"* *"no dedicated
cashier role."* There is no `pathologist` role (AP sign-out rides on the
generic `verify` capability) and no lab-director/admin role. The org-signup
owner today lands on `qa` — the role with the least day-to-day lab capability
of any of them.

**Question for the design partner:** what does your actual staffing look like
day to day?
- Is reception/accessioning a distinct person from the technologist doing
  bench work, or the same person?
- Is "pathologist" (sign-out authority) a distinct login from a general
  "verifier," or does one person hold both?
- Do you have a dedicated cashier/billing person, or does whoever's at the
  desk take payment?
- Who should hold the "lab admin" capabilities (org settings, user
  management, catalog/workflow authoring) — is that you personally, a
  designated deputy, or does that never leave the vendor side during pilot?

**Recommended default**, if the design partner has no strong preference:
five roles — `reception` (patients/orders/specimens/billing, no result entry),
`technologist` (unchanged — result entry + specimen management), `pathologist`
(new — the `verify` capability, AP sign-out, distinct from generic `verifier`
so a future cytology two-tier workflow can gate on it specifically),
`cashier` (billing only, no clinical capabilities), `lab_admin` (org
settings, user management, catalog/workflow/report-template authoring — what
`qa` currently does, plus user management). Keep `qa` itself for its existing
QC-resolution meaning rather than overloading it further.

**Decision:** _(pending)_

## 2. Billing cadence

**Current state:** no facility-billing UI exists in any form (blocked by
#699's crash and simply never built). Nothing to confirm cadence against yet
— this is a pure design question.

**Question for the design partner:** confirm the exact shape of "one invoice
per facility." Strictly calendar-month (1st–last day)? An arbitrary
user-chosen date range at invoice-generation time? Both, with calendar-month
as a one-click default and a custom range as an override?

**Recommended default:** support an arbitrary date range at generation time
(strictly more general, and calendar-month is just a common special case of
it) — building calendar-month-only first and generalizing later is the kind
of two-implementations risk this repo's own rule-of-engagement discipline
flags.

**Decision:** _(pending)_

## 3. Procedure / fee schedule

**Current state:** the test catalog has zero anatomic-pathology procedure
codes — confirmed by filtering for "biopsy"/"pathology"/"surgical"/
"histology" and finding nothing; the full catalog is chemistry/hematology/
microbiology plus synthetic test fixtures. A real invoice generated during
the audit billed the literal placeholder string `CBC-PLACEHOLDER`.

**Question for the design partner:** what real AP CPT/local billing codes
should seed the catalog? Do they have their own existing fee schedule to
import (spreadsheet, prior system export, payer contract), or should this
build from CAP-standard procedure codes as a starting point?

**Recommended default:** ask for their existing fee schedule first (highest
fidelity, least rework); fall back to a CAP-standard starter set
(surgical pathology levels I–VI, common special stains, a starter IHC panel
list) only if they don't have one readily exportable, with the explicit
understanding that real codes replace it before go-live, not after.

**Decision:** _(pending)_

## 4. Delivery expectations

**Current state:** no send-to-facility or send-to-patient action exists
anywhere in the report or invoice views — print/PDF-download only.

**Question for the design partner:** for a signed-out report, is email/portal
delivery to the referring facility a pilot requirement, or is printed/PDF
handoff acceptable for phase one? Same question for invoices.

**Recommended default:** printed/PDF handoff is acceptable for the pilot's
first weeks (it's what's already reliable and tested); scope email delivery
as Phase 3 (#711) rather than blocking Phase 1–2 on it, unless the design
partner states it's a hard requirement from day one.

**Decision:** _(pending)_

## Exit criteria (from #698)

A written role model and a written facility-billing spec both exist and are
approved by the design partner and internal stakeholders — i.e., every
"Decision: _(pending)_" line above has a real answer, and #701/#702/#703's
own Implementation Proposals can cite this file directly instead of
re-litigating these questions.
