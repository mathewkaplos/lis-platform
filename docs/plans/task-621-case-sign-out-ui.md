# Implementation Proposal: Case sign-out (finalize) browser UI
Status: APPROVED
ADR: n/a (implements existing ADR-0051 flow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #621

## 1. Goal

`POST /v1/cases/:id/finalize` (FEAT-059/ADR-0051) is a correct, fully-tested backend action that
assembles a case's report content, signs it, creates the first `case_report_version`, and moves
`case.status` to `signed_out` — but nothing in `apps/web` can reach it. Issue #615's own Amend UI
only ever renders on a case already `signed_out`/`amended`, and today the only way to get a case
into that state is a direct API call. Add a "Sign out" action to the case detail page — the direct
sibling of #615's "Amend" action, reusing its exact conventions (verifier gating, step-up-redirect
handling, raw-fetch precedent) rather than re-deriving them.

## 2. Affected files

- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add `signOutCase` server action: raw `fetch`
  `POST` to `${API_BASE_URL}/v1/cases/${caseId}/finalize` (no request body — `finalize()` takes
  none, confirmed by reading the controller directly). Same 403/400 handling shape as `amendCase`:
  a 403 with body `code === 'step_up_required'` redirects to
  `/api/auth/login?step_up=1&rd=${encodeURIComponent(`/cases/${caseId}`)}`; a plain 403 returns a
  permission error; a 400 (incomplete lineage, or a two-tier case not yet `pending_review`)
  surfaces the API's own `detail` message verbatim — per the issue's own "at minimum a plain error
  message is enough to start" scope call, no client-side replication of `assertCompleteLineage`
  or `requiresTwoTierReview`. On success, `revalidatePath` the case route (same precedent
  `amendCase` already established) and return a "done" state.
