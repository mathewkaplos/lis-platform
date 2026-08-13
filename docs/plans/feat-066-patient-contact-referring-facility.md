# Implementation Proposal: FEAT-066 — Patient contact fields + referring-facility/payer model
Status: IMPLEMENTED (PR #578, merge commit 26d8e531954ccc0e61757bd3fb5dc12a9479594a)
ADR: ADR-0053 (status: accepted 2026-08-13)
Date: 2026-08-13    Backlog ID: #577 (FEAT-066, milestone M3, no epic — real design-partner field-set blend)

## 1. Goal

Blend the KB-02-minimal patient/order/billing core with the real field set observed in Eldoret
Pathology Diagnostics' production system (4 screenshots supplied directly by the user, 2026-08-13,
`/mnt/d/LIS/research/ref/*.png`) — the first real design-partner evidence this project has had for
the wider field set `patient-identity` Skill entry #8 previously called "illustrative, not a spec."
This closes three explicitly-named, previously-deferred gaps:

- `patient-identity` Skill entry #8 (contact/next-of-kin fields, pending real evidence).
- `order.ts`'s own header comment ("ordering-provider reference... no consuming code or a catalog
  table yet," FEAT-006 proposal §5/§10 Q3).
- ADR-0041's own Consequences section ("multi-payer (insurance) support... real, tracked gap...
  follow-up issues filed alongside this one").

## 2. Affected files

- `packages/db/src/schema/patient.ts` — additive nullable columns: `phone`, `email`, `address`,
  `nextOfKinName`, `nextOfKinPhone` (all `text`, nullable — matches `birthDate`'s own "null = unknown,
  never a sentinel" convention; none of these are required by any existing invariant, so none
  becomes `NOT NULL`).
- `packages/db/src/schema/referring-facility.ts` (new) — `referring_facility` table: `id`,
  `tenantId`, `name` (`NOT NULL`), `phone`, `email`, `address` (all nullable). Tenant-scoped
  operational data (RLS), per ADR-0053 — each tenant has its own real partner facilities, not global
  reference data like `test_definition`.
- `packages/db/src/schema/order.ts` — two additive nullable columns: `referringFacilityId` (FK →
  `referring_facility.id`) and `orderingProviderName` (`text`, free text — matches the real system's
  own plain-text "Requesting Doctor" field, per ADR-0053's rejection of a structured
  `care_relationship`-style account for this).
- `packages/db/src/schema/billing.ts` — `invoice` gains `payerType` (`text NOT NULL DEFAULT 'cash'`,
  `CHECK IN ('cash','corporate')`) and `referringFacilityId` (nullable FK → `referring_facility.id`,
  application-layer-enforced non-null only when `payerType = 'corporate'`, not a DB-level dependency
  between the two columns — matches `invoice.status`'s own plain-CHECK, no-cross-column-constraint
  precedent).
- `db/migrations/00XX_patient_contact_referring_facility.sql` (generated + hand-verified) — purely
  additive: 1 new table, 7 new nullable/defaulted columns, indexes, 2 new CHECKs. No existing column
  altered.
- `packages/domain/src/patient.ts` — `patientSchema` gains `phone`, `email`, `address`,
  `nextOfKinName`, `nextOfKinPhone`, each `z.string().nullable()`.
- `packages/domain/src/referring-facility.ts` (new) — `referringFacilitySchema` mirroring the table
  1:1; `referringFacilityCreateRequestSchema` (`name` required, rest optional).
- `packages/domain/src/order.ts` — `orderSchema`/create-request schema gain
  `referringFacilityId: z.uuid().nullable()` and `orderingProviderName: z.string().nullable()`.
- `packages/domain/src/billing.ts` — `invoiceSchema` gains `payerType: z.enum(['cash','corporate'])`
  and `referringFacilityId: z.uuid().nullable()`.
- `apps/api/src/patient/patient.controller.ts` — `create()`/`update()` accept the 5 new nullable
  contact fields, no new endpoint (matches `mergedInto`'s own precedent of extending the existing
  response shape rather than adding a parallel route).
