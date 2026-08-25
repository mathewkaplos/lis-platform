# Implementation Proposal: Standardize permission-denied (403) error handling across `apps/web`
Status: APPROVED
ADR: none    Date: 2026-08-25    Backlog ID: issue #751 (lis-platform, part of #697)

**Approved 2026-08-25 (revision)** via the native options-prompt (accepted as revised — all 4 §12
questions accepted at their recommended defaults: fix the 10 listed instances now, amend PR #757
in place, add a `frontend-design` Skill entry, file a separate issue for the codebase-wide
session-expired/redaction problem).

**Revision history:**
- 2026-08-25 (original): approved and partially implemented (PR #757, 4 pages fixed:
  `culture-reads`, `billing/facility-statement`, `clinician`, `clinician/patients/[patientId]/results`).
- 2026-08-25 (this revision): PR #757's own new CI run (`web-e2e`, a real production build) failed
  in a way that revealed the entire premise of the original proposal's §3 "Architecture consulted"
  reference pattern doesn't actually work in production — see §1 below. This revision replaces the
  fix shape and expands the affected-file list; **PR #757 has not been merged.**

## 1. Goal — and the real root cause found mid-implementation

Every `apps/web` page whose data comes from a real, capability-gated `apps/api` route (or a
client-side role check) should show a specific, friendly "You do not have permission to..."
message when a wrong-role user reaches it — not a generic retry message, not an unhandled
exception, and (the new finding this revision exists for) **not Next.js's own generic
production-redaction text**.

**The real bug, confirmed via a real CI production-build failure, not assumed:** this repo's
established convention for a "specific" error message — `throw new Error('You do not have
permission to...')` inside a Server Component page, caught by a same-directory or ancestor
`error.tsx` Client Component rendering `error.message` — does not work in a real production
build. Next.js's App Router deliberately strips the `message` of any error thrown during a Server
Component's render before it crosses to the client, in *every* production build, with no
project-level opt-out — replacing it with: *"An error occurred in the Server Components render.
The specific message is omitted in production builds to avoid leaking sensitive details."* Only
`error.digest` survives. This is not specific to a 403 check; it applies to **any** `throw new
Error(...)` inside a page's Server Component body, including this codebase's own near-universal
`'Your session has expired — please log in again.'` throw.

