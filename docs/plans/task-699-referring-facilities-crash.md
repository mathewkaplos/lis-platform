# Implementation Proposal: Fix Referring Facilities admin page 500 (Server→Client function props)
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #699 (part of EPIC #697)

## 1. Goal

`/admin/referring-facilities` currently 500s on every load for every role. Root
cause (confirmed live and via dev-server log during the pilot-readiness audit):
`AdminReferringFacilitiesPage` (`apps/web/app/(app)/admin/referring-facilities/page.tsx`)
is a plain Server Component that constructs `DataTable`'s `columns` array
inline — including `cell` render functions — and passes it, plus a `getRowId`
function, straight into `DataTable` (a Client Component). Next.js's RSC
boundary rejects function props crossing Server→Client at request time:

```
Error: Functions cannot be passed directly to Client Components unless you
explicitly expose it by marking it with "use server".
```

This is `engineering/frontend-design` Skill entry #6 by name — the exact
failure mode it documents, caused the same way (TASK-069 hit the identical
error). Goal: fix this one page using the established fix pattern (a thin
`'use client'` wrapper owns the column/getRowId definitions), unblocking:
facility creation via the UI, the order-entry "Referring facility" dropdown
(currently always empty because the facility list can never be populated),
and downstream facility billing (#704).

## 2. Affected files

- **New:** `apps/web/app/(app)/admin/referring-facilities/referring-facilities-table.tsx`
  — new `'use client'` wrapper, mirroring `apps/web/app/(app)/patients/patients-table.tsx`'s
  exact shape (that file is the established, working precedent for this
  identical scenario: a Server Component search/list page + a small client
  table wrapper).
- **Modified:** `apps/web/app/(app)/admin/referring-facilities/page.tsx`
  — remove the inline `DataTable` call and `columns` array; import and render
  the new `ReferringFacilitiesTable` component instead, passing it the fetched
  `facilities` data.

No other files change. `create-referring-facility-form.tsx` is already a
correct `'use client'` component and is untouched.

## 3. Architecture consulted

- `apps/web/app/(app)/patients/patients-table.tsx` — the direct precedent this
  fix mirrors exactly (same problem shape: Server Component search page +
  `DataTable` with `cell`/`getRowId` functions + row-click navigation).
- Confirmed via a repo-wide scan that every other `*-table.tsx` file already
  follows this pattern (`cases-table.tsx`, `invoices-table.tsx`,
  `orders-table.tsx`, `reference-ranges-table.tsx`, etc. — all 9 existing
  `*-table.tsx` files are `'use client'`). This page is the sole occurrence of
  the bug in the current codebase; the fix is a one-off omission, not part of
  a wider sweep.

## 4. Skills loaded

- `engineering/frontend-design` (required — this change touches an existing
  `apps/web` page/component). Entry #6 is the exact bug and fix pattern;
  entry #8 (`'use server'` files may only export async functions) checked and
  not applicable here (no `'use server'` file is being touched).
- `engineering/api-design` — not required; no `apps/api` route changes.

## 5. Assumptions & autonomous decisions

- The new `ReferringFacilitiesTable` component keeps the exact same columns
  (Name, Phone, Email, Address) and cell rendering (`?? '—'` fallback) as the
  current inline definition — this is a structural fix, not a redesign of
  the table's content.
- No row-click navigation is added (the current inline table has none, and
  there is no facility detail page to navigate to — out of scope for this
  bug fix, matching the issue's own scope).
- `getRowId` becomes `(row) => row.id`, identical to the current inline
  value, now living correctly inside the client component.

## 6. Risks

- Low. This is a narrowly-scoped, single-page structural fix following an
  established, already-working pattern elsewhere in the same codebase. The
  main risk is a typo in the extracted column definitions changing rendered
  output — mitigated by keeping the column/cell logic byte-for-byte identical
  to what's currently inline, just moved.

## 7. Acceptance criteria

- `/admin/referring-facilities` loads without error (200, real content) for a
  role holding `manage_patients` (the capability currently gating the create
  form; the list itself has no additional gate today).
- The facility list renders correctly with zero facilities (`emptyMessage`
  shown) and with one or more facilities (all four columns render correctly,
  including the `?? '—'` fallback for null phone/email/address).
- A facility created via the existing `CreateReferringFacilityForm` appears
  in the list on next load.
- The order-entry form's "Referring facility" dropdown (currently hidden
  whenever `referringFacilities.length === 0`) becomes populated once a
  facility exists — confirms the fix actually unblocks the documented
  downstream consequence, not just the admin page in isolation.
- `pnpm typecheck` and `pnpm lint` pass.

## 8. Testing plan

- Manual `web-verify` pass (per Skill discipline): real dev-server run,
  navigate to `/admin/referring-facilities` as a seeded technologist user,
  confirm a clean 200 in the dev-server log (not just a rendered screenshot —
  this bug's own history shows a screenshot can look fine while the RSC
  error is thrown and logged separately).
- Create a facility through the form, confirm it appears in the list without
  a full page reload.
- Navigate to `/orders/new?patientId=<id>` and confirm the "Referring
  facility" field is now present and lists the created facility.
- No new automated test is proposed for this narrow structural fix — the bug
  class itself (function props across the RSC boundary) is caught by
  `web-verify`'s real-browser pass per `frontend-design` entry #6's own
  origin story, not by `tsc`/`eslint`/unit tests, which passed cleanly on the
  broken code the whole time.

## 9. Rollback plan

Revert the two-file change (delete the new table component, restore the
inline `DataTable` call in `page.tsx`). No data migration, no schema change,
no API change — trivially revertible.

## 10. Questions requiring human approval

None. This is a mechanical fix following an established, already-proven
pattern in the same codebase, with no design decisions to make.