- `apps/api/src/referring-facility/` (new module) — `referring-facility.controller.ts`:
  `POST /v1/referring-facilities` (create), `GET /v1/referring-facilities` (list, tenant-scoped,
  paginated — matches `test-catalog.controller.ts`'s own list-endpoint shape), `GET
  /v1/referring-facilities/:id`. `manage_patients` capability reused (same capability already gates
  patient create/update/merge — a referring-facility directory is patient-registration-adjacent
  admin data, not a distinct capability domain).
- `apps/api/src/order/order.controller.ts` — order-create request accepts the 2 new optional fields,
  validated: `referringFacilityId`, if present, must resolve to a real row in the same tenant (404 if
  not — same pattern `testDefinitionId` validation already uses).
- `apps/api/src/billing/billing.controller.ts` — invoice-generation accepts an optional `payerType`/
  `referringFacilityId` pair on the request; defaults to `payerType: 'cash'` when omitted (matches
  today's implicit behavior exactly, so no existing caller breaks). Rejects 400 if `payerType =
  'corporate'` and `referringFacilityId` is absent, or if `referringFacilityId` doesn't resolve to a
  real row in the same tenant.
- `apps/web/app/(app)/patients/[id]/page.tsx` and the patient create/edit form — 5 new optional
  fields added to the existing form, no new page.
- `apps/web/app/(app)/referring-facilities/` (new, minimal) — a plain list + create form, mirroring
  `test-catalog`'s own admin-list UI pattern. No edit/delete UI beyond what's needed to prove the
  create → list → select-on-order-form path end-to-end (same "no new UI without a named requirement"
  discipline FEAT-063/064/065 already established).
- `apps/web` order-create form — adds an optional referring-facility selector (populated from the
  new list endpoint) and a free-text requesting-doctor field.
- `apps/api/openapi.json` / `packages/sdk/src/schema.ts` — regenerated (new routes + response-shape
  changes, learned from FEAT-063's CI drift failure to do this proactively).
- `lis-engineering/skills/domain/patient-identity/SKILL.md` — entry #8 updated: contact/next-of-kin
  fields are now built (FEAT-066), citing the real evidence source; blood group/photo/employer remain
  explicitly unbuilt/unconfirmed (no real-system evidence seen for those).
- New Skill entry (or extend `patient-identity`) documenting `referring_facility`'s dual role
  (order-attribution + invoice-payer, per ADR-0053) so a future feature doesn't rebuild a second,
  overlapping payer directory.

## 3. Out of scope (named, not silently dropped)

- Referring-facility self-service portal/login accounts (the real system's own facility-level logins
  visible in `user_list.png`) — a distinct authentication/portal-account feature. Filed as a named
  follow-up on issue #577 if/when a real self-service requirement is confirmed.
- Structured requesting-clinician accounts (`care_relationship`-style) replacing the free-text
  `orderingProviderName` — no evidence the real system links a doctor's identity to anything beyond a
  name string at registration time.
- Blood group, photo, employer patient fields — no real-system evidence seen in the 4 screenshots
  reviewed; `patient-identity` Skill entry #8 keeps these flagged unbuilt/unconfirmed, not silently
  added alongside the fields that do have evidence.
- National-ID column-level encryption — unchanged, still the named-unresolved item in
  `patient-identity` Skill entry #7.
- Any insurance-adjudication record, payer rate/contract table, or running facility account balance
  — `invoice.payerType` + `referringFacilityId` is the entire billing-side surface, per ADR-0053 and
  unchanged from ADR-0041's own thin-edge boundary.
- Pathologist/technologist assignment at registration time (visible in `patient_form.png`) — already
  covered by the existing `assignedUserId`/worklist-assignment mechanism (FEAT-022, ADR-0024) at the
  `ordered_test` level; not re-built at the patient level.

## 4. Verification plan

- New e2e spec `apps/api/test/patient-contact-referring-facility.e2e-spec.ts`:
  1. Patient create/update round-trips all 5 new contact fields.
  2. Referring-facility create + list, tenant-isolated (a second tenant's facilities never appear).
  3. Order create with a valid `referringFacilityId` succeeds; with a cross-tenant or nonexistent id,
     404s.
  4. Invoice generation defaults to `payerType: 'cash'`, `referringFacilityId: null` when omitted
     (existing FEAT-046 invoice tests must keep passing unmodified — this is the regression check
     that the default preserves current behavior exactly).
  5. Invoice generation with `payerType: 'corporate'` and no `referringFacilityId` → 400.
  6. Invoice generation with `payerType: 'corporate'` and a valid `referringFacilityId` → succeeds,
     `referringFacilityId` persisted on the invoice row.
- Re-run full `apps/api` + `apps/web` suites, `rls-check` (fresh `db-reset.sh` immediately before, per
  this session's own established fix for the stale-DB-state collision class of failure).
- Regenerate `openapi.json`/SDK before opening the PR (not after a CI failure), per the FEAT-063
  lesson already applied to FEAT-065.

## 5. Open questions for approval

1. Reuse `manage_patients` capability for the referring-facility module, or a new capability? Default:
   reuse (Recommended) — it's registration-adjacent admin data, and a new capability with no distinct
   consumer yet would be speculative (matches this repo's own "don't build the generic version
   speculatively" discipline).
2. Should `referring_facility` get a soft "inactive" flag now (the real system's `user_form.png`
   shows an `Active` checkbox on facility-shaped accounts), or defer until a real deactivation need is
   observed? Default: defer (Recommended) — no consuming workflow needs it yet; add when one does,
   same as every other "don't build ahead of a real requirement" call this session has made.
