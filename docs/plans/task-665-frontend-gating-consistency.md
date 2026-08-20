# Implementation Proposal: AP frontend gating consistency (issue #665)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #665

## 1. Goal

Two AP frontend controls don't hide themselves for a session lacking
`manage_specimens`, unlike every sibling control on the same pages: the WSI
upload form on the case-detail page, and the case-accessioning form/link.
Backend enforcement (`CapabilityGuard`) is already correct in both cases —
this is a pure UI-consistency fix, not a security fix.

## 2. Affected files

- **Modify:** `apps/web/app/(app)/cases/[caseId]/page.tsx` — wrap
  `UploadWsiForm`'s render in `hasSpecimenManagementRole(session)`, matching
  `AddBlockForm`/`AddSlideForm`/`AddOrderedTestForm`/`NarrativeForm` on the
  same page.
- **Modify:** `apps/web/app/(app)/cases/new/page.tsx` (and/or the order
  detail page's own "New AP case" entry link, if it isn't already gated) —
  add the same page-level check `synoptic/[partId]/page.tsx` already uses
  (a plain thrown `Error` when the session lacks the role).

## 3. Architecture consulted

- `apps/web/auth/roles.ts`'s `hasSpecimenManagementRole` — already used by
  every sibling control; no new helper needed.
- `synoptic/[partId]/page.tsx`'s existing page-level gate pattern (`if
  (!hasSpecimenManagementRole(session)) throw new Error(...)`) — the direct
  precedent for `/cases/new`.
- `frontend-design` Skill — read; no entry directly triggered (no new route,
  no new Server Action, no client-only library).

## 4. Skills loaded

`engineering/frontend-design` (required for any `apps/web` change per the
`plan` Skill's own rule) — confirmed no entry applies beyond general review.

## 5. Assumptions & autonomous decisions

- Case-accessioning gate applied at the page level (matching
  `synoptic/[partId]/page.tsx`'s precedent), not just hiding the entry link
  from the order detail page — a user who reaches `/cases/new?orderId=...`
  directly by URL should also be blocked, not just have the link hidden.
- No change to the order-detail page's own "New AP case" link visibility
  beyond what already exists (out of scope per the issue).

## 6. Risks

Minimal — purely additive client-side gating, no backend change.

## 7. Acceptance criteria

- A session without `manage_specimens` sees neither the WSI upload form nor
  the case-accessioning page's own form (direct navigation throws/redirects
  the same way the synoptic recording page already does).
- A session with `manage_specimens` sees both exactly as today.

## 8. Testing plan

Real browser `web-verify` pass with both a `manage_specimens`-holding
session and a session without it (e.g. `qa` role).

## 9. Rollback plan

Trivial revert — no backend/schema change, no migration.

## 10. Questions requiring human approval

None — the issue itself fully specifies the fix; no open design decisions.
