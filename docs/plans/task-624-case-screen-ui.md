# Implementation Proposal: Cytology two-tier screening browser UI
Status: APPROVED
ADR: n/a (implements existing FEAT-063 flow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #624

## 1. Goal

`POST /v1/cases/:id/screen` (FEAT-063) is a correct, already-tested backend action that moves a
two-tier cytology case from `accessioned`/`in_process` to `pending_review` — a prerequisite for
issue #621's own "Sign out" action, which otherwise just 400s forever on a cytology case with
"requires screening before sign-out." Add a "Screen" action to the case detail page, the third
sibling on the same page as #621's "Sign out" and #615's "Amend" cards, reusing their established
conventions.

## 2. Affected files

- `apps/web/auth/roles.ts` — add `hasSpecimenManagementRole`, matching `hasPatientManagementRole`'s
  exact shape (technologist OR verifier) but named for its real meaning here. `manage_specimens`
  and `manage_patients` happen to grant to an identical role set (confirmed directly in
  `apps/api/src/auth/capabilities.ts`), but per this file's own established convention — a
  separate, narrowly-named helper per real capability rather than reusing one under the wrong name
  (`hasVerifierRole`/`hasQaRole`/`hasTechnologistRole`/`hasPatientManagementRole` are each their
  own helper despite some sharing implementation shape) — this adds a new function, not a call to
  the existing one.
- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add `screenCase` server action: raw `fetch`
  `POST` to `${API_BASE_URL}/v1/cases/${caseId}/screen` (no request body — `screen()` takes none).
  Simpler than `amendCase`/`signOutCase`: `screen()` has **no** `@RequireStepUp()` (confirmed
  directly in the controller and its own header comment — "ADR-0051 scopes step-up... not this
  routine tier transition"), so there is no `step_up_required` branch to wire here — a plain 403
  always means a genuine permission denial, not a re-auth prompt. A 400 (case doesn't require
  two-tier review, wrong status, or incomplete lineage) surfaces the API's own `detail` message
  verbatim, same precedent as `signOutCase`. On success, `revalidatePath` the case route and return
  a "done" state.
- `apps/web/app/(app)/cases/[caseId]/screen-case-form.tsx` (new) — client component,
  `useActionState`, no input fields — a short description plus one submit button ("Screen this
  case"). Same shape as `sign-out-case-form.tsx`, the closest existing sibling (also a
  no-input-fields single action).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — add `SCREENABLE_STATUSES = new Set(['accessioned',
  'in_process'])` (identical membership to `NOT_YET_SIGNED_STATUSES`, but a separate named constant
  since it drives a different card with a different role gate, not because the sets themselves
  differ — see §5 on why the Sign out card also stays visible instead of being replaced). When
  `SCREENABLE_STATUSES.has(caseData.status) && hasSpecimenManagementRole(session)`, render a new
  "Screen" card (`Card`/`CardHeader`/`CardContent`, matching the existing cards' shape) containing
  `<ScreenCaseForm caseId={id} />`, placed before the existing "Sign out" card in reading order
  (screening logically precedes sign-out).
- `apps/web/app/(app)/cases/[caseId]/types.ts` — add `ScreenCaseState` type +
  `screenCaseInitialState`, matching `SignOutCaseState`'s exact shape.
- No `apps/api` changes, no domain schema changes, no OpenAPI/SDK regeneration — `screen()` has no
  `@ZodResponse` today, matching `amend`/`finalize`'s own precedent.

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `screen()` (lines ~784-848) — confirmed directly: no
  `@ZodResponse`, no request body, no `@RequireStepUp()`, `manage_specimens` capability, the
  "wrong status" 400, the "doesn't require two-tier review" 400, and the `assertCompleteLineage`
  400 — all read from the live code.
- `apps/api/src/case/case-tiering.ts` — confirmed `CYTOLOGY_SPECIMEN_TYPES`/`requiresTwoTierReview`
  live in `apps/api/src`, not `packages/domain` — `apps/web` cannot import them, and this repo has
  no cross-app-source-import convention. See §5 for the resulting scope decision (don't duplicate
  this logic client-side).
- `apps/api/src/auth/capabilities.ts` — confirmed `manage_specimens`'s grant list is identical to
  `manage_patients`'s (both `technologist`, `verifier`) — the basis for §2's `roles.ts` decision.
- `docs/plans/task-621-case-sign-out-ui.md` (issue #621's own proposal) — the established
  conventions this proposal reuses directly: the no-input-fields action-card shape, the raw-fetch
  server-action pattern for an undocumented route, `revalidatePath` on success, and — crucially,
  the one place this proposal *diverges* — the `step_up_required` redirect branch, which does not
  apply to `screen()` at all (§2).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` (current state, post-#615 and post-#621) — confirms
  `NOT_YET_SIGNED_STATUSES`'s exact membership and the existing two cards' placement/shape, which
  the new "Screen" card mirrors as a third sibling.
- `apps/web/auth/roles.ts` — confirms `hasPatientManagementRole`'s exact shape and the file's own
  one-helper-per-capability convention (§2).

## 4. Skills loaded

- `engineering/frontend-design` (required — Affected Files add a new `apps/web` client component).
  Checked: no function-valued props cross the Server/Client boundary (`ScreenCaseForm` takes only a
  plain `caseId: string`, same as its siblings); no new route/dynamic segment added.
- `engineering/api-design` — not reloaded as required new reading since this proposal adds zero
  `apps/api` routes (same as #621) — `screen()` is reused unmodified.

## 5. Assumptions & autonomous decisions

- **The Screen card is NOT restricted to cases that actually require two-tier review** — it shows
  for *any* case whose status is `accessioned`/`in_process`, regardless of specimen type. This is a
  deliberate deviation from the issue's own suggested scope ("only rendered when the case actually
  requires two-tier review"), made because `requiresTwoTierReview`'s pure logic lives in
  `apps/api/src/case/case-tiering.ts`, not an importable shared package, and duplicating a small
  but real business rule (`CYTOLOGY_SPECIMEN_TYPES = ['cervical_cytology']`) client-side risks
  silent drift if that list ever changes API-side without a matching frontend edit — a real,
  concrete risk class this codebase has hit before in other areas (client/server logic duplication
  bugs), not a hypothetical. Instead, a histology case's Screen attempt 400s with the API's own
  "does not require screening" message, surfaced verbatim — the exact same "plain error message,
  no client-side business-rule duplication" precedent issue #621's own proposal already
  established for lineage-completeness and two-tier-readiness checks on the Sign out action.
  Flagged explicitly in §10 since it's a real, visible deviation from the filed issue's own text,
  not a small implementation detail.
- **The Sign out card is NOT hidden while the Screen card shows** (both `SCREENABLE_STATUSES` and
  `NOT_YET_SIGNED_STATUSES` have identical membership, so on an `accessioned`/`in_process` case
  both cards render together for a `manage_specimens`-granted user). This mirrors the real backend
  behavior exactly: a histology case's Sign Out already works directly from `accessioned` today
  (issue #621, verified live), so hiding Sign Out whenever Screen is visible would break that
  working path for histology cases. A cytology case's premature Sign Out attempt still just 400s
  with "requires screening before sign-out" (already-surfaced, already-verified behavior from
  #621) — an acceptable, informative dead click, not a broken state.
- **No reviewer-facing "pending review" queue or reject/return-to-screener action.** Confirmed no
  such backend route exists (this session's own cytology two-tier deep-dive testing pass already
  established this via an exhaustive route check) — out of scope per the issue's own text, a
  separate, larger, not-yet-backed piece if ever built.

## 6. Risks

- **Low.** Purely additive UI wiring against an already-correct, already-tested API action reusing
  #621's own established patterns, minus the step-up complexity `screen()` doesn't have.
- The main real risk is §5's own scope call (showing Screen unconditionally rather than gating on
  specimen type) landing as confusing UX for a histology case (a Screen button that will always
  400) — mitigated by the button's own description text explaining what it does, and by this being
  explicitly surfaced as a §10 question rather than silently decided.
- No step-up/redirect risk to re-verify — `screen()` genuinely has no such gate, unlike the other
  two AP mutation actions on this page.

## 7. Acceptance criteria

1. A `manage_specimens`-granted user (technologist or verifier) viewing a case whose status is
   `accessioned` or `in_process` sees a "Screen" card; a `qa`-only or no-role user sees neither
   Screen nor Sign out.
2. A verifier viewing the same non-terminal case sees both the Screen card and the Sign out card
   together (§5).
3. Submitting Screen on a lineage-complete cytology (`cervical_cytology`) case moves it to
   `pending_review`; the page re-renders with the Screen card gone (status no longer in
   `SCREENABLE_STATUSES`) and the Sign out card still present (status is in `NOT_YET_SIGNED_STATUSES`).
4. Submitting Screen on a histology (`tissue`) case shows the API's own "does not require
   screening" message verbatim; case status is unchanged.
5. Submitting Screen on a lineage-incomplete case shows the API's own `assertCompleteLineage`
   message verbatim; case status is unchanged.
6. No change to `screen()`'s own business logic, `finalize()`, `amend()`, or any existing e2e
   assertion.

## 8. Testing plan

- No new `apps/api` e2e tests — `screen()`'s behavior is already covered by
  `cytology-two-tier.e2e-spec.ts`, and this proposal adds no backend route or logic change.
- No new `apps/web` automated tests (matching #613/#615/#621's own precedent).
- Manual/browser verification (`web-verify` Skill): seed a lineage-complete `cervical_cytology`
  case and a lineage-complete `tissue` case via API (both `accessioned`); as a technologist,
  confirm Screen appears on both (AC #1), succeeds on the cytology case (AC #3), and 400s with the
  right message on the tissue case (AC #4); as a verifier, confirm both Screen and Sign out render
  together on a fresh non-terminal case (AC #2); confirm an incomplete-lineage case's Screen
  attempt 400s correctly (AC #5).

## 9. Rollback plan

Revert the commit(s). No migration, no backend route change — a plain `git revert` fully restores
prior (API-only) behavior.

## 10. Questions requiring human approval

1. **Confirm §5's main deviation:** the Screen card shows for any non-terminal case (not just
   cytology ones), relying on the API's own rejection message for a histology case rather than
   duplicating `requiresTwoTierReview`'s specimen-type logic client-side. The alternative — hiding
   Screen entirely for a non-cytology case — is straightforward to add later (or now, if preferred)
   by threading `caseData.parts.some(p => p.specimenType === 'cervical_cytology')` into the same
   condition, but was left out here to avoid a client-side copy of a business rule that already
   lives in exactly one place today.
2. Confirm both Screen and Sign out showing together on a screenable case (rather than Sign out
   being hidden until screening completes) is acceptable, given a premature Sign Out attempt on a
   cytology case is a dead click (400) rather than a broken or misleading state.
