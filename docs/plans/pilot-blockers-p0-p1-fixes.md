# Implementation Proposal: Pilot-readiness P0/P1 blocker fixes

Status: APPROVED — human gave explicit, fully-specified direction for all four
items in the pilot-readiness follow-up request (this session, 2026-08-24),
including exact scope boundaries ("smallest correct change", "mirror the
existing pattern", "preserve backend behavior unless a backend invariant is
genuinely required", "do not invent a new RBAC architecture"). No load-bearing
decision is missing for any of the four items below; proceeding directly per
Rule #0's normal proposal-then-approve flow, approval already given in the
same message that requested the work.

Source: independent pilot-readiness audit this session (Artifact
`47e25d82-75e6-419e-b393-5d998adb22d1`), four P0/P1 findings.

## 1. AP signed report must identify the patient

**Current state:** `apps/api/src/case/case-report-content-assembler.ts` and
`case-report-render.ts` never reference `patient` at all — confirmed by grep.
The sibling per-ordered-test report generator, `apps/api/src/report/
report-render.ts:208`, already does this correctly: `Patient: ${patient.name}
MRN: ${patient.mrn} DOB: ${patient.dateOfBirth}...`. The case's own order
already links to a patient (`order.patientId`); the case-report path simply
never joins to it.

**Fix:** extend `case-report-content-assembler.ts`'s `includedContent` shape
with a `patient` block (name, MRN, DOB, sex) plus referring facility name /
requesting doctor where present on the order, resolved the same way
`report-assembly.ts` already resolves them for the per-test path. Render it
in `case-report-render.ts` mirroring `report-render.ts`'s own layout. Update
the send-email subject line (`case.controller.ts`'s `send-email` handler,
currently `Pathology report — case {accession}`) to include the patient name.
No new report engine, no template system change — reuse the existing PDF
renderer's primitives.

**Scope boundary:** content-assembly and render only. Do not touch the
signature/hash mechanism — `contentHash`/`signature` already cover whatever
`includedContent` contains, so adding fields to `includedContent` is safe and
additive, consistent with how narrative/synoptic content was added before.

## 2. Prevent duplicate invoice generation

**Current state:** `POST /v1/orders/:id/invoice` (or equivalent) has no
existing-invoice check — confirmed live: two full invoices were created for
one order via two clicks. The order detail page's "Generate invoice" button
gives no success feedback and doesn't know an invoice already exists.

**Fix, backend:** the generate-invoice endpoint should check for an existing
invoice on the order first and return the existing one (idempotent) rather
than creating a second — this is the "preserve existing behavior unless a
backend invariant is genuinely required" case: an order should have at most
one invoice, which is a real, reasonable invariant given the current 1:1
order→invoice shape this repo already assumes elsewhere (facility statements,
invoice list). **Fix, frontend:** the order detail page should show a link to
the existing invoice once one exists, replacing the "Generate invoice"
button, and show real confirmation on first generation (matching the
"Patient registered" / "Order placed" confirmation-panel pattern already used
elsewhere on this exact page).

**Scope boundary:** one order → at most one invoice. Not building
multi-invoice-per-order support, credit notes, or void/cancel — out of scope,
not needed to fix the bug.

## 3. Correct the lab_admin capability model

**Current state:** `apps/api/src/auth/capabilities.ts:193` —
`lab_admin: ['manage_org_settings', 'manage_users']`. The recorded design
decision (`docs/plans/phase-0-pilot-decisions.md` §1, decision on #698) states
lab_admin should carry "what `qa` currently does, plus user management" —
`qa` carries `manage_workflow`, `manage_report_templates`, `manage_catalog`,
`view_operational_reports`, `resolve_qc`, `manage_org_settings`. Confirmed
live: lab_admin gets 403/500 on billing, catalog, and referring-facility
management.

**Fix:** add `manage_catalog`, `manage_billing`, and `manage_patients` (the
capability referring-facility CRUD is actually gated on, per
`referring-facility.controller.ts`) to `lab_admin`'s grant list. Leaving
`resolve_qc`/`view_operational_reports` off lab_admin, since the decision
text says "plus user management" on top of qa's *administrative* surface, not
its QC-resolution one — `qa` itself is kept for that meaning per the same
decision doc. This is the smallest change that satisfies "the org owner can
actually run the lab" without collapsing `qa` and `lab_admin` into the same
role.

**Scope boundary:** capability-grant list change only. No new capability
names, no new roles, no Keycloak realm change.

## 4. Fix fresh-organization identity

**Current state:** `tenant.name` defaults to `Tenant {tenantId}` — confirmed
live (org settings shows "Tenant 00000000-0000-0000-0000-000000000001" as
the pre-filled, saved value, not just a placeholder). This same string
renders in the top-bar org badge on every screen.

**Fix:** check the onboarding/signup flow (`apps/api/src/onboarding/`) for
where `tenant.name` is actually set today. If self-signup already collects an
org name and this is a seed-data-only artifact (the dev tenant was never
onboarded through the real signup flow), no code change is needed there —
only confirm the real signup flow requires a name. Separately, harden the
display layer: the org-settings form's "Organization name" field is already
marked required (`*`) but the *existing* placeholder-shaped value bypasses
that required-ness since it's pre-filled. Add a light validation/warning
treatment so a `Tenant {uuid}`-shaped name is visibly flagged as unset in
both the settings form and — if feasible without a new tenant-name-resolution
service — the header badge.

**Scope boundary:** display/validation polish, not a new onboarding flow
(explicitly out of scope per the human's own request — "determine whether
this is already supported before changing the flow").

## Testing

Each item gets its existing e2e-spec file extended (or a new one, matching
existing per-feature file conventions) rather than a new test framework.
Full `apps/api` e2e suite run against a fresh `db-reset.sh` before merge, per
this repo's own standing discipline.

## PRs

Four independent PRs, one per item, each mergeable and revertable on its own
— matching the audit report's own "each is independently shippable" note.
