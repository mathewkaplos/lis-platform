# Implementation Proposal: Default "recent patients" listing alongside search
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #716 (part of EPIC #697)

## 1. Goal

`/patients` with no search term showed only a bare "search to find a
patient" prompt. Add a default "recently registered" view without replacing
search.

## 2. Affected files

- `packages/domain/src/patient.ts` — new `recent: z.literal('true')` mode on
  `patientSearchQuerySchema` (a fifth, distinct mutually-exclusive lookup
  shape, not "q absent means recent" — an absent-and-otherwise-invalid query
  still fails loudly per ADR-0013's fail-closed precedent) + new
  `PATIENT_RECENT_RESULT_LIMIT` (20, tighter than the 50-row search cap —
  this is a glanceable default, not a second full listing).
- `apps/api/src/patient/patient.controller.ts` — `search()` gains a
  `recent` branch: most-recently-registered first, same
  merged-patient-exclusion and clinician-scoping as the existing `q` branch.
- `apps/web/app/(app)/patients/page.tsx` — calls `recent=true` instead of
  showing the bare prompt when no `q` is present.

## 3. Architecture consulted

`patient.controller.ts`'s own `search()` method — this is a fifth branch
alongside the four already-established mutually-exclusive lookup modes
(`mrn`, `nationalId`, `q`, `firstName`+`lastName`+`birthDate`), not a new
endpoint or a parallel code path.

## 4. Skills loaded

`engineering/api-design` (existing `apps/api` route modified) and
`engineering/frontend-design` (existing `apps/web` page modified).

## 5. Assumptions & autonomous decisions

- Cap of 20 (not 50, the search cap) — a default landing view should be
  glanceable, not a second full listing; revisit if real usage wants more.
- No new UI affordance to distinguish "recent" from "search results" beyond
  a plain "Recently registered" heading — matches this screen's existing
  minimal-chrome style (no `FilterBar`, no pager, per TASK-041's own
  established scope).

## 6. Risks

Low. Additive query mode; existing `mrn`/`nationalId`/`q`/name+DOB branches
are unchanged.

## 7. Acceptance criteria

- `GET /v1/patients?recent=true` returns the most recently registered
  patients (confirmed live: a patient registered minutes earlier appeared
  first).
- `/patients` with no `q` param shows this list under a "Recently
  registered" heading instead of the old bare prompt.
- Searching still works unchanged.

## 8. Testing plan

`pnpm typecheck`/`lint` clean (api + web). Live verification against the
running dev API/web: `GET /v1/patients?recent=true` returned real data, and
`GET /patients` (with a real signed session cookie, no query) rendered
"Recently registered" plus the expected patient. Full local e2e run of
`patient.e2e-spec.ts` was attempted but blocked by an unrelated local
Keycloak credential/Docker-restart issue in this dev environment (all four
Docker containers exited mid-session, unrelated to this change) — CI is the
authoritative signal for the existing four search modes' regression
coverage.

## 9. Rollback plan

Revert the three changed files. No schema/migration change.
