# Implementation Proposal: Block-level reflex/add-on test ordering browser UI
Status: APPROVED
ADR: n/a (implements existing ADR-0049 §Decision 4 flow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #630

## 1. Goal

`POST /v1/blocks/:id/ordered-tests` (ADR-0049 §Decision 4, issue #561's own fix) is a correct,
already-tested backend action that adds a reflex/add-on test to an existing block, reusing the
case's own order — but nothing in `apps/web` can reach it. Add a single-test picker to the case
detail page, scoped per block, the sixth AP browser-UI slice this session and the first with a
real data-entry field (a test selection) rather than a status-transition or bare creation action.

## 2. Affected files

- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add `addOrderedTest`: raw `fetch` `POST` to
  `${API_BASE_URL}/v1/blocks/${blockId}/ordered-tests` with JSON body `{ testDefinitionId }`
  (`parentOrderedTestId` deliberately omitted — see §5). No `@ZodResponse` on this route
  (confirmed directly), same raw-`fetch` precedent as every prior action on this page. No
  `step_up_required` branch (confirmed directly — `addOrderedTest()` has no `@RequireStepUp()`,
  same as `addBlock`/`addSlide`/`screen`). A 400 (unknown test definition id — structurally
  shouldn't happen from a dropdown populated by the same catalog, but the API's own guard stays
  authoritative) surfaces the API's own `detail` message verbatim. On success, `revalidatePath`
  the case route and return a "done" state.
- `apps/web/app/(app)/cases/[caseId]/add-ordered-test-form.tsx` (new) — client component,
  `useActionState`, one real field: a plain `<select name="testDefinitionId">` populated from the
  case detail page's own catalog fetch (§2 below), plus hidden `caseId`/`blockId` fields and a
  submit button ("Add test"). The form itself is always rendered regardless of `state.status`,
  same as `add-slide-form.tsx` — no permanent "done" branch that replaces the control. The
  transient confirmation (§5) is implemented with a small separate local `useState<boolean>`
  (e.g. `justAdded`), flipped `true` by a `useEffect` keyed on the `state` object reference
  changing to a `'done'` status (`useActionState` returns a new object per dispatch, so this fires
  exactly once per successful submit, not on every render), and cleared back to `false` by a
  `setTimeout` inside that same effect (cleared on unmount/re-trigger via the effect's own cleanup
  function) — never by re-invoking `formAction` with empty data, which would issue a second, real,
  malformed network request (a mistake made and caught during this same session's own #627 work,
  worth avoiding here explicitly rather than re-discovering).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — fetch `GET /v1/catalog` alongside the existing
  case fetch (`Promise.all`, same precedent `orders/new/page.tsx` already uses to fetch catalog
  alongside patient). Render `<AddOrderedTestForm caseId={id} blockId={block.id}
  tests={catalog.tests} />` per block, alongside (not replacing) the existing `<AddSlideForm />` —
  both gated by `hasSpecimenManagementRole(session)` (reused from #624/#627, the correct capability
  for both routes).
- `apps/web/app/(app)/cases/[caseId]/types.ts` — add `AddOrderedTestState` type + its initial
  state, matching `AddSlideState`'s exact shape.
- No `apps/api` changes, no domain schema changes, no OpenAPI/SDK regeneration — `addOrderedTest`
  has no `@ZodResponse` today, matching every prior action's own precedent. `GET /v1/catalog`
  itself is already typed/documented (used via the typed `@lis/sdk` client, same as
  `orders/new/page.tsx`).

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `addOrderedTest()` (lines ~502-601) — confirmed directly:
  no `@ZodResponse`, no `@RequireStepUp()`, `manage_specimens` capability, the request body shape
  (`testDefinitionId` required, `parentOrderedTestId` optional), the "unknown test definition id"
  400, and that it reuses the case's own existing `orderId` (never creates a new order/case) —
  read from the live code, not assumed.
- `packages/domain/src/anatomic-pathology.ts` `blockOrderedTestLinkCreateSchema` — confirmed the
  exact two-field request shape.
- `apps/web/app/(app)/orders/new/page.tsx` / `order-builder-form.tsx` — the existing `GET
  /v1/catalog` consumption precedent (`client.GET('/v1/catalog')`, `Catalog` type from
  `@lis/domain`, `catalog.tests[].{id,code,displayName}`). Deliberately does **not** reuse that
  page's own multi-select/panel/filter/client-side-search UI — this route only ever accepts one
  `testDefinitionId` per call, so a plain `<select>` is the right shape, not a scaled-down copy of
  a UI built for a different (many-tests, panel-aware) problem.
- `docs/plans/task-627-block-slide-creation-ui.md` (issue #627's own proposal) — the conventions
  this proposal reuses directly: nested-in-tree placement, raw-fetch/`useActionState`/
  `revalidatePath` action shape, `hasSpecimenManagementRole` gating, and the "always show the
  control regardless of existing state, no confirmation dialog" decision from that proposal's own
  §10 (reused here without re-asking, per the human's own approval of that precedent).
- Earlier this session's own AP acceptance-testing pass (referenced in the issue itself) already
  confirmed live, not just read, that a freshly block-ordered test is genuinely result-enterable
  through the existing generic `/orders/[id]/results` screen — this proposal doesn't need to touch
  or verify that path again, only the ordering step itself.

## 4. Skills loaded

- `engineering/frontend-design` (required — Affected Files add a new `apps/web` client component).
  Checked: no function-valued props cross the Server/Client boundary (`AddOrderedTestForm` takes
  only plain string props plus a plain data array — `tests: Catalog['tests']` — same shape
  `OrderBuilderForm` already passes `catalog` as a plain prop); no new route/dynamic segment added.
- `engineering/api-design` — not reloaded as required new reading since this proposal adds zero
  `apps/api` routes — `addOrderedTest` and `GET /v1/catalog` are both reused unmodified.

## 5. Assumptions & autonomous decisions

- **`parentOrderedTestId` is never set from this UI**, matching the issue's own explicit text: it
  exists for the automated reflex-rule engine's own lineage tracking
  (`add-reflex-test.command.ts`), not a human manually picking a test from a dropdown — a person
  isn't asserting a specific parent-`ordered_test` relationship, they're just adding a test to a
  block. `addOrderedTest()`'s own schema already treats it as optional, so omitting it is a
  no-op, not a workaround.
- **No discipline/category filter on the test picker** — every catalog test is selectable, matching
  the backend's own genuinely generic `testDefinitionId` parameter (no IHC-specific allowlist
  exists anywhere in the schema or route). A lab's own catalog composition is the only real
  constraint, same as the full order-entry screen.
- **No persistent "done" message after a successful add** (a deliberate divergence from
  `add-block-form.tsx`/`add-slide-form.tsx`'s own "no done message, new tree node is the proof"
  reasoning): unlike a block/slide, a newly-ordered test isn't rendered anywhere in this page's own
  tree today (no ordered-tests-per-block list exists, and adding one is out of this issue's scope
  — the issue's own text confirms result entry already works once the test exists, via a
  *different* screen). Without a visible new tree node as proof, this form instead shows a brief
  transient "Test added." confirmation, then resets to idle — reusing `state.status === 'done'`
  for one paint cycle rather than gating the form's own re-render on it permanently. This is the
  one real structural difference from #627's own two forms, called out explicitly rather than
  silently copied.
- **No block-ordered-tests list added to the page.** Showing what's already been ordered on a
  block (beyond the two disciplines' own generic worklist/results screens) is a separate,
  reasonable follow-up, but not named in this issue's own scope, and would need its own read route
  or reuse of lineage data not currently fetched here — flagged in §10, not silently added.

## 6. Risks

- **Low.** Purely additive UI wiring against an already-correct, already-tested API action, reusing
  every established convention from the prior five proposals this session.
- The only genuinely new risk: fetching the full catalog on every case-detail-page load (previously
  only fetched on the dedicated `orders/new` page). For the seeded catalogs this session has
  worked with all along (on the order of 10-20 tests), this is a trivial extra request — matches
  `orders/new/page.tsx`'s own already-accepted cost for the same data. Not expected to be
  noticeable at this milestone's real data volumes (confirmed via `order-builder-form.tsx`'s own
  header comment: "real catalogs at this milestone are small").

## 7. Acceptance criteria

1. A `manage_specimens`-granted user (technologist or verifier) sees an "Add test" control (a
   `<select>` + submit button) under every block; a `qa`/no-role user sees no such control anywhere
   on the page.
2. Submitting Add test with a selected catalog test creates a new `ordered_test` (status
   `received`) linked to that block, reusing the case's own existing order — confirmed by checking
   the order the new test appears under matches the case's own order, not a new one.
3. The newly-ordered test is genuinely enterable through `/orders/[id]/results` immediately after
   creation (re-confirming, not just trusting, this session's own earlier finding still holds
   against the current checkout).
4. A second Add test submission on the same block, with a different test selected, succeeds
   independently — no artificial one-test-per-block limit.
5. No change to `addOrderedTest()`'s own business logic, any other AP mutation, or any existing
   e2e assertion.

## 8. Testing plan

- No new `apps/api` e2e tests — `addOrderedTest()`'s behavior is already covered by
  `reflex-block.e2e-spec.ts`/`case.e2e-spec.ts` (per this session's own earlier AP acceptance-pass
  findings referencing this exact route), and this proposal adds no backend route or logic change.
- No new `apps/web` automated tests (matching every prior AP-page proposal's own precedent).
- Manual/browser verification (`web-verify` Skill): as a technologist, add a test to a block from
  the catalog dropdown (AC #1/#2), navigate to the underlying order's results screen and confirm
  the new test is live and enterable (AC #3), add a second, different test to the same block (AC
  #4); as a `qa`/no-role user, confirm the control doesn't render (AC #1's negative case).

## 9. Rollback plan

Revert the commit(s). No migration, no backend route change — a plain `git revert` fully restores
prior (API-only) behavior.

## 10. Questions requiring human approval

1. Confirm no block-ordered-tests list is added to the page in this pass (§5) — a technologist
   adding a test currently gets only a transient confirmation, with no way to see what's already
   been ordered on a block without navigating to the order's own results screen.
2. Confirm the transient "Test added." success message (auto-resetting, not a persistent banner)
   is acceptable UX for this pass, given there's no new tree node to serve as visible proof the
   way there is for block/slide creation.
