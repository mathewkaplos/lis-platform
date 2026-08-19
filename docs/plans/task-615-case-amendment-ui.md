# Implementation Proposal: Case amendment (sign-out correction) browser UI
Status: APPROVED
ADR: n/a (implements existing ADR-0051 flow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #615

## 1. Goal

`POST /v1/cases/:id/amend` (FEAT-059/ADR-0051) is a correct, fully-tested backend action — but
nothing in `apps/web` can reach it. A verifier who needs to correct an already-signed-out case has
no button, form, or view of prior report versions anywhere in the browser. Per the issue's own
"at minimum" scope: add an Amend action (gated the same way the backend already is: `verify`
capability + fresh step-up), a required `reason` field, and a simple list showing that a case has
prior versions (metadata only — no content diff/comparison, explicitly called out as a larger,
separable piece).

## 2. Affected files

- `packages/domain/src/anatomic-pathology.ts` — add
  `caseReportVersionListResponseSchema = z.object({ items: z.array(caseReportVersionSchema) })`
  + its inferred type, for the new list route below.
- `apps/api/src/case/case.controller.ts` — add `GET /v1/cases/:id/report-versions`: read-only,
  `JwtAuthGuard` + `TenantContextInterceptor` only (no capability gate, matching `getById`'s own
  precedent — viewing report-version metadata isn't a diagnostic action). Query
  `caseReportVersion` by `caseId`, order by `versionNumber` desc, map through the controller's
  existing `toCaseReportVersionDto`, return `{ items }`. `@ZodResponse({ type:
  CaseReportVersionListResponseDto, status: 200 })` so the frontend can use the typed `@lis/sdk`
  client (unlike `amend`/`finalize`, which have no `@ZodResponse` and stay on raw `fetch`, per
  §5).
- `apps/api/openapi.json` + `packages/sdk/src/schema.ts` — regenerated (new GET route only; no
  change to `amend`'s own undocumented shape).
- `apps/api/test/case.e2e-spec.ts` (or wherever existing case-lineage e2e tests live — confirm
  exact file during implementation) — new e2e case(s): the new list route returns versions ordered
  newest-first, correctly reflects `amendmentOf`/`supersededBy`/`status` after a real
  sign-out→amend→amend chain (reusing the same fixture shape the FEAT-059 e2e suite already
  built), and is reachable with only `JwtAuthGuard` (no capability needed) while still respecting
  tenant isolation via RLS.
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — when `caseData.status` is `signed_out` or
  `amended`, fetch `GET /v1/cases/{id}/report-versions` (typed client) and render a "Report
  versions" list (version number, `final`/`superseded` badge, signed-by role, signed-at
  timestamp, reason when present). Render `<AmendCaseForm caseId={id} />` in the same
  status-gated block, but only when `hasVerifierRole(session)` — mirrors `hasTechnologistRole`'s
  existing use in `apps/web/app/(app)/page.tsx` ("UI-visibility convenience only" caveat, real
  enforcement stays server-side). Requires fetching `getSession()` alongside the existing
  `getValidAccessToken()` call (same pair `apps/web/app/(app)/page.tsx` already fetches together).
- `apps/web/app/(app)/cases/[caseId]/amend-case-form.tsx` (new) — client component,
  `useActionState` + `FormField` wrapping a plain `<textarea>` for `reason` (no dedicated
  `Textarea` primitive exists in `@lis/ui` today — `FormField`'s `children` contract accepts any
  single element, confirmed by reading `form-field.tsx`), submit button "Submit amendment". Same
  shape as `upload-wsi-form.tsx`.
- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add `amendCase` server action: raw `fetch` to
  `${API_BASE_URL}/v1/cases/${caseId}/amend` (matching `uploadWholeSlideImage`'s own precedent —
  `amend` has no `@ZodResponse`, so its shape isn't in the generated SDK), `Authorization: Bearer
  ${accessToken}`, JSON body `{ reason }`. On a 403 whose body's `code` is `step_up_required` (the
  `ProblemDetailsFilter` shape `apps/api/src/common/problem-details.filter.ts` already produces),
  call `redirect(`/api/auth/login?step_up=1&rd=${encodeURIComponent(`/cases/${caseId}`)}`)` from
  `next/navigation` — this is the exact, already-built-but-never-wired-up mechanism
  `apps/web/app/api/auth/login/route.ts`'s own `step_up=1` branch exists for (confirmed live: zero
  existing callers anywhere in `apps/web` before this change). On a plain 403 (wrong role — should
  be unreachable given the UI gate, but the real enforcement point), return a permission error. On
  400 (wrong case state / empty reason), surface the message. On success, `revalidatePath` the
  case detail route (same precedent as `apps/web/app/(clinician)/clinician/actions.ts`'s own
  `acknowledgeCriticalNotification`) and return a "done" state so the version list re-renders with
  the new entry.
- `apps/web/app/(app)/cases/[caseId]/types.ts` (or inline in the new form file, matching whichever
  the existing `UploadWholeSlideImageState` convention uses) — new `AmendCaseState` type +
  `amendCaseInitialState`.

## 3. Architecture consulted

- ADR-0051 (`docs/plans/feat-059-sign-out-step-up-digital-signature.md`) — the amend/finalize
  step-up + digital-signature design this proposal builds a browser entry point for, not a
  redesign of.
- `apps/api/src/case/case.controller.ts` `amend()` (lines ~929-1038) and `finalize()` — confirmed
  the exact guard stack (`JwtAuthGuard, CapabilityGuard, StepUpGuard` / `verify` +
  `@RequireStepUp()`), the wrong-state 400 (`caseRow.status !== 'signed_out' && !== 'amended'`),
  and the audit-event shape directly in code.
- `apps/api/src/auth/step-up-required.exception.ts` — its own header comment claims "apps/web's
  own sign-out flow reacts to that specific code by redirecting into `/api/auth/login?step_up=1`"
  — **confirmed false by grep** (zero matches for `step_up_required` anywhere in `apps/web`
  today). This proposal is what makes that comment true for the first time, for `amend` (not
  `finalize` — no finalize UI exists yet, tracked separately under #610).
- `apps/web/app/api/auth/login/route.ts` — the real, already-implemented `step_up=1` →
  `prompt: 'login'` mechanism this proposal is the first real caller of.
- `apps/web/auth/safe-redirect.ts` — confirms a relative path like `/cases/{id}` is a valid `rd`
  value (same-origin-only allowlist).
- `apps/web/app/(app)/cases/[caseId]/upload-wsi-form.tsx` + `actions.ts` — the exact
  `useActionState`/raw-`fetch`-server-action pattern this proposal replicates for `amendCase`.
- `apps/web/auth/roles.ts` `hasVerifierRole` — existing, already-built role-visibility helper;
  reused, not reinvented.
- `apps/web/app/(clinician)/clinician/actions.ts` — `revalidatePath` precedent.

## 4. Skills loaded

- `engineering/frontend-design` (required — Affected Files add a new `apps/web` client component
  and form). Checked: no function-valued props cross the Server/Client boundary (`AmendCaseForm`
  takes only a plain `caseId: string` string prop, same as `UploadWsiForm`'s `slideId`); no new
  route/dynamic segment added (same `[caseId]` page), so the route-group/dynamic-segment-name
  collision entry doesn't apply.
- `engineering/api-design` (required — Affected Files add a new `apps/api` route). Checked entry
  #7 (RLS makes cross-tenant rows structurally invisible — the new list route relies on the same
  RLS-via-`TenantContextInterceptor` pattern `getById` already uses, no manual tenant filter
  needed) and entry #8 (`ZodValidationPipe`/DTO visibility under the test harness — the new route
  has no request body or query, only a `:id` path param already validated the same way `getById`
  validates it, so this entry's failure mode doesn't apply here).

## 5. Assumptions & autonomous decisions

- **No finalize/sign-out UI is added here.** The Amend action only ever renders for a case whose
  `status` is already `signed_out`/`amended` — reachable today via issue #613's own fix (the
  "Signed Out"/"Amended" Cases-list tabs) for any case finalized via the API. Building a browser
  "Sign out" action is issue #610's own broader, separately-scoped gap; conflating it here would
  violate #610's own "scope AP screens individually" recommendation that #615 was itself broken
  out under.
- **No content diff/comparison UI.** The version list shows metadata only (version number,
  status, signed-by, signed-at, reason) — matches `caseReportVersionSchema`'s own fields (no
  `includedContent` in that schema; the actual report body was never exposed via any DTO, not
  just omitted here). The issue's own text calls full diff rendering "a larger, separable piece."
- **The new list route is unauthenticated-by-capability (any tenant member with a valid session
  can view version metadata for a case they can already see via `getById`)** — matches `getById`'s
  own precedent exactly (no capability gate on read routes in this controller; only mutations are
  gated).
- **Amend form UX after a step-up redirect:** the user's typed `reason` is not preserved across
  the forced re-login round trip (a plain `redirect()` from the server action, not a client-side
  state stash). Acceptable per the issue's own "at minimum" framing — re-typing one sentence after
  a step-up prompt is a minor rough edge, not a blocking gap, and no existing precedent in this
  codebase preserves form state across a step-up redirect to build on.
- **No optimistic UI / auto-retry after step-up.** After the forced re-login redirect lands back
  on `/cases/:id`, the user clicks "Amend" again and resubmits — no attempt to auto-resume the
  original submission. Simpler and consistent with `rd` just being a plain return-to-this-page
  mechanism, not a request-replay mechanism.

## 6. Risks

- **Low-to-moderate.** The mutation itself (`amend`) is unchanged, already correct, and already
  covered by existing e2e tests — this proposal only adds a read route and UI wiring around it.
- The new GET route must not leak cross-tenant data — mitigated by relying on the same RLS
  mechanism `getById` already trusts (§3), not reimplementing tenant filtering.
- The step-up redirect is a genuinely new, first-ever exercised code path in `apps/web`
  (`step_up=1`) — real risk of a gap between what `step-up-required.exception.ts`'s header comment
  *claims* apps/web does and what it's ever actually tested doing. Mitigated by a live
  `web-verify` pass (§8) that actually drives an expired-step-up amend attempt through the real
  redirect, not just a code read.
- `ProblemDetailsFilter`'s exact JSON shape for the `code` field must be re-confirmed by reading
  the file directly during implementation (not just trusted from this proposal's own summary) —
  a wrong field name here means the redirect branch silently never fires, degrading to a generic
  error instead of the intended re-auth flow.

## 7. Acceptance criteria

1. A verifier viewing a `signed_out` or `amended` case sees a "Report versions" list and an
   "Amend" control; a technologist viewing the same case sees the version list but not the Amend
   control.
2. Submitting the Amend form with a valid `reason`, with a *fresh* step-up already established,
   creates a new version, flips the case to `amended`, and the version list updates to show it
   (newest first) without a full manual page reload.
3. Submitting with a *stale* step-up (the realistic default — no browser flow has ever minted a
   fresh one before this feature) redirects through `/api/auth/login?step_up=1`, forces real
   re-authentication, and lands back on the same case page.
4. Submitting with an empty `reason` shows a validation error, no request sent (or a clean 400
   surfaced if client-side validation is skipped — client-side `required` on the textarea is
   suffilient here, matching `upload-wsi-form.tsx`'s own `required` file input).
5. A case not yet `signed_out`/`amended` shows neither the version list nor the Amend control (no
   version rows exist yet to show, and amending would 400 anyway).
6. No change to `finalize()`, `amend()`'s own business logic, or any existing e2e assertion.

## 8. Testing plan

- New `apps/api` e2e case(s) for the list route (§2) — status, tenant isolation, ordering,
  correct reflection of a real chained-amendment fixture.
- No new `apps/web` automated tests (this route/page has none today, matching every sibling AP
  page — same reasoning issue #613's own Implementation Proposal already used).
- Manual/browser verification (`web-verify` Skill), the one that actually matters most here given
  §6's flagged risk: mint a verifier session with a *stale* `auth_time` (i.e., don't re-mint right
  before this step), open an already-`signed_out` case, click Amend, submit a reason, and confirm
  the real redirect to Keycloak's login page fires, re-authenticating actually returns to
  `/cases/:id`, and a second submit attempt then succeeds. Also verify the technologist-hidden
  case and the non-terminal-status-hidden case per AC #1/#5.

## 9. Rollback plan

Revert the commit(s). The new GET route and its OpenAPI/SDK regeneration are additive (no schema
migration, no existing route changed) — a plain `git revert` fully restores prior behavior with no
data cleanup needed.

## 10. Questions requiring human approval

1. Confirm the "no finalize/sign-out UI, Amend only appears on already-signed-out cases" scope
   boundary (§5) — i.e., this proposal deliberately does NOT make it possible to reach
   `signed_out` status through the browser at all, only to amend a case that's already there via
   API or a future #610 screen.
2. Confirm the version-list is metadata-only (no content diff/comparison) is acceptable for this
   pass, with full diff rendering left as a future, separately-scoped enhancement.
