# Implementation Proposal: Block/slide creation browser UI
Status: APPROVED
ADR: n/a (implements existing ADR-0049 flow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #627

## 1. Goal

`POST /v1/cases/:id/blocks` and `POST /v1/blocks/:id/slides` (ADR-0049) are correct, already-tested
backend actions that build out a case's physical specimen hierarchy — but nothing in `apps/web` can
reach them. The case detail page already renders the parts→blocks→slides tree read-only; add "Add
block" and "Add slide" creation controls directly into that existing tree, the most routine,
highest-frequency action in the AP workflow and the one still missing after #615/#621/#624 closed
every status-transition gap.

## 2. Affected files

- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add two server actions:
  - `addBlock`: raw `fetch` `POST` to `${API_BASE_URL}/v1/cases/${caseId}/blocks` with JSON body
    `{ specimenId }`. No `@ZodResponse` on this route (confirmed directly), same raw-`fetch`
    precedent as every prior action on this page.
  - `addSlide`: raw `fetch` `POST` to `${API_BASE_URL}/v1/blocks/${blockId}/slides`, no request
    body (confirmed directly — `addSlide()` takes none).
  Both: no `step_up_required` branch (confirmed directly — neither route carries
  `@RequireStepUp()`, same as `screenCase`); a plain 403 means a genuine permission denial. A 400
  (specimen not part of this case — structurally shouldn't happen from this UI, but the API's own
  guard stays authoritative) surfaces the API's own `detail` message verbatim. On success,
  `revalidatePath` the case route and return a "done" state — matches every prior action's own
  success handling.
- `apps/web/app/(app)/cases/[caseId]/add-block-form.tsx` (new) — client component,
  `useActionState`, one hidden field (`specimenId`, the current part's own id — never a
  user-facing choice, since this form only ever renders inside that part's own tree node) plus a
  submit button ("Add block"). Placement follows `upload-wsi-form.tsx`'s own precedent (nested
  inside the tree, not a top-level page card) rather than `sign-out-case-form.tsx`/
  `screen-case-form.tsx`'s top-level-card placement — the closest structural sibling is
  `UploadWsiForm`, not the status-transition actions.
- `apps/web/app/(app)/cases/[caseId]/add-slide-form.tsx` (new) — client component, same shape,
  minus the hidden field (`addSlide` takes no body beyond the block id in the URL, itself passed
  as a plain prop, not form data — matching `UploadWsiForm`'s own `slideId` prop convention).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — render `<AddBlockForm caseId={id}
  specimenId={part.id} />` after each part's existing block list (inside the `part.blocks.length
  === 0 ? ... : ...` branch's else-arm, and also when the branch is the zero-blocks arm — i.e.
  unconditionally per part, not nested inside the `blocks.length > 0` check, since a part with zero
  blocks still needs to be able to get its first one). Render `<AddSlideForm caseId={id}
  blockId={block.id} />` after each block's existing slide list, same unconditional-per-block
  placement. Both gated by `hasSpecimenManagementRole(session)` (from issue #624 — the correct
  reuse, since `manage_specimens` is the real capability guarding both routes) — hidden entirely
  for a `qa`/no-role viewer, matching every prior action's own "UI-visibility convenience only"
  gating.
- `apps/web/app/(app)/cases/[caseId]/types.ts` — add `AddBlockState`/`AddSlideState` types +
  their initial states, matching `ScreenCaseState`'s exact shape (both actions have an identical
  status/formError contract).
- No `apps/api` changes, no domain schema changes, no OpenAPI/SDK regeneration — neither route has
  `@ZodResponse` today, matching every prior action's own precedent.

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `addBlock()` (lines ~397-457) and `addSlide()` (lines
  ~459-500) — confirmed directly: no `@ZodResponse`, no `@RequireStepUp()` (grepped the whole file
  for the decorator — it appears only on `finalize`/`amend`), `manage_specimens` capability,
  `addBlock`'s `{ specimenId }` body and its "specimen not part of this case" 400, `addSlide`'s
  bodyless request. Both use `@Audit()` (auto-generated audit event), no manual `writeAuditEvent`
  call to reason about on the frontend side.
- `packages/db/src/schema/anatomic-pathology.ts` — confirmed `block`/`slide` carry no gross/
  microscopic/diagnosis fields, no custody-event log, no barcode reference — the backend genuinely
  is this minimal today, not a UI gap hiding richer backend capability.
- `docs/research/17-histology.md`, `23-specimen-tracking.md` (this repo's own domain research,
  read per the human's explicit request) — confirm the `Case → Specimen/part → Block(s) →
  Slide(s)` hierarchy this UI surfaces matches the intended long-term model exactly, and that
  richer custody-event/barcode-driven tracking (`23`/`24-barcoding.md`) is explicitly future
  scope, not something this proposal should reach for.
- `D:\LIS\research\partner documents` (real design-partner materials, also read per the human's
  explicit request) — two findings that *confirm*, not expand, this proposal's own scope
  exclusions:
  - `TRACKING SHEET (1).docx` — the partner lab's real internal QC sheet for tissue processing:
    captures grossing date, "Doctor Trimming"/"Histo Tech" attribution, slide-forwarding date, and
    a detailed per-case slide-quality checklist (fixation adequacy, processing, section thickness,
    tissue folds/tears, staining quality, coverslip artifacts, orientation) plus a per-lab-number
    slide count and pathologist remarks. None of this is modeled anywhere in `block`/`slide`'s own
    schema today — real evidence of a genuine future need (a slide-QC/processing-tracking
    feature), not something to informally bolt onto this issue's simple creation UI.
  - `BREAST CANCER TEMPLATE.docx` — a real CAP-style gross-description template showing blocks are
    conventionally labeled with *what tissue they contain* ("Block 1 – nipple, Tumor, Surrounding
    breast, Nearest margin, Lymphnodes"), not just a bare sequential code — confirms the schema's
    current code-only `block.code` is a genuine simplification against real practice, reinforcing
    (not changing) §5's decision to leave block/slide description entry out of this issue's scope,
    since it needs a new schema column this proposal doesn't add.
  Neither finding changes this proposal's scope — both are named in §10 as candidate follow-up
  issues for the human to consider filing separately, matching this session's own "flag scoped-out
  gaps as their own tracked items" practice throughout #613/#615/#621/#624.
- `apps/web/app/(app)/cases/[caseId]/upload-wsi-form.tsx` — the structural placement precedent
  this proposal follows (a form nested inside the tree, scoped to one specific node, not a
  page-level card).
- `docs/plans/task-624-case-screen-ui.md` / `task-621-case-sign-out-ui.md` — the raw-fetch/
  `useActionState`/`revalidatePath` conventions this proposal reuses directly; also confirms
  `hasSpecimenManagementRole` (added in #624) is the correct existing role gate to reuse here
  rather than adding a third near-duplicate helper.

## 4. Skills loaded

- `engineering/frontend-design` (required — Affected Files add two new `apps/web` client
  components). Checked: no function-valued props cross the Server/Client boundary (`AddBlockForm`/
  `AddSlideForm` take only plain string props — `caseId`/`specimenId`/`blockId` — same as every
  sibling form on this page); no new route/dynamic segment added.
- `engineering/api-design` — not reloaded as required new reading since this proposal adds zero
  `apps/api` routes — `addBlock`/`addSlide` are reused unmodified.

## 5. Assumptions & autonomous decisions

- **`specimenId` is always a hidden field, never a user-facing choice.** `AddBlockForm` only ever
  renders inside one specific part's own tree node, so the part it belongs to is never ambiguous —
  matches the issue's own framing ("an 'Add block' control per part").
- **No block/slide editing or deletion.** Confirmed by grep: no update/delete route exists for
  either entity today (only `active`/`disposed` status columns exist, with nothing that writes
  to them). Out of scope per the issue's own explicit text, not a silent gap.
- **No gross/microscopic/diagnosis text entry alongside block creation**, even though "grossing" is
  the real-world activity block creation represents. Confirmed by schema read: no such column
  exists on `block` (or anywhere), so this would require new backend/schema work — a separate,
  larger item already named on #610's own list (issue's own §"Scope for whoever picks this up").
- **Blocks/slides render unconditionally per part/block** (the "Add block"/"Add slide" controls
  show even when the list is non-empty, immediately after existing entries) — a part or block
  legitimately gets more than one block/slide over time (multiple blocks per part, multiple slides
  per block are both normal histology practice, and the backend's own max-plus-one numbering
  already assumes repeat calls), so there's no "already has one, hide the control" state to gate
  on, unlike the single-shot status-transition actions on this same page.
- **Success feedback stays inline, matching `UploadWsiForm`'s own convention** (no modal, no
  redirect) — after `revalidatePath`, the newly-created block/slide simply appears in the
  re-rendered tree; the form itself doesn't need a persistent "done" banner the way the page-level
  action cards do, since the visible proof (a new tree entry) is immediate and self-evident. The
  form resets to its idle state on success rather than showing a static confirmation message (a
  deliberate, small divergence from `AmendCaseForm`/`SignOutCaseForm`/`ScreenCaseForm`'s own "done"
  message — those are single-shot page actions where the whole card becomes obsolete after success;
  this form stays usable for the *next* block/slide, so leaving it a static "done" message would
  actively get in the way of adding a second one).

## 6. Risks

- **Low.** Purely additive UI wiring against two already-correct, already-tested API actions,
  reusing every established convention from the prior three proposals this session.
- The one real UX risk: repeatedly clicking "Add block"/"Add slide" creates real rows each time (no
  idempotency key, matching the backend's own design — these are human-initiated, low-frequency
  actions per `engineering/api-design` entry #9's own reasoning, already accepted at the API layer).
  A double-submit from impatient clicking creates two blocks instead of one. Not new to this
  proposal (the same risk exists for any create button anywhere in the app), and out of scope to
  solve generically here — `disabled={pending}` on the submit button (already the established
  pattern) is the existing mitigation this app relies on everywhere else.

## 7. Acceptance criteria

1. A `manage_specimens`-granted user (technologist or verifier) sees an "Add block" control under
   every part, including a part with zero blocks; a `qa`/no-role user sees no such control anywhere
   on the page.
2. Submitting Add block on a part creates a new block with a correctly-derived code
   (`{accessionNumber}-B{n}`), and the tree re-renders showing it, still inside the same part.
3. A `manage_specimens`-granted user sees an "Add slide" control under every block, including a
   block with zero slides.
4. Submitting Add slide on a block creates a new slide with a correctly-derived code
   (`{block.code}-S{n}`), and the tree re-renders showing it — including its own Upload WSI form,
   since a freshly-created slide has no `wholeSlideImage` yet.
5. Submitting Add block/Add slide a second time on the same part/block creates a second, correctly
   *incremented* block/slide (`B2`, `S2`), not a duplicate `B1`/`S1` — proves the max-plus-one
   numbering is exercised correctly through the new UI, not just previously via direct API calls.
6. No change to `addBlock()`/`addSlide()`'s own business logic, any other AP mutation, or any
   existing e2e assertion.

## 8. Testing plan

- No new `apps/api` e2e tests — `addBlock()`/`addSlide()`'s behavior is already covered by
  `case.e2e-spec.ts` (per that file's own AC #3 fixture-building helper, which already calls both
  routes), and this proposal adds no backend route or logic change.
- No new `apps/web` automated tests (matching every prior AP-page proposal's own precedent).
- Manual/browser verification (`web-verify` Skill): as a technologist, add a block to a
  freshly-accessioned case's own part (AC #1/#2), add a second block to the same part and confirm
  it's numbered `B2` (AC #5's block half), add a slide to a block (AC #3/#4), add a second slide to
  the same block and confirm it's numbered `S2` (AC #5's slide half); as a `qa`-role or no-role
  user, confirm neither control renders (AC #1's negative case).

## 9. Rollback plan

Revert the commit(s). No migration, no backend route change — a plain `git revert` fully restores
prior (API-only) behavior.

## 10. Questions requiring human approval

1. Confirm the "unconditional per part/block, no hide-after-first" placement (§5) — i.e., "Add
   block"/"Add slide" always show for a `manage_specimens`-granted user regardless of how many
   blocks/slides already exist, rather than e.g. only showing when the list is still empty.
2. Confirm no confirmation dialog before creating a block/slide is acceptable (matching every
   other AP mutation action built this session, none of which use one) — a mis-click just adds an
   extra, harmless (but real, undeletable today per §5) block/slide row.
3. Two candidate follow-up issues surfaced by the partner-document research (§3), neither in this
   proposal's own scope — file them now as tracked backlog items, or leave them as this note only
   for a future session to pick up?
   - A block-description field (what tissue a block contains, e.g. "nipple, tumor, nearest
     margin") — needs a new schema column plus this UI's own form extended to collect it.
   - A slide-QC/processing-tracking feature (grossing date, histo-tech/pathologist attribution,
     fixation/staining/orientation checklist per the partner's real tracking sheet) — a
     genuinely new, separate feature area, not an extension of block/slide creation.