This was never caught before because every manual verification of these screens in this project's
history used `pnpm dev` (Next's dev server does not redact), and no CI end-to-end test ever
asserted on the literal rendered text of one of these messages until this task's own new
`e2e/permission-denied.spec.ts` did — it failed on exactly this, in CI's real production-build
`web-e2e` job (`playwright.config.ts`'s own comment already documents CI runs `next build` +
the standalone server, not `next dev`).

**The one pattern in this codebase that actually survives a production build:**
`apps/web/app/(app)/admin/users/page.tsx`'s inline conditional render — it never throws; on a 403
it returns a specific message directly from the Server Component's own JSX, which is not subject
to the error-boundary serialization path at all. What the original proposal flagged as "the odd
one out, worth a decision" is, in fact, the only one of the bunch that has ever actually worked in
a real deployment.

## 2. Scope of this revision — bounded deliberately, not "fix every throw in the app"

The redaction mechanism affects *every* `throw new Error(...)` in *every* `apps/web` page.tsx,
including the ubiquitous "session expired" message. Fixing all of that is a much larger,
codebase-wide change than issue #751 (which is specifically about permission-denied handling).
**This revision's scope stays bounded to permission-denied (403 / role-check) messages only** —
the session-expired throw and any other non-permission generic-failure throw are explicitly out of
scope here, to be filed as a separate issue/proposal (§10 Q4) rather than folded in silently.

## 3. Affected files (revised — 10 real instances, not 4)

Every instance below is a **real, reachable** permission-denied condition (confirmed against the
actual backing route's `@RequireCapability` decorator, or an actual client-side role-check
function, not assumed) whose message is currently swallowed by Next's production redaction. Each
gets converted from throw+`error.tsx` to an inline conditional render, matching
`admin/users/page.tsx`'s own proven-working shape.

1. `apps/web/app/(app)/billing/invoices/page.tsx` — `GET /v1/invoices` (`manage_billing`).
   Pre-existing (not part of PR #757); this proposal's own original "reference implementation" —
   confirmed broken in production by this revision's audit.
2. `apps/web/app/(app)/billing/invoices/[invoiceId]/page.tsx` — `GET /v1/invoices/:id`
   (`manage_billing`). Pre-existing, same situation as #1.
3. `apps/web/app/(app)/billing/facility-statement/page.tsx` — `GET /v1/invoices`
   (`manage_billing`). Added in PR #757 (this revision fixes it properly instead of merging as-is).
4. `apps/web/app/(app)/culture-reads/page.tsx` — `GET /v1/culture-reads` (`enter_result`). Added
   in PR #757.
5. `apps/web/app/(clinician)/clinician/page.tsx` — `GET /v1/clinician/patients`
   (`view_related_patient_results`). Added in PR #757.
6. `apps/web/app/(clinician)/clinician/patients/[patientId]/results/page.tsx` —
   `GET /v1/clinician/patients/{patientId}/results` (same capability). Added in PR #757.
7. `apps/web/app/(app)/cases/[caseId]/slides/[slideId]/viewer/page.tsx` —
   `GET /v1/whole-slide-images/:id` (`manage_specimens`). Pre-existing; the original proposal
   incorrectly classified this as "already correct, out of scope" by checking only its case-fetch
   403 branch (dead code — `cases/:id` is ungated) and missing that its *second* 403 branch, on the
   WSI-image fetch, is real and reachable.
8. `apps/web/app/(app)/cases/[caseId]/synoptic/[partId]/page.tsx` — a client-side
   `hasSpecimenManagementRole(session)` check, not an API 403 (its own API-response 403 branch is
   dead code — same ungated-`cases/:id` reason as #7's misclassified branch). The role-check throw
   itself still executes inside the Server Component's render, so it is still redacted.
9. `apps/web/app/(app)/cases/new/page.tsx` — same `hasSpecimenManagementRole(session)` client-side
   check pattern as #8.
10. `apps/web/app/(portal)/portal/results/page.tsx` — `GET /v1/portal/results`
    (`view_own_results`). Pre-existing.

**Explicitly still out of scope** (re-confirmed, unchanged from the original proposal): every page
calling a genuinely ungated route (`orders/[id]`, `worklist`, `catalog`, `referring-facilities`
list, `reference-ranges` list, `report-templates` list, `qc-rule-violations` list,
`specimens/:id/label`, `org-settings` GET, `patients/:id` GET, `cases` list, `cases/:id` GET,
`control-lots/:id/chart`, `synoptic-protocols` list/versions) — a 403 cannot actually happen on
their load, so their existing (dead-code) 403 branches are left untouched; converting genuinely
unreachable code is not this task's job. The session-expired throw and other non-permission
generic-failure messages across the app (§2) are also out of scope, filed separately per §10 Q4.

## 4. The fix shape (revised from "add a 403 branch" to "don't throw at all")

For each of the 10 pages in §3: replace the `response.status === 403` (or role-check) branch's
`throw new Error(...)` with an early `return <specific JSX>` directly from the page component,
matching `admin/users/page.tsx`'s own shape — a `role="alert"` block with the specific message,
rendered inline, no `error.tsx` involved. Where a page's existing layout has meaningful
surrounding chrome (a page title, nav breadcrumb) that should still render even on a 403 (as
`admin/users/page.tsx` itself does — the "Users" heading stays visible above the message), match
that same partial-layout shape rather than returning a completely bare message.

**Consequence for the two new `error.tsx` files PR #757 already added**
(`culture-reads/error.tsx`, `billing/facility-statement/error.tsx`): keep them — they still
correctly catch genuine unexpected failures (a real `!response.ok` on a non-403 error, or any
other real exception), which *should* still show Next's generic-but-honest fallback text since
those really are cases where the specific server-side detail is appropriately not leaked to the
client. Only the *permission-denied* path changes; the generic-failure throw stays as-is
everywhere (§2's own scope boundary).

## 5. Architecture consulted

- `apps/web/app/(app)/admin/users/page.tsx` — now the sole reference implementation (revised from
  the original proposal, which cited `billing/invoices`/`cases` instead — both now confirmed
  broken).
- Next.js App Router error-handling docs' own documented behavior (message redaction on Server
  Component throws in production, digest-only) — matches this task's own live CI failure
  character-for-character (`error-context.md` from the failed `web-e2e` run, PR #757, contains the
  exact redaction text quoted in §1).

## 6. Skills loaded

- `engineering/frontend-design` — re-consulted; still has no entry on error-boundary/production-
  redaction behavior. **Recommended as a new entry once this task ships** (§10 Q3) — this is
  exactly the kind of hard-won, non-obvious, only-caught-by-a-real-production-build lesson that
  Skill exists to capture, and the original proposal's own mistake (citing two now-confirmed-broken
  pages as "the reference implementation") is a direct, concrete demonstration of the cost of not
  having it written down.

## 7. Assumptions & autonomous decisions

- Scope stays bounded to permission-denied messages only (§2) — not a full audit-and-fix of every
  `throw new Error(...)` in `apps/web`, even though the same redaction mechanism affects all of
  them. A codebase-wide fix is real, valuable follow-up work, not something to fold into an issue
  titled "permission-denied error handling" without its own separate scoping.
- The two `error.tsx` files PR #757 already added stay, now scoped correctly to genuine
  (non-permission) failures only, not removed — no wasted work from the partial implementation.
- No change to actual authorization anywhere in this revision either — same as the original
  proposal, this is presentation-layer only.

## 8. Risks

- Slightly larger blast radius than the original proposal (10 files vs. 4), but each change is the
  same small, mechanical shape (replace a throw with an inline return) with no schema/API/
  authorization change — risk profile is still low.
- Real risk of *not* catching a similar redaction issue elsewhere if the fix is applied
  mechanically without re-testing: the new/updated e2e coverage (§9) is the actual proof this time,
  not a visual dev-mode check — CI's production build is the one that matters, per this whole
  revision's own root cause.

## 9. Acceptance criteria

- A wrong-role/unauthenticated-for-this-resource user hitting any of the 10 pages in §3 sees the
  specific "You do not have permission to..." message in a **real production build** — proven by
  an e2e assertion that passes in CI (`web-e2e`, which already runs `next build` + standalone
  server), not just visually in `pnpm dev`.
- No regression to any of the confirmed-out-of-scope (ungated) pages.
- `admin/users/page.tsx` itself is unchanged (still the reference pattern, not touched by this
  task, per the original proposal's §10 Q1 — unaffected by this revision).

## 10. Testing plan

- `apps/api`: none — no backend change.
- `apps/web`: extend the already-written `e2e/permission-denied.spec.ts` (currently covers
  `culture-reads` only, and is what caught this bug) to also cover at least one pre-existing page
  now being fixed for the first time (recommend `billing/invoices`, since it's the issue's own
  originally-cited example) — proving the fix actually works in CI's production build, the same
  environment that caught the original bug. Real login as a role lacking the relevant capability,
  real navigation, assert the specific message text is visible.
- This spec must pass in CI before merge — a local `pnpm dev` check is not sufficient proof for
  this specific class of bug, confirmed by this revision's own root cause.

## 11. Rollback plan

Revert the PR. Every change is a like-for-like replacement of a throw with an inline return — no
schema/API change, no data/migration concern. `culture-reads/error.tsx` and
`billing/facility-statement/error.tsx` (added in PR #757, kept in this revision) revert cleanly
too since they're still valid for genuine non-permission failures.

## 12. Questions requiring human approval

1. **Confirm the scope boundary in §2/§3** — fix the 10 listed permission-denied instances now,
   leave the (much larger) "every thrown Error is redacted in production" problem for a separate
   issue? **Recommended: yes**, exactly as scoped.
2. **PR #757** — amend it in place with this revised fix (replacing the throw+`error.tsx` branches
   it added for its 4 pages with inline returns, plus adding the other 6 pre-existing broken
   pages), or close it and open a fresh PR? **Recommended: amend in place** — same branch, same
   issue, no functional work is wasted (the two new `error.tsx` files stay correct for their
   narrowed purpose).
3. **Add a `frontend-design` Skill entry** documenting this redaction behavior, so no future task
   repeats the original proposal's own mistake of citing a throw+`error.tsx` page as a correct
   reference? **Recommended: yes** — cheap, and this task is living proof of the cost of not having
   it.
4. **File a separate issue** for the codebase-wide "every thrown Server Component error is
   redacted in production, including 'session expired'" finding, scoped explicitly out of this
   task? **Recommended: yes** — real, but a materially larger change than issue #751's own subject,
   deserving its own proposal rather than scope-creeping this one further.
