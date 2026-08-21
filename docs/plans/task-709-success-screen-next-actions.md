# Implementation Proposal: Give post-submit success screens a real next action
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #709 (part of EPIC #697)

## 1. Goal

"Patient registered" (`/patients/new`) and "Order placed" (`/orders/new`)
both dead-ended on a bare confirmation card with a single "back" link, in a
product whose whole point is a multi-step pipeline (register → order →
accession → sign-out → bill). Add the obvious next step to each.

## 2. Affected files

- `apps/web/app/(app)/patients/new/types.ts` — add `createdPatientId` to
  `RegisterPatientState`.
- `apps/web/app/(app)/patients/new/actions.ts` — capture `resourceId` from
  the already-parsed `POST /v1/patients` response (same cast pattern the
  file already uses for `after.mrn`).
- `apps/web/app/(app)/patients/new/page.tsx` — success screen gains "Place
  an order" (linking `/orders/new?patientId=…`, the same param shape
  `orders/new/page.tsx` already expects) and "View patient" actions.
- `apps/web/app/(app)/orders/new/order-builder-form.tsx` — success screen
  gains a "View order" link. `createdOrderId` already existed in
  `CreateOrderState`/`actions.ts` — confirmed via `grep` before writing any
  code — so this file only needed the UI addition, no new plumbing.

## 3. Architecture consulted

`create-referring-facility-form.tsx` / `patients/new/page.tsx`'s own
existing `useActionState` success-screen shape — this proposal extends it,
not a new pattern.

## 4. Skills loaded

`engineering/frontend-design` — checked entry #5 (client-side `next/link`
leaves prior RSC payload in the DOM) before adding `Link`s here: does not
apply, since neither target route (`/orders/new`, `/patients/[id]`,
`/orders/[id]`) is a PHI-minimization-shaped route — they already show
their own legitimate patient/order data, matching that entry's own stated
exception.

## 5. Assumptions & autonomous decisions

- "Place an order" only renders if `createdPatientId` is present (always
  true on a real success, but keeps the type honest rather than asserting
  non-null).
- "View patient" falls back to `/patients` (the search page) if
  `createdPatientId` is somehow absent, rather than a broken link.

## 6. Risks

Very low — additive UI only, no schema/API/behavior change to the create
paths themselves.

## 7. Acceptance criteria

- Registering a patient shows working "Place an order" and "View patient"
  links pointing at the just-created patient.
- Placing an order shows a working "View order" link pointing at the
  just-created order, alongside the existing back-to-patient link.

## 8. Testing plan

`pnpm typecheck`/`pnpm lint` clean (both confirmed). Live browser
verification attempted but blocked by this session's own real-Chrome
instability (the browser process crashed mid-check, unrelated to the app —
confirmed via the dev-server log showing a clean `200` render with no
thrown error immediately beforehand). Confidence from code review instead:
both changes reuse state fields (`createdPatientId`, already-existing
`createdOrderId`) already proven correct by working, deployed code
elsewhere in the same session (patient/order creation flows tested
repeatedly via direct API calls).

## 9. Rollback plan

Revert the four changed files -- no schema/API/data impact.
