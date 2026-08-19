# Implementation Proposal: Cases list status-filter tabs (signed-out/amended cases are invisible)
Status: APPROVED
ADR: n/a    Date: 2026-08-19    Backlog ID: issue #613 (BUG-CYTO-01)

## 1. Goal

`GET /v1/cases` excludes `signed_out` and `amended` cases by default (a deliberate
active-worklist default, matching `worklist.controller.ts`'s `ACTIVE_STATUSES`
precedent) and accepts an existing `?status=` query param to see any single status.
`apps/web`'s Cases list (`cases/page.tsx`) never sets that param and has no control to,
so a finalized or amended case is permanently invisible to browser-only navigation once
it leaves the active set. Add status-filter tabs to the Cases list, driven by URL
`searchParams`, calling the existing API parameter — no backend change. Restores the
ability to see "cases pending my review" and "cases already signed out/amended" from
the browser, per the issue's own suggested fix.

## 2. Affected files

- `apps/web/app/(app)/cases/page.tsx` — accept `searchParams: Promise<{ status?: string }>`;
  normalize to the `CaseStatus` enum or `undefined`; pass through to
  `client.GET('/v1/cases', { params: { query: { status } } })`; add a `role="tablist"`
  row of `Link`-wrapped `Button`s (Active / Pending Review / Signed Out / Amended),
  exact pattern already used in `apps/web/app/(app)/page.tsx`'s `STAGE_TABS` +
  `filterHref` (Link href carries the query string, `Button` styled `variant="default"`
  when selected vs `"outline"` otherwise, `aria-selected` set).
- No other file changes. `cases-table.tsx` already takes `rows` as a plain prop (no
  function props into the Client Component, no new prop needed) and needs no edit.
  No backend/domain/OpenAPI changes — `caseListQuerySchema`'s `status` field and the
  controller's `list()` behavior already support everything this UI needs.

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `list()` (lines ~599-632) — confirmed the
  `status` query param and default-exclusion behavior directly in code, not from the
  issue's description alone.
- `packages/domain/src/anatomic-pathology.ts` — `caseStatusSchema` (5-value enum) and
  `caseListQuerySchema` (`status` optional, single value, no `"all"` sentinel).
- `apps/web/app/(app)/page.tsx` (worklist home) — the tab pattern this proposal copies:
  Server Component, `searchParams`-driven, `filterHref()` helper, `Link` wrapping
  `Button` with `role="tablist"`/`role="tab"`/`aria-selected`.
- `apps/web/app/(app)/orders/page.tsx` — confirms the sibling convention of normalizing
  an empty-string query param to `undefined` before it reaches the typed API client.

## 4. Skills loaded

- `engineering/frontend-design` (required per the `plan` Skill's own rule whenever
  Affected Files touch `apps/web`) — checked entry on route-group/dynamic-segment
  collisions (not applicable: no new route or dynamic segment added, same `/cases`
  path, only a query string changes) and the function-valued-props-into-Client-
  Components entry (not applicable: `CasesTable` receives only plain `rows` data,
  no new prop crosses the Server/Client boundary).

## 5. Assumptions & autonomous decisions

- **No "All" tab.** The API has no multi-status/`"all"` query value — only a single
  `status` enum value or the default (which itself excludes `signed_out`/`amended`).
  Adding "All" would mean either a backend change (accepting `status=all` as a bypass)
  or the frontend requesting all 5 statuses and merging client-side (extra complexity,
  extra requests) for a case not raised as broken in the issue. Scoped out — 4 tabs
  (Active/Pending Review/Signed Out/Amended) fully resolves the reported bug (both
  `signed_out` and `amended` cases become reachable). Flagged in §10 in case the human
  wants it added.
- **Tab set is Active (default, no param) / Pending Review / Signed Out / Amended** —
  not one tab per individual status. `accessioned` and `in_process` are folded into
  "Active" (matching the controller's own current default grouping) rather than split
  into their own tabs, since the issue's own suggested fix names exactly these three
  new destinations ("Pending / Signed out / Amended") plus implicitly keeping today's
  default reachable as its own tab.
- **No i18n.** `cases/page.tsx` today has zero `next-intl` usage (plain hardcoded
  strings, unlike `orders/page.tsx`/the worklist home). Matching the existing file's
  own convention rather than introducing translations for this one page as a drive-by.
- **No result count changes.** The existing `{data.items.length} case(s).` subtitle
  stays as-is, now describing whatever the active tab returned — no per-tab count
  badges (the worklist home's `StatCard` counts come from a dedicated `counts` field
  `GET /v1/worklist` returns; `GET /v1/cases` has no equivalent, and adding one is
  backend scope beyond this bug fix).

## 6. Risks

- **Low.** Purely additive UI wiring against an already-correct, already-tested API
  parameter (issue's own repro step 4 confirms `?status=signed_out`/`?status=amended`
  already work). No schema, migration, or capability-gate changes. No audit-hash-shape
  or `WorkflowCommandHandler` concerns (this route has no such machinery — it's a
  plain read).
- Empty-string normalization gap (the `orders/page.tsx` gotcha comment) doesn't apply
  the same way here since this uses `Link` navigation (no `<select>`/form submitting an
  empty string), but the tab `Link`s must omit the `status` key entirely for "Active"
  (not set it to `""`), or the API's Zod enum validation will 400 exactly like that
  documented gotcha.

## 7. Acceptance criteria

1. Navigating to `/cases` (no query) shows the same set of cases as today (unchanged
   default behavior) with an "Active" tab visibly selected.
2. Navigating to `/cases?status=pending_review` shows only `pending_review` cases, tab
   visibly selected.
3. Navigating to `/cases?status=signed_out` shows `signed_out` cases (previously
   invisible in the browser) — the core bug fix.
4. Navigating to `/cases?status=amended` shows `amended` cases (previously invisible) —
   confirms the issue's own follow-up finding.
5. Clicking each tab updates the URL and the case list without a full page reload
   feeling broken (standard Next.js `Link` navigation).
6. No change to `/cases/:id` case-detail page, `cases-table.tsx` row rendering, or any
   backend route.

## 8. Testing plan

- No existing automated test coverage for `cases/page.tsx` (grep confirms no
  `*.test.tsx`/`*.spec.tsx` for this route) — none added here either, consistent with
  the rest of this minimal page (matching its own `patients`/`orders` list-page
  siblings, which also carry no page-level tests, only `apps/api`'s e2e specs for the
  underlying route, already passing and unchanged).
- Manual/browser verification (`web-verify` Skill) after implementation: mint sessions
  for a technologist and a verifier, seed or reuse a case in each of the four buckets
  (active, pending_review, signed_out, amended — the two-tier cytology flow already
  exercised this session can produce all four), and click through all 4 tabs
  confirming the right cases appear/disappear per tab, matching AC #1-4 above.

## 9. Rollback plan

Revert the single commit touching `cases/page.tsx`. No migration, no data written, no
backend surface changed — a plain `git revert` fully restores prior behavior.

## 10. Questions requiring human approval

1. Add an "All" tab (would need either a backend `status=all` bypass or 5 parallel
   requests merged client-side)? Proposed default: **no**, out of scope for this bug
   fix — say so explicitly if you want it included in this same change instead of
   filed as a separate follow-up.
2. Confirm the 4-tab set (Active / Pending Review / Signed Out / Amended) matches what
   you want, rather than e.g. separate "Accessioned" and "In Process" tabs.
