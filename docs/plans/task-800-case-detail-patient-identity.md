# Implementation Proposal: Case detail page shows patient identity + order link
Status: APPROVED
ADR: n/a    Date: 2026-09-05    Backlog ID: issue #800

## 1. Goal

`/cases/[caseId]` (`apps/web/app/(app)/cases/[caseId]/page.tsx`) currently renders only the bare
accession number and status badge — no patient name, MRN, or order context anywhere on the page,
and no link back to the order or patient chart (issue #800, filed from the 2026-09-05 UX audit,
`docs/ux-responsiveness-audit-2026-09-05.md` §5). Add a header line identifying the patient (name +
MRN) and a link back to the source order, matching the existing, working convention already used on
`/orders/[id]` (`order.patient.firstName`/`lastName`/`mrn` shown as `CardTitle`/subtitle).

## 2. Affected files

- `apps/web/app/(app)/cases/[caseId]/page.tsx` — the only file touched. No API/DTO changes: `GET
  /v1/cases/{id}` already returns `orderId` (the page already uses `caseData.orderId` in its
  existing `isAmendable`-gated fetch), and `GET /v1/orders/{id}` already returns an embedded
  `patient: { firstName, lastName, mrn }` summary (`order.controller.ts`'s `patientSummary`,
  confirmed the exact shape `/orders/[id]/page.tsx` already renders as its own header).

## 3. Architecture consulted

- `apps/web/app/(app)/orders/[id]/page.tsx` — the precedent this proposal copies exactly (`CardTitle`
  = patient name, MRN subtitle line, both conditional on `order.patient` existing).
- `apps/api/src/order/order.controller.ts` (`patientSummary`, line ~61/76) — confirms `order.patient`
  only ever carries `firstName`/`lastName`/`mrn`, never DOB/sex. `KB`/ADR search found nothing specific
  to case-detail identity display; no existing ADR governs this screen's header shape beyond the
  order-detail precedent itself.

## 4. Skills loaded

- `engineering/frontend-design` (required — this is an `apps/web` page edit). Entry #12 (thrown
  Server Component errors get their message redacted in production) is already correctly handled by
  this file's existing 403/404/generic-error branches, which this change doesn't touch. No other
  entry applies: no new route, no new dynamic segment, no new client-only library, no new
  `useActionState` form.
- `engineering/api-design` — not loaded; no `apps/api` route is added or changed (see §2).

## 5. Assumptions & autonomous decisions

- **Header shows name + MRN only, not DOB/sex.** Issue #800's own recommended fix mentions "DOB/sex"
  as an option, but the *only* patient data `/v1/orders/{id}` already returns is
  `firstName`/`lastName`/`mrn` — the exact same subset `/orders/[id]` itself displays. Matching that
  established convention (name + MRN) rather than adding a second API call (`/v1/patients/{id}`,
  which the isAmendable branch already fetches but only for its own quick-fill email, then discards)
  keeps this change to the smallest version that actually fixes the identity gap, consistent with the
  one screen in this app that already solved this exact problem. If DOB/sex on this screen is wanted
  later, that's a separate, larger follow-up (needs its own `/v1/patients/{id}` fetch, unconditionally
  — today it's isAmendable-gated) — flagging as a question below rather than assuming it's in scope.
- **The existing `isAmendable`-gated order/patient fetch is replaced, not duplicated.** Today the page
  fetches `order`+`patient`+`facility` only when `isAmendable`, solely to prefill
  `SendReportEmailForm`'s quick-fill buttons. This proposal makes that same order fetch run
  unconditionally (every case has an `orderId`), and reuses its already-embedded `order.patient` for
  the new header — no second `/v1/patients/{id}` call for the header itself. The existing
  `client.GET('/v1/patients/{id}', ...)` and referring-facility calls stay, still isAmendable-gated,
  since they're only needed for the email quick-fill feature, not the header.
- **"View order" link only** — not a "View patient" link. `/v1/orders/{id}`'s embedded `patient`
  summary has no `id` field (confirmed: `patientSummary` type above is `firstName`/`lastName`/`mrn`
  only, no `id`), so linking directly to `/patients/[id]` from this page would need yet another field
  added to the order API response. `/orders/[id]` itself is one click from the patient (it's the
  order screen, patient-order relationship is the whole point), so "View order" alone closes the
  workflow dead end issue #800 named without widening scope into an API change.
- Header is added to the existing top `Card`/`CardHeader`/`CardTitle` (currently just accession
  number + status badge) — restructured to match `/orders/[id]`'s `flex flex-row items-start
  justify-between` shape (title/subtitle on the left, badges/actions on the right), not a new card.

## 6. Risks

- If `GET /v1/orders/{id}` 403s or 404s for the current user/case (shouldn't happen in practice — a
  user who can already see the case via `GET /v1/cases/{id}` has already passed that case's own
  tenant/role checks, and every case has exactly one order per the `ux_case_tenant_order` constraint
  the guide's own §9.1 documents) — handled defensively by simply omitting the header's patient
  line/link when the order fetch doesn't come back `ok`, same pattern this file already uses for its
  own `catalogResponse.ok` check, rather than failing the whole page.
- Low risk overall: additive header content only, no change to any existing card, form, or action
  below it.

## 7. Acceptance criteria

- Opening any case at `/cases/[caseId]` shows the patient's full name and MRN in the page header,
  and a "View order" link/button that navigates to `/orders/[orderId]`.
- No change to any other card (Parts/Blocks/Slides tree, Narrative, Screen, Sign out, Report
  versions, Audit trail) — their existing role gates and content stay exactly as-is.
- Existing `isAmendable` email quick-fill behavior (`patientEmail`/`facilityEmail`) is unchanged.

## 8. Testing plan

- `pnpm --filter web typecheck` — the API client's generated types must already have `order.patient`
  on the `/v1/orders/{id}` response shape (used elsewhere already); confirms no type drift.
- Manual `web-verify` pass: open a real case (e.g. one of the `signed_out` cases used in the
  2026-09-05 audit) as `test-user-11` or `test-user-4`, confirm the header now shows patient name +
  MRN + a working "View order" link, and that every other card on the page still renders unchanged.
- Re-check the specific case from the audit report (`260905-000431`) if it's still present in the
  local dev DB, to directly close the loop on the exact evidence issue #800 cited.

## 9. Rollback plan

Single-file, additive change — revert the one commit if anything regresses. No migration, no data
change, no other file touched.

## 10. Questions requiring human approval

1. ~~Name + MRN only, no DOB/sex, no direct "View patient" link~~ — **Approved 2026-09-05**: scoped
   as proposed (name + MRN + order link only, no API changes).
2. "View order" link/button placement (right side, next to the status badge, matching `/orders/[id]`'s
   own right-aligned action-button convention) — proceeding as proposed, no objection raised.
