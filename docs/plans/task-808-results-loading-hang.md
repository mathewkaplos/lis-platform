# Implementation Proposal: Fix /orders/[id]/results Suspense-boundary hang
Status: APPROVED
ADR: n/a    Date: 2026-09-06    Backlog ID: issue #808

## 1. Goal

`/orders/[id]/results` hangs indefinitely on its own `loading.tsx` fallback, live-confirmed twice
during the chemistry/haematology verification pass (Decision 1,
`docs/project-completeness-audit-2026-09.md`) — the server returns a real 200 every time
(`GET /orders/<id>/results 200 in 9.4s` cold, `200 in 2.7s` warm), but the client never renders past
the Suspense boundary. This is the identical, already-diagnosed root cause as issue #708
(`/patients`, `/orders`): a route-level `loading.tsx` Suspense boundary never resolving client-side
under `next dev --webpack` on this Next.js version, despite the server successfully streaming the
RSC payload. Apply the exact same, already-proven fix.

## 2. Affected files

- `apps/web/app/(app)/orders/[id]/results/loading.tsx` — deleted.
- `apps/web/app/(app)/orders/[id]/results/page.tsx` — add the same explanatory header-comment
  precedent `/patients/page.tsx` and `/orders/page.tsx` already carry, so a future session doesn't
  re-add a `loading.tsx` here without re-checking this exact defect first.

## 3. Architecture consulted

- `docs/pilot/PILOT-USER-GUIDE.md` §7/§8 — the original root-cause isolation and fix for the
  identical defect on `/patients` and `/orders`. This proposal applies that exact same fix to a third
  route the original fix never covered.
- `apps/web/app/(app)/patients/page.tsx` (current) — confirms the exact wording/placement of the
  explanatory comment to mirror.

## 4. Skills loaded

- `engineering/frontend-design` — no entry applies beyond the already-established §7/§8 precedent
  itself (removing a `loading.tsx` file, not adding new logic).

## 5. Assumptions & autonomous decisions

- No design decision here — this is a mechanical repeat of an already-approved, already-live-verified
  fix pattern for the identical defect signature on a third route.

## 6. Risks

- None beyond what #708's own original fix already accepted: removing `loading.tsx` means this route
  goes back to showing no loading feedback of its own during a slow first compile — mitigated
  app-wide by the `RouteProgressBar` shipped this same audit cycle (issue #805/PR #806), which covers
  exactly this gap for link-driven navigation into this route.

## 7. Acceptance criteria

- `/orders/[id]/results` renders the actual results-entry grid after navigating to it, both cold
  (first compile) and warm (re-navigation).
- No `loading.tsx` file remains in this route's directory.

## 8. Testing plan

- Manual `web-verify` pass: re-navigate to the exact order/results URL that reproduced the hang,
  confirm it now renders; hard-refresh the same URL directly (not just via click) to rule out any
  residual Suspense involvement.
- `pnpm --filter web typecheck`/`lint`.

## 9. Rollback plan

Single-file deletion plus a comment — trivial to revert if anything regresses.

## 10. Questions requiring human approval

None — this is a direct repeat of an already-approved, already-verified fix for the identical defect.