- `apps/web/app/(app)/cases/[caseId]/sign-out-case-form.tsx` (new) — client component,
  `useActionState`, no input fields (finalize needs none) — a short description plus one submit
  button ("Sign out this case"). Same `useActionState`/loading-done-error shape as
  `amend-case-form.tsx`, simplified (no `FormField`/textarea, since there's no reason field).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — add a `NOT_YET_SIGNED_STATUSES` set
  (`accessioned`, `in_process`, `pending_review` — everything `AMENDABLE_STATUSES` doesn't already
  cover). When `NOT_YET_SIGNED_STATUSES.has(caseData.status) && hasVerifierRole(session)`, render
  a new "Sign out" card (same `Card`/`CardHeader`/`CardContent` shape as the existing "Report
  versions" card) containing `<SignOutCaseForm caseId={id} />`. This card and the existing
  "Report versions" card are mutually exclusive by construction (a case is never simultaneously in
  `AMENDABLE_STATUSES` and `NOT_YET_SIGNED_STATUSES`), so no additional guard is needed to prevent
  both showing at once.
- `apps/web/app/(app)/cases/[caseId]/types.ts` — add `SignOutCaseState` type +
  `signOutCaseInitialState`, matching `AmendCaseState`'s exact shape (status: idle/submitting/
  done/error, optional `formError`) minus nothing — the shape is identical, but per this codebase's
  own "reuse before inventing, but don't couple unrelated concerns" balance, a separate named type
  is used (matching `AmendCaseState`/`UploadWholeSlideImageState` each already being separate types
  for separate actions, not a shared generic one) rather than introducing a new abstraction for a
  two-type coincidence.
- No `apps/api` changes. No domain schema changes. No OpenAPI/SDK regeneration needed — `finalize`
  has no `@ZodResponse` today (undocumented shape, confirmed by reading the controller), so this
  proposal doesn't touch it, matching `amend`'s own precedent from issue #615's proposal §2.

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `finalize()` (lines ~850-937) — confirmed directly: no
  `@ZodResponse`, no request body, the exact guard stack (`JwtAuthGuard, CapabilityGuard,
  StepUpGuard` / `verify` + `@RequireStepUp()`), the "already finalized" 400, the
  `assertCompleteLineage` 400, and the two-tier "requires screening before sign-out" 400 — all
  read from the live code, not assumed from the issue text.
- `docs/plans/task-615-case-amendment-ui.md` (issue #615's own proposal) — the established
  conventions this proposal reuses directly rather than re-deriving: `hasVerifierRole` as a
  UI-visibility-only gate (real enforcement stays server-side), the raw-`fetch`-server-action
  pattern for an undocumented route, the `step_up_required`-code redirect branch (now proven
  working end-to-end via #615's own live browser verification, not just built), and
  `revalidatePath` on success.
- `apps/web/app/(app)/cases/[caseId]/actions.ts` (current state, post-#615) — `amendCase`'s exact
  structure is the template for `signOutCase`.
- `apps/web/app/(app)/cases/[caseId]/page.tsx` (current state, post-#615) — confirms
  `AMENDABLE_STATUSES = new Set(['signed_out', 'amended'])` and the existing "Report versions"
  card's exact placement/shape, which the new "Sign out" card mirrors as a sibling.
- `packages/domain/src/anatomic-pathology.ts` `caseStatusSchema` — confirms the full 5-value
  status enum (`accessioned`, `in_process`, `pending_review`, `signed_out`, `amended`), so
  `NOT_YET_SIGNED_STATUSES` is exactly the complement of `AMENDABLE_STATUSES`.

## 4. Skills loaded

- `engineering/frontend-design` (required — Affected Files add a new `apps/web` client component).
  Checked: no function-valued props cross the Server/Client boundary (`SignOutCaseForm` takes only
  a plain `caseId: string`, same as `AmendCaseForm`/`UploadWsiForm`); no new route/dynamic segment
  added (same `[caseId]` page), so the route-group/dynamic-segment-name collision entry doesn't
  apply.
- `engineering/api-design` — not reloaded as "required new reading" since this proposal adds zero
  `apps/api` routes (unlike #615, which added the report-versions GET route) — the existing
  `finalize()` route is reused unmodified.

## 5. Assumptions & autonomous decisions

- **No screening ("Screen") action is added.** A two-tier cytology case that isn't yet
  `pending_review` will 400 on sign-out with the API's own message
  (`Case ${id} requires screening before sign-out (status: ...)`), surfaced verbatim as a form
  error. Per the issue's own explicit scope note: "cytology two-tier screen→review UI is its own
  remaining item on issue #610's list, not this one." Building it here would silently expand scope
  beyond what #621 was filed for.
- **No lineage-completeness pre-check in the UI.** A case with an incomplete part/block/slide tree
  will 400 on sign-out with `assertCompleteLineage`'s own message, surfaced verbatim. Same
  reasoning as above — issue #621 explicitly calls "at minimum a plain error message" sufficient
  for this pass.
- **The Sign out card and Report versions card are mutually exclusive**, driven by disjoint status
  sets rather than a shared "show mutation controls" flag — matches the existing codebase's general
  preference for explicit, readable conditionals over a unified state machine for two boolean
  gates that only ever have two real states between them.
- **No confirmation dialog before submitting.** `finalize()` is significant (it's a legal/clinical
  sign-out with digital signature) but so is `amend()`, and #615 shipped without one — matching
  that precedent rather than introducing a new interaction pattern (a modal/confirm) this codebase
  doesn't otherwise use for AP mutations. If the human wants a confirmation step, flagging in §10.

## 6. Risks

- **Low.** Purely additive UI wiring against an already-correct, already-tested API action, reusing
  #615's own exact server-action/redirect pattern (already proven live in a real browser, not just
  unit-level).
- The step-up redirect path is not a *new* risk here — #615 already exercised it as apps/web's
  first real caller; `signOutCase` is the second, using the identical branch, so no new gap to
  verify beyond confirming the same code path is wired correctly in the new action (a direct code
  read, same as #615's own §6 approach — not re-litigating the mechanism itself).
- A subtle real risk worth naming: `finalize()`'s 400 messages are meant for developers/API callers
  (e.g., `Case ${id} requires screening before sign-out (status: accessioned)`) — surfacing them
  verbatim to a pathologist is functional but not polished copy. Accepted for this pass per the
  issue's own "plain error message is enough to start" scope call; a future pass could translate
  these into clinician-facing language once real usage shows which rejections are common enough to
  warrant it.

## 7. Acceptance criteria

1. A verifier viewing a case whose status is `accessioned`, `in_process`, or `pending_review` sees
   a "Sign out" card with a submit control; a technologist viewing the same case sees neither the
   Sign out card nor the Report versions card (the latter only ever shows on an already-terminal
   case).
2. A verifier viewing an already `signed_out`/`amended` case sees the Report versions card (and
   Amend form) but not the Sign out card.
3. Submitting Sign out on a lineage-complete, screening-satisfied case, with a fresh step-up,
   creates v1, flips the case to `signed_out`, and the page re-renders showing the Report versions
   card with v1 listed and the Sign out card gone.
4. Submitting Sign out on a case with incomplete lineage or (for a two-tier case) before screening
   shows the API's own rejection message as a form error; case status is unchanged.
5. Submitting Sign out with a stale step-up redirects through `/api/auth/login?step_up=1` and
   lands back on the same case page (verified at the code level per #615's own precedent — see
   §6 — not necessarily re-driven through a live 5-minute wait unless time permits).
6. No change to `finalize()`'s own business logic, `amend()`, or any existing e2e assertion.

## 8. Testing plan

- No new `apps/api` e2e tests — `finalize()`'s behavior is already exhaustively covered by
  `case-sign-out.e2e-spec.ts` (AC #1/#2 in that file), and this proposal adds no backend route or
  logic change.
- No new `apps/web` automated tests (matching #615's and #613's own precedent — no page-level test
  coverage exists for any AP screen in this app yet).
- Manual/browser verification (`web-verify` Skill): log in as a verifier, sign out a
  lineage-complete histology case (no screening required) end-to-end, confirm AC #1/#2/#3; attempt
  sign-out on an incomplete-lineage case and confirm AC #4's error surfaces; log in as a
  technologist and confirm neither card renders on a non-terminal case (AC #1's negative case).

## 9. Rollback plan

Revert the commit(s). No migration, no backend route change, no data written by this proposal
itself beyond what `finalize()` already legitimately writes when a user chooses to sign out — a
plain `git revert` fully restores prior (API-only) behavior.

## 10. Questions requiring human approval

1. Confirm no confirmation dialog before Sign out is acceptable for this pass (matching #615's own
   no-confirmation precedent for Amend), given sign-out is a legally/clinically significant action.
2. Confirm surfacing `finalize()`'s raw backend rejection messages (lineage-incomplete,
   not-yet-screened) verbatim is acceptable for this pass, rather than translating them into
   clinician-facing copy now.
