# Implementation Proposal: orders/cases search + case audit-trail completeness
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-28    Backlog ID: n/a (issues #748, #749, #750 — EPIC #697 follow-ups)

## 1. Goal

Three small, related findings from the #719 exit-gate audit, all classified "B —
should-have during pilot prep" (none blocked the exit gate itself):
- **#748** — `/orders` has no free-text search by patient name/MRN.
- **#749** — `/cases` shows no patient identity at all, and has no search.
- **#750** — the case detail page's "Audit trail" panel omits narrative-entry and
  block-add events, even though they're correctly written to `audit_event` — a query
  gap, not a missing write.

Bundled into one proposal because all three are small, from the same audit pass, and two
of them (#748/#749) are the literal same pattern applied to two different lists.

**Scoping correction, found while reading the current code (not assumed from the issue
text alone):**
- #748's own body asks for "real pagination (or, at minimum, a sane page-size cap)" —
  `ORDER_SEARCH_RESULT_LIMIT = 100` already exists and is already enforced. The real
  remaining gap is only the `q` search param; no pagination work is needed here.
- #749's list route (`case.controller.ts`'s `list()`) has **no cap at all** today,
  unlike every other list route in this repo (patients, orders, invoices) — worth fixing
  alongside the patient-name join and search, matching the established
  `engineering/api-design` entry #4 / ADR-0013 §Decision 4 precedent (fixed cap, no
  cursor pagination, until real volume needs one), even though the issue itself doesn't
  name it explicitly.

## 2. Affected files

**#748 — orders search**
- `packages/domain/src/order.ts` — add `q: z.string().min(1).optional()` to
  `orderSearchQuerySchema`.
- `apps/api/src/order/order.controller.ts` — `search()`: when `query.q` is present, add an
  `ilike` condition against the joined patient's first/last name and `mrn`, combinable
  with the existing status/priority/date-range filters (AND, per the issue's own AC).
  Mirrors `patient.controller.ts`'s own `q` branch (`ilike(firstName)/(lastName)`,
  `ilike(mrn, '<term>%')` prefix-match) — needs a join to `patient` before filtering
  (today's `patient` join happens *after* the `order` query, purely to decorate the
  response; `q` needs it woven into the `where` clause instead).
- `apps/web/app/(app)/orders/page.tsx` — one new `<input type="search" name="q">` in the
  existing filter form (already a single `action="/orders"` GET form covering
  status/priority/date-range — `q` joins it, not a second form).
- `apps/web/messages/*.json` (or wherever `Orders` translation keys live) — a `search`
  label key, matching this page's existing `next-intl` usage for its other filter labels.

**#749 — cases patient name + search**
- `packages/domain/src/anatomic-pathology.ts` — `caseListQuerySchema` gains
  `q: z.string().min(1).optional()`; new `caseListItemSchema` (case fields +
  `patientId`/`patientName`), mirroring `invoiceListItemSchema`'s exact precedent
  (`billing.ts`) for "list rows are thinner than / extend detail rows"; `CASE_LIST_RESULT_LIMIT`
  constant (100, matching `ORDER_SEARCH_RESULT_LIMIT`'s own value and rationale).
  `caseListResponseSchema.items` becomes `z.array(caseListItemSchema)`.
- `apps/api/src/case/case.controller.ts` — `list()`: join `case` → `order` → `patient`
  (same two-hop shape `billing.controller.ts`'s own list route already established for
  invoices), add the `q` `ilike` condition, apply `CASE_LIST_RESULT_LIMIT`.
- `apps/web/app/(app)/cases/page.tsx` — one search box (mirroring `patients/page.tsx`'s
  plain-GET-form pattern) alongside the existing status tabs; a "showing first N" notice
  when the cap is hit, matching `orders/page.tsx`'s own existing notice.
- `apps/web/app/(app)/cases/cases-table.tsx` — new `patientName` column, `CaseRow` type
  extended.
- **In-scope correction, found while touching this file**: `cases/page.tsx`'s 403 branch
  currently does `throw new Error('You do not have permission to view cases.')` — the
  exact redacted-in-production-builds shape issue #758 already swept 88 other instances
  of. Fixing this one inline (same pattern every other list page here already uses) since
  it's the literal file this task is already editing for the patient-name/search change,
  not a separate unrelated cleanup pass.

**#750 — case audit-trail completeness**
- `apps/api/src/case/case.controller.ts` — `getAuditTrail()`: generalize the existing
  two-resourceType `or()` (currently `case` + `case_report_version`) to also match
  `case_narrative` (via the case's own narrative row, at most one per case),
  `specimen`/`block`/`slide` (resolved through the same `specimen.caseId` →
  `block.specimenId` → `slide.blockId` lineage `getById()` already walks a few lines
  below this method), and `ordered_test` (via `blockFulfillment`, the same join
  `getById()` also already performs) — every child-resource type this file's own
  `@Audit()` decorators actually use, not just the two the endpoint happened to handle
  first. No schema change; the lineage-resolution queries already exist elsewhere in this
  same file and are being reused, not reinvented.

**Tests (all three)**
- `apps/api/test/order.e2e-spec.ts` (or a focused addition) — `q` search: matches by
  first/last name and MRN prefix, combines with existing status filter, no match returns
  empty (not an error).
- `apps/api/test/case.e2e-spec.ts` — `q` search + patient name on list rows; cap
  enforcement.
- `apps/api/test/case.e2e-spec.ts` (or a new focused spec) — audit-trail now includes a
  `case.record_narrative` and a `case.add_block` event for a case that has both, without
  losing the existing `case.accession`/`case.sign_out` rows.
- `openapi.json` / `@lis/sdk` regeneration for the two changed response shapes
  (`caseListItemSchema`) and the two changed query shapes (`q` on both).

## 3. Architecture consulted

`patient.controller.ts`'s `search()` (the exact `q`/`ilike` pattern being mirrored twice);
`billing.controller.ts`'s `list()` (the `invoiceListItemSchema` thinner-list-row pattern,
and its own two-hop patient join precedent); `case.controller.ts`'s own `getById()`
(the specimen→block→slide→ordered_test lineage-resolution queries #750 reuses rather than
reinventing); `engineering/api-design` entry #4 / ADR-0013 §Decision 4 (fixed-cap,
no-cursor-pagination convention, applied to cases for the first time).

## 4. Skills loaded

`api-design` (entry #2's DTO-class-vs-bare-inline-type OpenAPI-visibility lesson — the new
`q` query params and `caseListItemSchema` need proper `createZodDto` classes, not bare
inline types); `frontend-design` (entry #12, the thrown-Error-redaction gotcha being fixed
inline in `cases/page.tsx`); `billing` (entry #1's Date-to-ISO-string audit-payload
discipline — not directly touched here since none of these three routes write new
`@Audit()` payloads, but worth re-confirming `toCaseDto`/the new list mapper don't
regress it).

## 5. Assumptions & autonomous decisions

- **#748 needs no pagination work** — the existing 100-row cap already satisfies that half
  of the issue's own AC; only `q` search is being added. Flagged here rather than silently
  reinterpreting the issue's scope.
- **#749 gets a new 100-row cap**, matching orders' own value — not previously present at
  all on this route. A genuinely new behavior change (a case beyond row 100 stops
  appearing in the unfiltered list), judged safe: this repo's current fixture volume is
  ~154 cases in the shared dev tenant, and a real pilot tenant starts from zero.
- **`ilike` MRN matching is a prefix match** (`${term}%`), name matching is substring
  (`%${term}%`) — copied verbatim from `patient.controller.ts`'s own established
  convention, not a new design choice.
- **The `cases/page.tsx` thrown-Error fix is bundled in**, not filed as a separate issue —
  it's the exact file this task already edits, for the exact bug class #758 already has a
  proven fix pattern for.
- **#750 generalizes to every child-resource type this controller's `@Audit()` decorators
  actually use** (`case_narrative`, `block`, `slide`, `ordered_test`), not just the two
  (`narrative`, `block`) the issue's own acceptance criteria names literally — `slide`/
  `ordered_test` are the same class of gap, and the lineage queries needed to resolve them
  already exist in this same file (`getById()`), so there's no real added cost to closing
  the gap completely rather than partially.

## 6. Risks

Low across all three. No schema change, no new capability, no change to any existing
route's response shape beyond adding fields (`caseListItemSchema` is additive over
`caseSchema`) or a new optional query param. The one behavior change with real (if narrow)
blast radius is #749's new 100-row cap — a case beyond that row count silently stops
appearing in an unfiltered `/cases` list; mitigated by combining with `q`/`status` to
narrow results, same UX already established on `/orders`.

