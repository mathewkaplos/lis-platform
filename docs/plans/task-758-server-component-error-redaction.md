# Implementation Proposal: Convert remaining redacted Server Component error throws to inline returns
Status: APPROVED
ADR: none    Date: 2026-08-26    Backlog ID: issue #758 (lis-platform, part of #697)

**Approved 2026-08-26** via the native options-prompt — all 3 §10 questions accepted at their
recommended defaults: both session-expired and generic-failure throws fixed in one pass;
`admin/users/page.tsx`'s own session-expired throw included despite its 403 branch already being
correct; a new `session-expired.spec.ts` rather than extending `permission-denied.spec.ts`.

## 1. Goal

Next.js's App Router strips the `message` (and `stack`) of any error thrown during a Server
Component's render before it reaches the client, in every real production build — replacing it
with a fixed generic string, keeping only `error.digest`. Issue #751 found and fixed this for the
10 real, reachable *permission-denied* throws in `apps/web` (`docs/plans/task-751-permission-
denied-error-handling.md`), converting each to an inline conditional `return` — the one pattern in
this codebase (`admin/users/page.tsx`'s original 403 branch) that actually survives a production
build. #751 deliberately left everything else out of scope, most notably the near-universal
`'Your session has expired — please log in again.'` throw.

This task closes that gap: every remaining `throw new Error('<specific message>')` inside a Server
Component page body gets converted to the same inline-return shape, so a user who hits any of
these conditions sees the actual intended message in production, not Next's generic fallback.

## 2. Affected files

Confirmed by direct grep (`grep -rn "throw new Error(" app --include="page.tsx"`), re-run against
the current tree (post-#751/PR #757 merge), not assumed from the issue body's estimate:

- **92 total `throw new Error(...)` sites** across `apps/web/app/**/page.tsx`.
- **34 are the session-expired throw** (`'Your session has expired — please log in again.'`),
  one per page, across **33 page.tsx files** (every page that calls `getValidAccessToken()` and
  checks for a null token) — see §10 Q1 for phasing.
- **54 are generic-failure throws** (`'Something went wrong loading X. Please try again.'`,
  X varying per page/resource) — see §10 Q1.
- **4 are pre-existing permission-denied throws deliberately left as dead code by #751** (the
  `cases`/`cases/[caseId]` family's own ungated-route exclusions, §3 of `task-751-...md`) — *not*
  touched by this task either; still genuinely unreachable, converting unreachable code isn't this
  task's job.

Full file list (33 files with the session-expired throw — every file also appears in the 92-site
list above with its own additional generic-failure throw(s), except where noted):

`admin/org-settings`, `admin/reference-ranges`, `admin/referring-facilities`,
`admin/report-templates`, `admin/report-templates/[testDefinitionId]`, `admin/tests`,
`admin/users` (already the reference pattern for its own 403 branch, but its session-expired throw
is unconverted), `billing/facility-statement`, `billing/invoices`, `billing/invoices/[invoiceId]`,
`cases/new`, `cases/page` (session-expired only — its own permission-denied throw stays dead code
per #751), `cases/[caseId]` (same), `cases/[caseId]/slides/[slideId]/viewer` (same),
`cases/[caseId]/synoptic/[partId]` (same), `collection-queue`, `control-lots/[id]/chart`,
`culture-reads`, `orders/new`, `orders/page`, `orders/[id]`, `orders/[id]/report/[orderedTestId]`,
`orders/[id]/results`, `(app)/page` (dashboard), `patients/page`, `patients/[id]/edit`,
`patients/[id]`, `qc-violations`, `reception`, `specimens/[id]/label`,
`(clinician)/clinician/orders/new`, `(clinician)/clinician/page`,
`(clinician)/clinician/patients/[patientId]/results`, `(portal)/portal/results`.

## 3. Architecture consulted

- `apps/web/app/(app)/admin/users/page.tsx` — the proven-working inline-return shape (unchanged
  by #751, still the reference implementation).
- `apps/web/app/(app)/cases/[caseId]/slides/[slideId]/viewer/page.tsx`'s WSI-fetch 403 branch —
  #751's own most recently landed example of the exact conversion this task repeats, including its
  code comment citing issue #751 (a template for this task's own comment on each converted site).
- `docs/plans/task-751-permission-denied-error-handling.md` — direct precedent for both the fix
  shape and the proposal structure.

## 4. Skills loaded

- `engineering/frontend-design` entry #12 — the redaction behavior itself, the root cause, and the
  one surviving pattern. This task is exactly the follow-up work that entry's own "not yet covered"
  framing anticipated.
- `engineering/testing` — for extending `web-e2e` coverage per §8, since the proof standard here
  (a real production build, not `pnpm dev`) is unusual enough to be worth reconfirming before
  writing new specs.

## 5. Assumptions & autonomous decisions

- No behavior change to *which* condition produces which message — only *how* each message reaches
  the client (throw+`error.tsx` → inline return). No new copy is introduced; existing message text
  is reused verbatim.
- Where a page's existing layout has meaningful chrome that should still render on the error path
  (a heading, breadcrumb), the converted return matches `admin/users/page.tsx`'s own partial-layout
  shape rather than a completely bare message — same rule #751 already established.
- Each conversion gets a short comment citing issue #758 (or #751, where the exact wording already
  exists) explaining *why* this isn't a plain throw, matching the precedent already in
  `cases/[caseId]/slides/[slideId]/viewer/page.tsx` — this is a real, non-obvious constraint a
  future edit could easily reintroduce without the comment.
- Pages whose only throws are already-dead-code permission-denied branches (the 4 sites #751 left
  alone) are untouched by this task — different concern, already correctly scoped as unreachable.

## 6. Risks

- **Volume, not novelty.** ~33-88 individual small edits (depending on §10 Q1's scope decision), each
  the same mechanical shape already proven safe by #751 — the risk is missing one or introducing an
  inconsistent message/layout shape across so many files, not the technique itself.
- **The proof standard is the same trap #751 hit once already:** a local `pnpm dev` check will not
  catch a regression here — Next only redacts in a real production build. Every converted page must
  be re-verified against CI's `web-e2e` job (real `next build` + standalone server), not visually in
  dev mode.
- Some generic-failure messages are already fairly close to what Next's own redacted fallback says
  (e.g. "Something went wrong... Please try again." vs. Next's "An error occurred... Please try
  again" equivalent) — converting these has lower user-visible impact than the session-expired
  throw, which is the issue's own stated reasoning for treating it as lower priority, not skippable
  by default (see §10 Q1).

## 7. Acceptance criteria

(from issue #758, verbatim)
- No `apps/web` page.tsx throws a specific, user-facing message inside its own Server Component
  render — either it doesn't throw (inline return) or the message genuinely doesn't matter (a true
  "something unexpected happened" case, where Next's own generic fallback is an acceptable, honest
  answer).
- At least one new/extended e2e assertion proves the session-expired message renders correctly in a
  real production build (CI's `web-e2e` job), the same proof standard #751 established.

## 8. Testing plan

- `apps/api`: none — no backend change.
- `apps/web`: new `e2e/session-expired.spec.ts` (or extend `e2e/permission-denied.spec.ts` if a
  shared session-invalidation helper already exists there) — force an expired/invalid access token
  against at least one converted page (recommend the dashboard, `(app)/page.tsx`, as the
  highest-traffic entry point) and assert the specific "Your session has expired — please log in
  again." text is visible, not Next's generic fallback. Must pass in CI's `web-e2e` job specifically
  (real `next build` + standalone server) — a local `pnpm dev` pass is not sufficient proof, per
  #751's own root-cause finding.
- If §10 Q1 scopes in the generic-failure throws too: at least one additional e2e assertion per
  distinct message-producing code path is impractical at this volume; instead, a manual/structural
  review (grep confirming zero remaining `throw new Error('<specific text>')` outside the
  genuinely-dead-code exclusions) stands in as the acceptance proof for that portion, with the
  session-expired e2e spec as the one hard CI gate.

## 9. Rollback plan

Revert the PR. Every change is a like-for-like replacement of a throw with an inline return, reusing
existing message text — no schema/API/data change, no migration concern.

## 10. Questions requiring human approval

1. **Scope: session-expired only, or session-expired + all generic-failure throws?** The issue's
   own text prioritizes session-expired but does not exclude the generic ones, and its acceptance
   criteria literally requires "no page.tsx throws a specific, user-facing message" unless the
   message "genuinely doesn't matter." **Recommended: both, in one pass** — the generic throws are
   the exact same one-line mechanical conversion already being made file-by-file for the
   session-expired throw in the same 33 files, so doing both together avoids opening a third
   near-identical follow-up issue for the remaining 54 sites later, at negligible extra risk.
2. **`admin/users/page.tsx`'s own session-expired throw** — included in this task's scope even
   though the file is otherwise the untouched reference pattern (its 403 branch already correct)?
   **Recommended: yes** — the file's 403 branch being correct doesn't make its separate
   session-expired throw exempt from the same production-redaction bug; leaving it out would be an
   inconsistent, arbitrary carve-out.
3. **New e2e spec file vs. extending the existing `permission-denied.spec.ts`?** **Recommended: new
   `session-expired.spec.ts`** — the session-expired condition is orthogonal to permission-denied
   (a missing/invalid token vs. a valid token lacking a capability), and keeping them in separate
   spec files matches this repo's existing one-concern-per-spec convention rather than growing an
   unrelated concern into an existing file.
