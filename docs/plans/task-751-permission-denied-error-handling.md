# Implementation Proposal: Standardize permission-denied (403) error handling across `apps/web`
Status: DRAFT
ADR: none    Date: 2026-08-25    Backlog ID: issue #751 (lis-platform, part of #697)

## 1. Goal

Every `apps/web` page whose data comes from a real, capability-gated `apps/api` route should show
a specific, friendly "You do not have permission to view/manage X" message when a wrong-role user
reaches it (stale bookmark, direct URL, a role change) — not a generic "Something went wrong,
please try again" (misleading: implies a transient, retryable failure) and not an unhandled
exception falling through to Next's default error screen.

**Correction to the issue's own named example, found during this proposal's audit — not carried
forward silently:** `/billing/invoices` (issue #751's one concretely cited instance) already has
correct handling — a specific `response.status === 403` check (`throw new Error('You do not have
permission to view invoices.')`) plus its own `error.tsx` boundary. This was fixed in an earlier
session (`billing/invoices/error.tsx`'s own header comment cites "TASK-044 pattern"), before this
issue was filed by the pilot-readiness audit — the audit's finding was accurate when written but
is now stale for that one specific page. The real remaining gap, confirmed by auditing every page
in `apps/web/app` against its actual backing route's `@RequireCapability` decorator (not assumed
from the issue text), is narrower and in different places than described.

## 2. Affected files

Confirmed by reading every `apps/web` page's backing `apps/api` route source directly (grep for
`@RequireCapability` on the specific `GET` method each page calls, not the controller class as a
whole — several controllers gate only their mutating routes and leave `GET`/`list` open to any
authenticated user). Pages calling an **ungated** route (`orders/[id]`, `worklist`, `catalog`,
`referring-facilities` list, `reference-ranges` list, `report-templates` list, `qc-rule-violations`
list, `specimens/:id/label`, `org-settings` GET, `patients/:id` GET) are correctly out of scope — a
403 cannot actually happen on their load, so no error-message work is needed there. Two pages
already throw a specific 403 message and are covered by an *ancestor* `error.tsx` via Next.js's
own boundary-inheritance (`cases/[caseId]/synoptic/[partId]/page.tsx` and
`cases/[caseId]/slides/[slideId]/viewer/page.tsx`, both inheriting `cases/[caseId]/error.tsx`,
whose own header comment already documents this deliberately) — also out of scope, no change
needed.

**Real gaps (4 pages, all currently fall through to a generic "Something went wrong" message on a
real 403):**
- `apps/web/app/(app)/culture-reads/page.tsx` — backing route `GET /v1/culture-reads`
  (`enter_result`-gated). No `error.tsx` exists anywhere in this page's ancestor chain — needs a
  new `apps/web/app/(app)/culture-reads/error.tsx` (same `'use client'`/`role="alert"`/`Try again`
  shape as `cases/error.tsx`) plus a `response.status === 403` branch in `page.tsx`.
- `apps/web/app/(app)/billing/facility-statement/page.tsx` — backing route `GET /v1/invoices`
  (`manage_billing`-gated; the same page's separate `GET /v1/referring-facilities` fetch is
  ungated and needs no change). No `error.tsx` exists in this page's ancestor chain (the sibling
  `billing/invoices/error.tsx` is scoped to its own directory only) — needs a new
  `apps/web/app/(app)/billing/facility-statement/error.tsx` plus a 403 branch on the invoices
  fetch specifically.
- `apps/web/app/(clinician)/clinician/page.tsx` — backing route `GET /v1/clinician/patients`
  (`view_related_patient_results`-gated). `apps/web/app/(clinician)/error.tsx` already exists and
  already renders `error.message` correctly — only the missing 403 branch in `page.tsx` is needed,
  no new boundary file.
- `apps/web/app/(clinician)/clinician/patients/[patientId]/results/page.tsx` — backing route
  `GET /v1/clinician/patients/{patientId}/results` (same capability). Same situation: the
  `(clinician)/error.tsx` boundary already exists and works; only the missing 403 branch is
  needed.

**One inconsistency, not a gap (needs a decision, §10 Q1):**
- `apps/web/app/(app)/admin/users/page.tsx` — backing route `GET /v1/users`
  (`manage_users`-gated) already handles 403 correctly in the sense that a wrong-role user sees a
  specific, friendly message — but via a third, different pattern (an inline conditional
  early-return render inside the page component itself) rather than the throw-and-let-the-boundary-
  catch-it convention every other gated page in this audit uses. Functionally fine today; flagged
  because "three different shapes for the same problem" is exactly the "reads as unfinished"
  concern the issue itself raises, and a future page copying whichever one it finds first will
  keep the inconsistency alive.

## 3. Architecture consulted

- `apps/web/app/(app)/billing/invoices/page.tsx` + `error.tsx`, and
  `apps/web/app/(app)/cases/page.tsx` + `cases/[caseId]/error.tsx` — the two clean, already-correct
  reference implementations this proposal standardizes on. Both share the exact same three-part
  shape: (1) a `response.status === 403` check in the Server Component page, throwing
  `new Error('You do not have permission to <specific action>.')`; (2) a same-directory (or, for
  a nested route with no route-specific concern of its own, a deliberately inherited ancestor)
  `'use client'` `error.tsx` rendering `error.message` inside a `role="alert"` block with a
  `Try again` button calling `reset()`; (3) every other (non-403) failure still throws a generic
  "Something went wrong... Please try again." message, left unchanged.