## 7. Acceptance criteria

(Restating each issue's own, since all three are being implemented together)

- **#748**: a user can find a specific order by typing the patient's name or MRN;
  existing status/priority/date-range filters continue to work, combinable with the new
  search.
- **#749**: the cases list shows which patient each case belongs to; a user can find a
  specific case by patient name or MRN; existing status tabs continue to work.
- **#750**: a pathologist viewing a case's audit trail sees who entered the
  narrative/diagnosis and when, and sees block/slide-add events; no regression to the
  existing accession/sign-out/amend entries.

## 8. Testing plan

- `pnpm --filter @lis/domain build`, `pnpm --filter api build`, `pnpm --filter web
  typecheck` — all clean.
- `pnpm --filter api lint` / `pnpm --filter web lint` — clean, `git status --short`
  checked for `--fix` scope-bleed onto unrelated files before staging.
- New/extended e2e coverage per §2's "Tests" bullet — real Postgres, real Keycloak tokens.
- Re-run `order.e2e-spec.ts`, `case.e2e-spec.ts`, `case-sign-out.e2e-spec.ts` in full to
  confirm no regression from the query/response-shape changes.
- `openapi.json`/`@lis/sdk` regenerated as the literal last code step.
- Live-verified against the real local dev stack (not just CI) — search a real order and
  a real case by patient name, confirm the audit trail shows narrative/block events for a
  case that has both.

## 9. Rollback plan

Revert the files in §2. No migration, no new env var. The `cases/page.tsx` thrown-Error
fix is a one-line behavior-preserving change (same message, different mechanism) with no
rollback risk of its own.

## 10. Questions requiring human approval

**Q1 — Bundle all three into one PR, or three separate PRs?**
- **(Recommended) One PR, one branch, closing all three issues** — all are small, from the
  same audit pass, touch overlapping files (`case.controller.ts` for both #749 and #750),
  and none has any real independent risk that would benefit from landing separately.
- Three separate PRs — more granular review/revert surface, at the cost of three
  round-trips through CI for changes this small.

**Q2 — #750's broader scope (block/slide/ordered_test, not just narrative/block as
literally named in the issue's AC) — proceed as scoped in §5, or match the issue's literal
AC only?**
- **(Recommended) Close the gap completely** (narrative + block + slide + ordered_test) —
  the lineage queries already exist in this same file, so there's no meaningful extra cost,
  and leaving `slide`/`ordered_test` events invisible would just be the identical gap
  re-discovered later under a new issue number.
- Match the issue's literal AC only (narrative + block) — smaller, more conservative diff.

---

**Approved 2026-08-28**, both questions accepted at their recommended defaults: Q1 — one
PR for all three; Q2 — close the audit-trail gap completely (narrative + block + slide +
ordered_test).
