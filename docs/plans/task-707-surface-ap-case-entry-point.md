# Implementation Proposal: Surface the AP case entry point from Orders/Patients
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #707 (part of EPIC #697)

## 1. Goal

AP case creation is deliberately reachable only from an order's own detail
page (`cases/new/page.tsx`'s own header comment confirms this is
intentional backend design, not an oversight) — but nothing pointed a
first-time user there. Confirmed during the pilot-readiness audit: a
reception user placing a "routine" order for a biopsy sees a chemistry-shaped
catalog with no biopsy option and no signal to look elsewhere.

## 2. Affected files

- `apps/web/app/(app)/cases/page.tsx` — a persistent hint under the page
  header pointing at Orders.
- `apps/web/app/(app)/cases/cases-table.tsx` — a richer empty-state message
  (was just "No cases yet.").
- `apps/web/app/(app)/orders/new/order-builder-form.tsx` — a hint above the
  test-catalog search explaining the actual AP path, at the exact point a
  user would otherwise search "biopsy" and find nothing.

## 3. Architecture consulted

`cases/new/page.tsx`'s own header comment — this proposal doesn't change
the entry point itself (a deliberate design choice), only makes it
discoverable from the two places a first-time user would naturally look
(the empty Cases list, and the order-entry catalog where they'd otherwise
search for a biopsy test and find nothing).

## 4. Skills loaded

`engineering/frontend-design` (existing `apps/web` pages modified — copy
only, no new components/forms).

## 5. Assumptions & autonomous decisions

- Copy-only change, no new UI component — a persistent text hint was judged
  sufficient for this gap (not a modal, tour, or onboarding checklist,
  which would be disproportionate to a one-sentence discoverability
  problem).

## 6. Risks

Very low — text-only changes to existing pages.

## 7. Acceptance criteria

- `/cases` shows a hint pointing at Orders when landing on the case list.
- `/orders/new` shows a hint above the test catalog explaining the AP
  accessioning path.
- The empty-state message on an empty case list explains how to start one.

## 8. Testing plan

`pnpm --filter web typecheck`/`lint` clean. Live verification against the
running dev web server with a real signed session cookie: both hints
confirmed present in the real rendered HTML on `/cases` and `/orders/new`.

## 9. Rollback plan

Revert the three changed files. No schema/API/behavior change.
