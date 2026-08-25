# Implementation Proposal: Patient demographic editing

Status: APPROVED
Tracks: #747 (pilot-readiness audit follow-up, part of #697)

**Approved 2026-08-25** via the native options-prompt (accepted as drafted — all
3 §10 open questions accepted at their recommended defaults: yes to writing a
`patient.update` audit event, no reason-required field, no field-level locking
for this first pass).

## Problem

Confirmed by code, not just UI absence: there is no `PUT`/`PATCH` endpoint for
a patient record anywhere in `apps/api/src/patient/patient.controller.ts`,
and `apps/web`'s own `patients/[id]/page.tsx` carries an explicit comment
stating this is deliberate-for-now ("no inline-editable demographics ... in
the current roadmap"). A receptionist who mistypes a name, DOB, phone
number, or sex at registration has no way to correct it through the UI —
confirmed live during the pilot-readiness audit as a real, near-certain
first-week pilot need.

## Proposed shape

- `PUT /v1/patients/:id`, `manage_patients`-gated (the same capability
  `POST /v1/patients` already uses) — mirrors this repo's own existing
  `PUT /v1/org-settings` partial-update convention: every field
  `!== undefined ? body.x : existing.x`, so an omitted key never clobbers a
  value the caller didn't mean to touch.
- Editable: `firstName`, `middleName`, `lastName`, `sex`, `birthDate`,
  `nationalId`, `phone`, `email`, `address`, next-of-kin fields — the same
  field set `POST /v1/patients` already accepts.
- Not editable: `mrn` (system-issued at registration, per `patient.ts`'s own
  schema comment) and `tenantId`.
- `apps/web`: an "Edit" action on `patients/[id]/page.tsx`, reusing the
  existing registration form's component and validation (`patients/new`)
  rather than a second, parallel form.

## Open questions (§10 — needs a real decision before implementation)

1. **Should an edit write an `audit_event`?** Recommended: yes, action
   `patient.update`, matching every other mutating action in this codebase
   (Constitution Law #5: "every clinically significant action writes an
   audit record"). Patient demographics aren't a clinical *value*
   (Law #1 doesn't apply — this isn't an Observation), but identity data is
   still clinically significant; a wrong-patient report is a real safety
   category, not a cosmetic one.
2. **Does an edit need a reason, the way a case narrative amendment does?**
   Recommended: no — this repo's own precedent (`case.amend` requiring a
   `reason`) is reserved for *signed/attested* clinical content being
   corrected after the fact; a pre-sign-out demographic typo fix is a
   different, lower-stakes class of correction. Revisit only if a design
   partner specifically asks for it.
3. **Is there any field-level restriction once a patient has an active
   order/case** (e.g. should `sex`/`birthDate` be lockable once a signed
   report references them)? Recommended: no restriction for this first
   pass — a design-partner pilot needs the basic correction path to exist
   at all before a more surgical restriction is worth building; flag as a
   real follow-up if it comes up in practice, not a blocking question now.

## Explicitly out of scope

Patient merge/duplicate-resolution tooling — a different, larger feature
(no evidence during the audit that duplicate patients are a live problem;
building it now would be exactly the kind of speculative scope this pilot
prep pass was told to avoid).

## Acceptance criteria

- A receptionist can correct a patient's name/DOB/phone/email/address/sex
  through the UI without developer/database intervention.
- The correction is visible immediately on the patient detail page and in
  search results.
- MRN is not editable through this path.
- Each open question above has a real "Decision:" line filled in before
  code is written, matching this repo's own `phase-0-pilot-decisions.md`
  convention.