- `apps/api/src/auth/capabilities.ts` and each affected route's own controller file — read
  directly to confirm which `GET` routes are actually capability-gated, per this proposal's own
  §2 correction of the issue's scope.

## 4. Skills loaded

- `engineering/frontend-design` (required per the `plan` Skill's own rule — this task's Affected
  Files are all `apps/web` pages/components). No entry in it currently covers error-boundary
  conventions specifically; nothing in this task's shape conflicts with any of its 12 entries
  (no new `packages/ui` primitive, no client-only-library import, no route-group/dynamic-segment
  naming collision — this only ever adds a conditional branch to already-working Server Component
  pages and, where missing, a copy of the existing `error.tsx` shape).
- `engineering/api-design` intentionally **not** loaded — no new/changed `apps/api` route in this
  task's scope (every backing route already exists and is already correctly gated; this is a
  pure `apps/web` presentation-layer fix).

## 5. Assumptions & autonomous decisions

- The fix is additive/presentational only — no change to actual authorization anywhere. The API's
  own `CapabilityGuard` remains the sole real enforcement point, exactly as the issue's own
  acceptance criteria states ("No change to actual authorization — this is UI-layer only").
- Each new `error.tsx` copies the exact existing shape (`'use client'`, `role="alert"`, `error.message
  || '<generic fallback>'`, a `Try again` button calling `reset()`) rather than introducing a new
  shared component for it — three near-identical existing files (`cases/error.tsx`,
  `billing/invoices/error.tsx`, `(clinician)/error.tsx`) already established this as copy-paste
  boilerplate, not a pattern crying out for extraction; a shared `<PermissionErrorBoundary>`
  component is a plausible future cleanup but out of scope for this task specifically (see §10 Q2).
- `billing/facility-statement/page.tsx`'s existing `referring-facilities` fetch is left untouched
  (confirmed ungated — a 403 there is not a reachable real-world outcome).

## 6. Risks

- Low. No schema change, no new API route, no change to any capability grant. The only real risk
  is scope creep into pages this audit confirmed are out of scope (ungated routes) — the Affected
  Files list in §2 is the actual boundary, not the issue's own broader "audit every page" framing.
- The `admin/users` decision (§10 Q1) determines whether this task also touches a page that
  already works correctly today — worth getting right rather than reflexively "fixing" something
  that isn't broken.

## 7. Acceptance criteria

- A `view`-only/wrong-role user hitting `culture-reads`, `billing/facility-statement`,
  `clinician`, or `clinician/patients/[patientId]/results` directly sees a specific "You do not
  have permission to..." message, not a generic retry message and not a crash.
- No regression to any of the already-correct pages (`billing/invoices`, `cases`,
  `cases/[caseId]`, `cases/[caseId]/synoptic/[partId]`, `cases/[caseId]/slides/[slideId]/viewer`,
  `admin/users`).
- No change in behavior for any ungated page/route confirmed out of scope in §2.

## 8. Testing plan

- `apps/api`: none needed — no backend change.
- `apps/web`: a new or extended Playwright e2e spec proving at least one of the four fixed pages
  (recommend `culture-reads`, the simplest single-fetch case) renders the specific permission
  message for a role lacking the relevant capability, matching the existing pattern
  `case-report-email.spec.ts`/`admin-crud.spec.ts` already use for role-gated real-browser checks
  — real login as a role without the capability, real navigation, assert the specific message
  text is visible (not just that *some* error rendered).
- Manual/visual: light + dark mode check on the new `error.tsx` files (this repo's Storybook a11y
  CI doesn't cover ad-hoc page-level error states), same class of check flagged as a Manual
  Verification item in this session's own `/close` report for the previous task.

## 9. Rollback plan

Revert the PR. Every change is additive (new files, new conditional branches) with no schema/API
change and no altered authorization behavior — a plain revert fully restores prior behavior with
no data or migration concerns.

## 10. Questions requiring human approval

1. **`admin/users/page.tsx`'s inline-render 403 pattern** — standardize it to match the
   throw-and-boundary convention everywhere else (small refactor, removes the third inconsistent
   shape entirely), or leave it as-is since it already works correctly and isn't the issue's own
   named example? **Recommended: leave it as-is** — it functions correctly today, and refactoring
   working code that isn't the actual reported problem risks introducing a regression for no
   user-visible benefit; note the inconsistency in a code comment instead, for whoever next adds a
   gated page to pick either established pattern deliberately rather than by accident.
2. **A shared `<PermissionErrorBoundary>` component**, extracting the now-four-times-repeated
   `error.tsx` shape into `packages/ui`, instead of copy-pasting a fifth/sixth near-identical file?
   **Recommended: no, not in this task** — four small, independent files is not yet the "three
   strikes" signal this repo's own Skills use to justify extraction (see `frontend-design` entry
   #1's own `StatusPill` precedent, which waited for a real second consumer with divergent needs
   before generalizing); revisit if a fifth gated page needs the same shape after this task ships.
3. **Should the fix also leave a comment on issue #751 clarifying that `billing/invoices` was
   already fixed and the real scope is narrower than originally filed?** Recommended: yes, a short
   factual comment when the PR opens — keeps the issue's own history accurate for anyone reading
   it later, matching this project's own "no single status signal is self-verifying" discipline.
