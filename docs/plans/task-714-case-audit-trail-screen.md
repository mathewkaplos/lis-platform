# Implementation Proposal: Surface the case-level audit trail as a screen
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #714 (part of EPIC #697)

## 1. Goal

Case sign-out/amend already record real, structured audit data
(`context.step_up: { authTime, method }`, `case.controller.ts`'s own
`finalize()`/`amend()`), confirmed during the pilot-readiness audit by
inspecting a raw API response — but no screen existed anywhere to review it.
Add one.

## 2. Affected files

- `packages/domain/src/case-audit-trail.ts` (new) — `CaseAuditEvent`/
  `CaseAuditTrailResponse` schemas.
- `packages/domain/src/index.ts` — re-export.
- `apps/api/src/case/case.controller.ts` — new `GET
  /v1/cases/:id/audit-trail`, read-only, no capability gate (matching
  `getById`/`list`'s own precedent — viewing history is informational).
  Merges two `resourceType`s: the case's own directly-audited actions
  (`resourceType: 'case'`) and its report-version lifecycle events
  (`resourceType: 'case_report_version'`, scoped to that case's own report
  version ids) — not every child entity's individually-audited row (a
  block's own audit row carries the block's id, not the case's).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — new "Audit trail" card.

## 3. Architecture consulted

`audit.ts`'s own header comment (the `audit_event` table shape: flattened
actor/resource columns, `context` jsonb carve-out for
`step_up`/`request_id`/etc.) and `case.controller.ts`'s existing
`getById()`/`list()` for the read-only, ungated route-gating precedent this
new route matches exactly.

## 4. Skills loaded

`engineering/api-design` (new `apps/api` route) and
`engineering/frontend-design` (existing `apps/web` page modified).

## 5. Assumptions & autonomous decisions

- **Scope: case-lifecycle events only, not every descendant's own audit
  row.** A block's `add_block` audit event carries `resourceType: 'block'`
  with the *block's* id, not the case's — a truly exhaustive "everything
  that ever touched this case" trail would need to recursively resolve
  every specimen/block/slide id under the case first. The issue's own title
  ("case-level audit trail — step-up method + timestamp") and its origin
  (the sign-out/amend step-up data specifically) both point at the
  case-lifecycle actions (accession, add_block, add_slide,
  record_narrative, screen, return_to_screening, sign_out, amend) as the
  real ask, not a full recursive audit. Noted here as a scoping decision,
  not a silent gap.
- No capability gate on the new route — matches `getById`/`list`'s own
  "viewing is informational" precedent on this exact controller.

## 6. Risks

Low. New read-only route + new UI card; no existing behavior changed.

## 7. Acceptance criteria

- `GET /v1/cases/:id/audit-trail` returns the case's own lifecycle events,
  newest first, including `stepUp` for sign-out/amend.
- The case detail page shows an "Audit trail" card with action, timestamp,
  actor role, and step-up re-authentication details when present.

## 8. Testing plan

`pnpm typecheck`/`lint` clean (api + web). Live verification against the
running dev API/web using a real previously-signed-out case from earlier in
this session: `GET /v1/cases/{id}/audit-trail` returned both
`case.accession` and `case.sign_out` (with real `stepUp: { authTime,
method: "reauthentication" }`) events; the case detail page rendered the
same under "Audit trail".

## 9. Rollback plan

Revert the four changed/new files. No schema/migration change — reads an
existing table.
