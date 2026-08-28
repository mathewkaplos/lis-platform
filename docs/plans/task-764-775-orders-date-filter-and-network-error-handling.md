# Implementation Proposal: Orders createdTo date-filter fix (#764) + form network-error handling (#775)
Status: APPROVED
ADR: none    Date: 2026-08-28    Backlog ID: TASK-764 / TASK-775

## 1. Goal

Close the last two open findings from the M14 pilot-readiness audit (both filed session 47, both
still open, neither covered by PRs #777-#782/#790/#791):

- **#764** — `/orders`'s `createdTo` date filter, when queried directly against the API with a
  bare date or a non-conforming timestamp, behaves incorrectly (excludes same-day results, or
  500s on a hand-built end-of-day timestamp).
- **#775** — any Server Action's outbound API call that fails with a network-level error (API
  process unreachable, connection refused) — as opposed to the API responding with an HTTP error
  status — is not caught, so it bubbles up to Next.js's generic `error.tsx` crash screen instead
  of a friendly, in-place "connection lost" message.

## 2. Affected files

- `apps/api/src/order/order.controller.ts` — `createdFrom`/`createdTo` query handling (§6, item 1).
- `packages/domain/src/order.ts` — `createdFrom`/`createdTo` schema (§6, item 1; same pattern also
  used by `packages/domain/src/billing.ts` and `packages/domain/src/worklist.ts` — see §5 Q1 for
  whether this proposal's fix extends to those two as well).
- All 22 `apps/web/app/**/actions.ts` files (§6, item 2) — see §5 Q2 for the scope decision this
  proposal needs approval on before implementation starts.
- New: a shared helper (exact location TBD by whichever answer to §5 Q2 lands) wrapping a
  `client.POST`/`PUT`/`DELETE` call and converting a thrown network error into the same
  `{ status: 'error', formError: '...' }` shape every `actions.ts` file already returns for an
  HTTP-level error.

## 3. Architecture consulted

- `docs/pilot/PILOT-USER-GUIDE.md` §17 (Search/Worklists — #764's own write-up) and §20
  (Error/Recovery Testing — #775's own write-up), both cited directly in the issues' "Evidence"
  sections.
- Issue #768 / PR #779 — the existing precedent for adding a `response.status === 403` branch
  across every `actions.ts` file missing one. This proposal's #775 fix is the same shape of
  change (a missing-branch sweep across the same file set), for a different failure mode (a
  thrown exception, not a non-2xx response).
- ADR-0013 (`api-design` Skill entries #2/#8) — RFC 9457 error responses and the
  explicit-schema-at-call-site convention; neither is disturbed by this fix, since #775's gap is
  entirely on the `apps/web` side (a thrown `fetch` error, before any response body exists to
  parse) and #764's fix stays within the existing Zod-schema-drives-validation pattern.

## 4. Skills loaded

- `engineering/api-design` — required per the `plan` Skill's own rule ("regardless of whether the
  issue names it") since #764 touches an existing `apps/api` route's query handling. Entry #8
  (explicit-schema validation) and entry #2 (RFC 9457 errors) both apply directly.
- `engineering/frontend-design` — required per the same rule for #775, which touches every
  `apps/web` Server Action. No single numbered entry covers this exact gap (closest is entry #8,
  a different `'use server'` pitfall) — noted here as a candidate for a new entry once this ships
  (see §9 rollback/follow-up).
- `engineering/database-design` — not required; no schema/migration change in this proposal.

## 5. Assumptions & autonomous decisions

- **#764's root cause is not yet fully confirmed live**, per AGENTS.md's own standing rule ("get a
  direct read-only query/log/state-dump from that live environment before writing the fix, not
  after a first guess fails"). Reading the code first: `apps/web/app/(app)/orders/page.tsx`
  already appends `T00:00:00.000Z`/`T23:59:59.999Z` to `createdFrom`/`createdTo` before calling the
  API, and has done so unchanged since the route's original TASK-044 commit (`0aee3bc`) — well
  before #764 was filed. This means the **exact browser-driven repro in #764's own body may no
  longer reproduce through the `/orders` UI as written today.** The issue's evidence more likely
  came from testing `GET /v1/orders` directly (a bare `createdTo=2026-08-27`, then a hand-built
  `createdTo=2026-08-27T23:59:59` to work around it) — i.e., a real gap in the **API's own**
  handling of a bare date or a non-`z.iso.datetime()`-conforming string, not a bug in the page's
  query-building code. **First acceptance-criteria step (§7) is to re-confirm this hypothesis live
  against the running API before changing any code**, not to assume it.
- Given that hypothesis, the fix is scoped to `order.controller.ts`/`packages/domain/src/order.ts`
  accepting a bare `YYYY-MM-DD` value for `createdFrom`/`createdTo` and normalizing it to a
  day-boundary timestamp server-side (start-of-day for `createdFrom`, end-of-day for `createdTo`),
  in addition to continuing to accept a full ISO datetime as today — rather than only tightening
  the existing full-datetime-only validation. This makes the endpoint robust for any caller that
  sends a bare date (a future mobile client, an API integration, a `curl` health-check), not just
  the one `apps/web` page that currently happens to pre-format it correctly.
- **Not touching `billing.ts`'s or `worklist.ts`'s identical `createdFrom`/`createdTo` schema in
  this pass** — #764 only names `/orders`, and generalizing to the other two call sites without a
  concrete reported bug there would be scope creep beyond what's approved. Flagged as a candidate
  follow-up issue if the human wants it filed now (§10 Q1).
- For #775, assuming the fix is a `try { ... } catch { return { status: 'error', formError:
  'Something went wrong reaching the server — your data was not saved, please try again.' } }`
  wrapped around each `actions.ts` file's outbound `client.POST`/`PUT`/`DELETE` call(s) — matching
  the exact user-facing copy #775's own "Suggested fix" section proposes, and reusing each file's
  own existing `State`/`formError` return shape rather than inventing a new one.

## 6. Risks

1. **#764: `new Date(query.createdTo)` behavior for a bare-date string is timezone-sensitive.**
   `new Date('2026-08-27')` parses as UTC midnight (per the ES spec's date-only form), which is
   what "start of day" should mean here, but this needs a real test against Postgres's own
   `timestamptz` comparison, not just an assumption that JS and Postgres agree — `database-design`
   Skill precedent (entry #4, CHECK-constraint drift) is a reminder that this kind of "should just
   work" boundary case is exactly what a real e2e test catches and a code read alone doesn't.
2. **#775: a network-level `fetch` failure and a slow-but-eventually-successful request can look
   similar from inside a `try/catch` if a timeout isn't also considered.** This proposal's scope is
   explicitly the *connection-refused/unreachable* case #775 reproduced (stopping `apps/api`
   outright) — not adding a client-side request timeout, which is a separate, unscoped concern.
3. **Scope risk on #775 (22 files):** per §5 Q2 below, sweeping all 22 `actions.ts` files in one PR
   is a wide, mechanical change — high file-count, low per-file complexity, same shape as PR #779's
   already-proven 12-file sweep for the 403 branch. Risk is diffuse (a copy-paste error in one of
   22 near-identical edits), not deep — mitigated by the same new Playwright coverage pattern
   `permission-denied.spec.ts` (#768) already established, applied to at least one representative
   route per major screen area (patient registration, order placement, case accessioning, billing).
4. **Zero live browser verification of either fix is possible from within this proposal's own
   drafting** — deferred to the `develop` Skill's implementation pass, same as every other task.

## 7. Acceptance criteria

- [ ] **#764, step 0 (verification before any fix):** confirm live against the real running API
  (`apps/api` dev server, already up on this machine per this session's own `curl
  localhost:4000/health` → 200) whether `GET /v1/orders?createdTo=2026-08-27` (bare date) and
  `GET /v1/orders?createdTo=2026-08-27T23:59:59` (no `Z`/milliseconds) actually reproduce the
  reported 0-results/500 behavior today, and whether the `/orders` **page itself** (not the raw
  API) still reproduces the original UI-driven repro. Document the actual result before writing
  the fix — do not assume §5's hypothesis is correct.
- [ ] `GET /v1/orders?createdFrom=<date>&createdTo=<same date>` returns every order created that
  calendar day (UTC), including one placed at 00:00-00:59, both via a bare date and via a full ISO
  datetime.
- [ ] A malformed `createdTo` (neither a bare date nor a valid full ISO datetime) still returns a
  `400` with a real Zod field error — not a `500`.
- [ ] Every `apps/web/app/**/actions.ts` file in the agreed scope (§10 Q2) catches a thrown network
  error from its outbound API call(s) and returns its own existing error-state shape with the
  agreed copy, instead of letting the exception reach `error.tsx`.
- [ ] Live-verified in a real browser (`web-verify` Skill or Claude-in-Chrome): stop `apps/api`,
  submit at least one representative form (patient registration, matching #775's own original
  repro), confirm the in-form message renders instead of the crash screen, confirm no partial
  write occurred, confirm a normal resubmit succeeds once the API is back up.

## 8. Testing plan

- `apps/api`: extend `order.e2e-spec.ts` (or the relevant existing spec) with cases for
  bare-date `createdFrom`/`createdTo`, a same-day inclusive range, and a malformed value's `400`.
- `apps/web`: new or extended Playwright spec following `permission-denied.spec.ts`'s own pattern
  (#768) — stop the API mid-submission, assert the friendly message renders, assert no crash
  screen, assert a subsequent resubmit against a restarted API succeeds.
- `pnpm --filter api typecheck && pnpm --filter api lint`, `pnpm --filter web typecheck && pnpm
  --filter web lint`, full `apps/api` e2e suite against a freshly reset local DB (per AGENTS.md's
  own "don't trust a pre-existing dev DB" precedent).

## 9. Rollback plan

Both changes are additive (a new bare-date acceptance path alongside the existing full-datetime
one; a new `catch` branch alongside existing `if (!response.ok)` branches) — no migration, no
schema change, no removed behavior. Revert is a plain `git revert` of the merge commit with no
data cleanup required. If the #775 sweep across 22 files proves too wide for one PR to review
comfortably, it can be split file-by-file or screen-area-by-screen-area without any partial-state
risk, since each file's fix is independent of every other file's.

## 10. Questions requiring human approval

**Q1 — `billing.ts`/`worklist.ts` share the identical `createdFrom`/`createdTo` schema gap as
`order.ts` (#764's target). File a follow-up issue for those now, or leave untouched?**
**Answered: leave untouched, no new issue** — #764 only names `/orders`; not expanding scope
without a concrete reported bug in the billing/worklist filters.

**Q2 — #775's network-error-handling fix: sweep all 22 `apps/web/**/actions.ts` files in this one
task, or start narrower (patient registration only)?**
**Answered: all 22 files, in one PR** — same shape as PR #779's 12-file 403-branch sweep,
matching #775's own "likely affects every form-submission route" note.

Both questions resolved by the human on 2026-08-28. No further approval gate remains except the
overall `Status: APPROVED` change on this document itself, per Rule #0 — implementation does not
start until that happens.
