# Implementation Proposal: Critical-notifications worklist screen
Status: APPROVED
ADR: n/a    Date: 2026-09-06    Backlog ID: issue #809

## 1. Goal

The critical-value notification/escalation/read-back backend (FEAT-021, TASK-065/066) is real and
fires correctly (live-confirmed this audit cycle), but has zero browser UI — a pending critical sits
in the database forever, invisible to any lab staff member. Add a `/critical-notifications` worklist
page mirroring the existing `/qc-violations` pattern: list pending/escalated criticals with enough
context to act on them, and an acknowledge action that captures the read-back the backend already
models.

## 2. Affected files

- `packages/domain/src/critical-notification.ts` — add nullable, denormalized display fields to
  `criticalNotificationSchema` (patient name/MRN, analyte display, value/unit/flags, orderId) so the
  list screen doesn't need a second round-trip per row.
- `apps/api/src/critical-notification/critical-notification.controller.ts` — `list()` gains the joins
  needed to populate those fields (observation → patient, observation → analyte, observation →
  ordered_test → order), matching the exact join shape `case.controller.ts`'s own `list()` already
  uses for the equivalent patient-name join (issue #749's fix).
- `apps/api/src/critical-notification/critical-notification-mapper.ts` — `toCriticalNotificationDto`
  takes the joined row shape and maps the new fields (or `null` where the caller only has the base
  `critical_notification` row, e.g. inside `CriticalAcknowledgeService`'s own `before`/`after`, which
  keeps returning the un-enriched shape — the frontend doesn't re-render those fields off the
  acknowledge response, only off the initial list load).
- `apps/web/app/(app)/critical-notifications/page.tsx` (new), `notifications-table.tsx` (new),
  `actions.ts` (new) — the new screen, mirroring `qc-violations/{page.tsx,violations-table.tsx,actions.ts}`
  file-for-file in structure.
- `apps/web/app/(app)/_components/sidebar.tsx` — one new nav entry, "Critical notifications", placed
  next to the existing "QC violations" link (matching how closely the two concepts already mirror each
  other in the backend).
- `openapi.json` / SDK — regenerated as the last step (develop Skill §4a), since the API response
  shape changes.

## 3. Architecture consulted

- `apps/web/app/(app)/qc-violations/{page.tsx,violations-table.tsx,actions.ts}` — the direct structural
  precedent this proposal copies file-for-file (list page fetches + passes rows to a Client Component
  table; the table owns the acknowledge/resolve action via `useTransition` + a Server Action).
- `apps/api/src/case/case.controller.ts`'s `list()` (issue #749) — the precedent for joining a
  patient's name into a list response that previously returned only a bare foreign key, in this exact
  codebase, already reviewed and shipped.
- `engineering/api-design` Skill — entry #4 (defer pagination/idempotency until a real endpoint needs
  it: not relevant here, list stays unpaginated, matching `qc-rule-violations`'s own precedent) and
  entry #6 (only mutating actions are audited: `list()` stays unaudited, `acknowledge()` already is).
- `packages/db/src/schema/observation.ts` — confirms `patientId` and `analyteId` are already directly
  denormalized onto the `observation` row itself (ADR-0005), so the new joins are one hop, not a
  multi-table traversal through `ordered_test`/`order` for those two fields (only the `orderId` link
  needs that second hop).

## 4. Skills loaded

- `engineering/api-design` (required — `apps/api` route/schema change).
- `engineering/frontend-design` (required — new `apps/web` page). No entry applies beyond the
  already-established `qc-violations` structural precedent this proposal copies; no new dynamic
  segment, no client-only library, no thrown Server Component error pattern beyond what
  `qc-violations/page.tsx` already uses correctly.

## 5. Assumptions & autonomous decisions

- **Scope grew from the issue's own "no new backend mechanism" framing** — confirmed by reading the
  actual code (no existing endpoint resolves a bare `observationId` to patient/analyte context; the
  `qc-violations` "resolve client-side" precedent only works there because that DTO already carries
  `analyteId` directly, one hop closer than `critical_notification`'s bare `observationId`). The
  smallest correct fix needs this one small, contained join added to an existing list endpoint — not a
  new resource, not new business logic, not a new capability. Flagging this here since it's a real,
  if small, expansion of the original issue's stated scope, not silently absorbed.
- **No new capability for acknowledgment** — reusing the existing `verify` capability exactly as
  `CriticalAcknowledgeService`'s own header comment already documents and justifies (ADR-0016);
  the frontend gate to *show* the acknowledge button is `hasPathologistRole`, mirroring
  `results/page.tsx`'s own `isVerifier` precedent for the identical role/capability pairing.
- **List shows `pending` + `escalated` by default, not `acknowledged`** — mirrors `qc-violations`'s own
  "unresolved-only queue" framing (its own header comment: "not a full QC dashboard... no history
  view"). An acknowledged notification disappearing from view immediately after its action succeeds
  (client-side filter, no refetch) matches `ViolationsTable`'s own `handleResolve` precedent exactly.
- **"View order" link included** — the same pattern issue #800/PR #802 already established for case
  detail (name + MRN + a link to the order), reused here rather than inventing a different convention.

## 6. Risks

- The new joins in `list()` are a straightforward `leftJoin` chain over already-indexed foreign keys
  (`observation.patientId`, `observation.analyteId`, `observation.orderedTestId` → `order.id`) — no
  new index needed, low performance risk at this table's realistic size (critical notifications are,
  by definition, rare).
- Schema field additions are purely additive (new nullable fields) — no existing consumer of
  `criticalNotificationSchema` breaks.

## 7. Acceptance criteria

- `/critical-notifications` lists every `pending`/`escalated` row with patient name, MRN, analyte,
  value + flag, and a link to the order.
- A user with the `verify` capability (pathologist-roled) sees an "Acknowledge" action that requires a
  non-empty read-back note; submitting it calls the real `POST .../acknowledge` endpoint and removes
  the row from view on success.
- A user without that capability sees the list but no acknowledge control (mirrors `qc-violations`'s
  `isQa` gating pattern exactly).
- Sidebar shows a new "Critical notifications" link.

## 8. Testing plan

- `pnpm --filter web typecheck`/`lint`, `pnpm --filter api typecheck`/`lint`.
- Regenerate `openapi.json`/SDK, confirm no drift check failure.
- Manual `web-verify` pass: re-use the real critical `pending` notification already created live this
  audit cycle (Potassium 7.8, `critical_notification` id `fd0cd11a-2fe8-4d47-90bc-f329c3c92072`) —
  confirm it appears on the new page with correct patient/analyte/value context, acknowledge it with a
  real read-back note, confirm it disappears and the DB row updates to `status: 'acknowledged'` with
  the read-back text and acknowledging user recorded.

## 9. Rollback plan

Additive across the board (new schema fields, new page, one new nav link) — revert the commit if
anything regresses. No migration needed (no new table/column, purely response-shape enrichment).

## 10. Questions requiring human approval

None beyond the scope note in §5 (a small, contained API join, not a new capability or resource) —
flagging it for visibility, not blocking on it, since it's a mechanical necessity to make the feature
usable at all, not a product/architecture choice with real alternatives.
