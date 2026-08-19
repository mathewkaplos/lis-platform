# Implementation Proposal: Gross/microscopic/diagnosis narrative entry
Status: APPROVED
ADR: n/a (extends existing FEAT-057/059 flow with a new table, no new architecture)    Date: 2026-08-19    Backlog ID: issue #636

## 1. Goal

No mechanism in this codebase persists per-case AP narrative text — confirmed directly this
session via a dedicated research pass (findings folded into issue #636's own body), not assumed.
Add the smallest correct slice: a new case-scoped narrative store, one route to read/write it, and
a UI card on the case detail page — with `buildCaseReportContent()` extended so the narrative
becomes part of the signed content at finalize/amend time. The eighth AP slice this session, and
the first requiring new schema/backend work rather than a thin UI layer over an already-correct
backend.

## 2. Affected files

- `packages/db/src/schema/anatomic-pathology.ts` — add `caseNarrative` table: `id`, `tenantId`,
  `caseId` (unique FK to `caseTable.id`, enforcing 1:1), `grossDescription`/
  `microscopicDescription`/`diagnosis` (nullable `text`, no CHECK — free narrative, matching
  `specimen.specimenType`'s own "genuinely unconstrained" precedent for text fields with no
  enum), `updatedAt` (timestamptz, default now, **no** `createdAt` — this table only ever has
  one logical row per case, "when was it last touched" is the only timestamp that matters),
  `updatedByUserId` (nullable uuid, no FK — same "no user table exists yet" convention
  `caseReportVersion.signedByUserId` already established). `tenantIsolation()` + `.enableRLS()`,
  same as every sibling AP table. **Deliberately no append-only trigger** — this table is
  genuinely, continuously mutable (§5).
- `db/migrations/00XX_case_narrative.sql` + `db/migrations/meta/00XX_snapshot.json` — generated
  via `pnpm --filter @lis/db generate` (drizzle-kit, schema-first), not hand-written — confirmed
  directly this is how every recent migration in this repo was produced (`0051_specimen_expiry.sql`
  is a single auto-generated `ALTER TABLE` statement from a schema-only column addition; this
  proposal's own change is the same shape, one new table).
- `packages/db/src/case-report-signature.ts` — **required change the research pass didn't
  surface**: `CaseReportContent` (`:30-34`) is a closed three-key interface (`case`, `parts`,
  `synopticResponses`, all `unknown`). `buildCaseReportContent()`'s `content` return value is a
  plain object literal typed via `Parameters<typeof computeCaseReportContentHash>[0]` — adding an
  untyped fourth key to that literal is a real TypeScript excess-property error, not just a style
  choice. Add `narrative: unknown` to the interface (matching its own existing "all fields
  `unknown`, hashed by structure not type" convention).
- `apps/api/src/case/case.controller.ts`:
  - `buildCaseReportContent()` (`:229-290`) — fetch the case's `caseNarrative` row (if any) and
    include `narrative: { grossDescription, microscopicDescription, diagnosis }` (all three, even
    if null — matching `synopticResponses`'s own "always present, possibly empty" convention) in
    the returned `content`. This is the one place the whole feature's real correctness property
    lives: **the values must be copied into `content` here, not referenced by id** — narrative has
    no immutability trigger the way verified `observation` rows do, so a later edit must never be
    able to change what an already-signed `case_report_version.includedContent` displays. Since
    `finalize()`/`amend()` already call this function inside their own transaction before signing,
    this is a pure extension of an existing, already-correct snapshot point — no new signing logic.
  - New method `updateNarrative()`: `PUT /v1/cases/:id/narrative`, `manage_specimens`-gated (same
    capability as every other routine AP mutation this session — accessioning, block/slide,
    ordered-test, screening), no step-up (matches `addBlock`/`addSlide`/`screen`/`addOrderedTest`,
    none of which touch the diagnostic sign-out gate). Upsert via Drizzle's
    `.insert(caseNarrative).values(...).onConflictDoUpdate({ target: caseNarrative.caseId, set:
    {...} })` — **a genuinely new pattern for this codebase** (no existing route uses
    `onConflictDoUpdate`, confirmed by grep), justified over this repo's own usual
    select-then-branch convention because a real race exists here that doesn't for e.g.
    `addBlock`'s count-then-insert: two concurrent Saves on the same case would otherwise either
    violate the unique `caseId` constraint (500) or silently lose one writer's edit under a naive
    select-then-decide-insert-or-update. Fetches the pre-upsert row first (a plain `select`) to
    populate `@Audit()`'s required `before` field — the interceptor does not auto-diff
    (`audit.interceptor.ts:15-18`), every route supplies its own `before`/`after`.
  - `getById()` (`:640-749`) — fetch the case's `caseNarrative` row alongside the existing
    specimen/block/slide/fulfillment/WSI batch-fetches, fold it into the returned lineage object
    as `narrative: { grossDescription, microscopicDescription, diagnosis } | null`. Precedent:
    `caseLineageSlideSchema` already folds `wholeSlideImage` in exactly this shape (`...slideSchema.shape,
    wholeSlideImage: wholeSlideImageSummarySchema.nullable()`,
    `packages/domain/src/anatomic-pathology.ts:102-105`) — confirmed directly, not assumed. Avoids
    a second round trip from the frontend (the case detail page already calls `getById` once).
- `packages/domain/src/anatomic-pathology.ts` — add `caseNarrativeSchema` (the three nullable-text
  fields), `caseNarrativeUpdateSchema` (same three fields, all optional on write — a partial update
  is valid, e.g. saving only the diagnosis field without re-sending gross/microscopic), fold
  `narrative: caseNarrativeSchema.nullable()` into `caseLineageSchema` (top-level, alongside `parts`
  — narrative is case-scoped per §3, not per-part).
- `apps/api/src/case/case.controller.ts` DTO classes — add `CaseNarrativeUpdateDto extends
  createZodDto(caseNarrativeUpdateSchema)`, add `@ZodResponse` to `updateNarrative()` (this route's
  response — the updated narrative object — is fully typeable, unlike `amend`/`finalize`/`screen`;
  no reason to leave it undocumented when the shape is simple and known upfront, matching
  `getById`/`listReportVersions`'s own precedent of using `@ZodResponse` wherever the response
  shape is real and documentable).
- `apps/web/app/(app)/cases/[caseId]/actions.ts` — add `updateNarrative` server action, using the
  **typed** `@lis/sdk` client (`client.PUT('/v1/cases/{id}/narrative', ...)`), not raw `fetch` —
  this route has a real `@ZodResponse` (see above), matching `orders/new/actions.ts`'s own
  precedent for a route with a documented response, and unlike every other action in this file
  (all of which target undocumented-response AP routes).
- `apps/web/app/(app)/cases/[caseId]/narrative-form.tsx` (new) — `useActionState`, three
  `FormField`-wrapped `<textarea>`s (Gross description, Microscopic description, Diagnosis),
  **uncontrolled** with `defaultValue={narrative?.field ?? ''}` (matching `amend-case-form.tsx`'s
  own uncontrolled-native-input convention — no `useState` needed per field, the value is only read
  at submit time). Unlike `amend-case-form.tsx`'s permanent "done" replacement (a one-shot action),
  this form **stays visible and editable after a successful save** (§5's lifecycle decision) — uses
  the same transient-confirmation pattern issue #630's `add-ordered-test-form.tsx` already
  established (a local `justSaved` boolean, set via React's "adjust state during render" pattern
  on `state` object-identity change, cleared by a `setTimeout`-only effect) rather than a
  permanent replacement or the buggy synchronous-setState-in-effect anti-pattern that pattern's own
  header comment already documents avoiding.
- `apps/web/app/(app)/cases/[caseId]/types.ts` — add `UpdateNarrativeState` type + initial state.
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — new "Narrative" card, sibling to the existing
  Screen/Sign out/Report versions cards, gated by `hasSpecimenManagementRole(session)` (reused,
  not a new helper — same capability as the write route). Shown whenever a verifier/technologist
  is viewing the case, regardless of status (§5's "always editable" decision) — no
  `NARRATIVE_STATUSES` gating set needed, unlike Screen/Sign out's own status-conditional cards.
- `apps/api/openapi.json` + `packages/sdk/src/schema.ts` — regenerated (new route, now documented).

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `buildCaseReportContent()` (`:229-290`) and its callers
  `finalize()`/`amend()` — confirmed directly this session (not trusted from the prior research
  pass alone) that `content` is a plain object literal typed via
  `Parameters<typeof computeCaseReportContentHash>[0]`, and that `getById()` (`:640-749`) has no
  narrative-adjacent fetch today.
- `packages/db/src/case-report-signature.ts` `CaseReportContent` (`:30-34`) — confirmed the
  closed-interface constraint that requires a real code change (§2), a finding this proposal's own
  independent verification pass surfaced beyond what the prior research summarized.
- `packages/domain/src/anatomic-pathology.ts` `caseLineageSlideSchema` (`:102-105`) — confirmed
  directly as the exact fold-in precedent for adding `narrative` to `caseLineageSchema`.
- `packages/db/src/schema/anatomic-pathology.ts` `caseTable` (`:39-57`) and `caseReportVersion`
  (`:170-204`) — confirmed the exact tenant-isolation/RLS/index/check pattern `caseNarrative`
  should follow, and confirmed `case_report_version`'s own "new table for structurally different
  content, not an extension of an existing one" precedent (`:143-146`) that motivates a new table
  here over bare columns on `case`.
- `apps/api/src/auth/audit.interceptor.ts` (`:15-18`, `:24-35`) — confirmed `@Audit()` requires the
  route handler to supply `before`/`after` itself; no auto-diffing exists, so `updateNarrative()`
  must select the pre-upsert row explicitly.
- `apps/api/src/auth/capabilities.ts` (`:119`, `:139`, `:147`) — confirmed `manage_specimens`'s
  grant (technologist + verifier), reused unmodified.
- `apps/web/auth/roles.ts` `hasSpecimenManagementRole` (`:76`) — confirmed it already exists
  (added for issue #624), reused rather than adding a near-duplicate helper.
- `apps/web/app/(app)/cases/[caseId]/amend-case-form.tsx` and
  `apps/web/app/(app)/cases/[caseId]/add-ordered-test-form.tsx` (issue #630) — confirmed the two
  precedents this proposal blends: `amend-case-form.tsx`'s `FormField`+plain-`<textarea>` shape,
  and `add-ordered-test-form.tsx`'s transient-confirmation `useState`+render-time-adjustment
  pattern (needed here because, unlike `amend-case-form.tsx`, this form must remain usable for
  further edits after a successful save, not permanently replaced).
- `db/migrations/0051_specimen_expiry.sql` + its own `package.json` `generate` script
  (`packages/db/package.json:10`, `drizzle-kit generate`) — confirmed the schema-first,
  auto-generated-SQL migration convention this proposal follows exactly, not a hand-written SQL
  file.
- No existing `onConflictDoUpdate`/`onConflictDoNothing` usage anywhere in `apps/api/src` (grepped
  directly) — confirmed this is a genuinely new pattern for this codebase, named explicitly in §2
  rather than silently introduced.
- Issue #636's own body (the prior research pass's findings) — used as the starting point, but
  every load-bearing claim re-verified directly against the current checkout per this proposal's
  own §3 entries above, per the `plan` Skill's own discipline of never drafting from memory.

## 4. Skills loaded

- `engineering/api-design` (required — Affected Files add a new `apps/api` route). Checked entry
  #7 (RLS makes cross-tenant rows structurally invisible — `updateNarrative()` relies on the same
  `TenantContextInterceptor` + RLS mechanism every sibling route already trusts, no manual tenant
  filter needed) and entry #9 (human-initiated, low-frequency actions don't need retry-safe
  identifier assignment — narrative saves are exactly this shape, matching `addBlock`'s own
  max-plus-one reasoning, though the *upsert* choice here is about correctness under concurrent
  saves, a different concern from identifier collision).
- `engineering/frontend-design` (required — Affected Files add a new `apps/web` client component).
  Checked: no function-valued props cross the Server/Client boundary (`NarrativeForm` takes only
  plain string/object props); no new route/dynamic segment added.

## 5. Assumptions & autonomous decisions

Per the human's explicit instruction, all four decisions below are the research pass's own
recommended defaults, approved without further discussion:

- **Single capability (`manage_specimens`) gates all three fields**, including diagnosis — not
  split with `verify` required for diagnosis specifically. The real diagnostic gate remains
  `finalize()`'s own `verify` + step-up; narrative fields are draft documentation until signed,
  matching this session's own repeated "draft-time gates are UI convenience, the signing action is
  the real enforcement point" pattern (issues #621, #624).
- **New `caseNarrative` table**, not bare columns on `case` — matches `case_report_version`'s own
  precedent for structurally-distinct content, and leaves room for `updatedAt`/`updatedByUserId`
  without widening `case` itself.
- **Narrative stays editable at any case status, including after sign-out.** No new status guard on
  `updateNarrative()`. `finalize()`/`amend()` simply snapshot whatever is current at that moment —
  matches this codebase's existing "the draft always reflects current reality, sign-out/amend just
  captures it" framing (§5 of the research), and requires no new lock/unlock mechanism.
- **Exactly Gross/Microscopic/Diagnosis for this pass** — Clinical History and Comment (also named
  in `docs/research/17-histology.md`) are a deliberate, trivial future follow-up (same table, two
  more columns) if a real need is confirmed, not silently added now.

Two further decisions made independently while verifying/drafting, not present in the original
research:

- **`onConflictDoUpdate` over select-then-branch** (§2/§3) — a real correctness choice, not a style
  preference, given the concurrent-save race a mutable, always-editable field genuinely invites
  (unlike this codebase's other AP mutations, which are single-shot actions with no legitimate
  "save the same thing twice" scenario).
- **`@ZodResponse` added to `updateNarrative()`** (§2) — this route's response shape is simple and
  fully known upfront (unlike `amend`/`finalize`/`screen`, whose response types were left
  undocumented for reasons specific to their own history), so there's no reason to perpetuate the
  undocumented-response pattern here; the typed `@lis/sdk` client is used accordingly.

## 6. Risks

- **Low-to-moderate.** The one genuine risk this whole feature turns on — narrative must be
  snapshotted, not referenced, at sign-out/amend time (§2, §3) — is directly addressed by
  extending `buildCaseReportContent()` to copy the current values in, the same place lineage/
  synoptic-response provenance is already captured. This is testable directly (§8 AC #4).
- The new `CaseReportContent` interface field (§2) changes the hash input shape for every future
  signed version — no backward-compatibility concern, since each `case_report_version` row stores
  its own `contentHash` computed at the time it was signed; existing rows are never re-hashed or
  re-verified against a new shape.
- `onConflictDoUpdate` (§2/§5) is a new pattern for this codebase — low risk in isolation (a
  well-established Drizzle/Postgres feature), but worth flagging since no prior route's own review
  covers it; the e2e tests (§8) exercise the concurrent-ish case (two sequential saves on the same
  case) directly.
- No new step-up/redirect logic to re-verify — this route has none, like `addBlock`/`addSlide`/
  `screen`/`addOrderedTest`.

## 7. Acceptance criteria

1. A `manage_specimens`-granted user (technologist or verifier) viewing any case sees a
   "Narrative" card with three text areas, regardless of case status.
2. Saving with only a gross description filled in persists that value; microscopic/diagnosis stay
   null; a second save adding a diagnosis (without re-sending gross) does not clear the gross
   description (confirms partial-update semantics, not a full-object overwrite).
3. Reloading the case detail page shows the previously-saved values pre-filled in the form
   (confirms `getById()`'s own fold-in and the form's `defaultValue` wiring).
4. **The core correctness property**: sign out a case with narrative already entered, then edit the
   narrative again (still permitted per §5) — the *already-signed* `case_report_version`'s own
   `includedContent` still shows the pre-edit values (fetched via `GET /v1/cases/:id/report-versions`
   or a direct DB read in the e2e test), never the post-edit ones.
5. Amending the case after that edit creates a new `case_report_version` whose `includedContent`
   captures the *current* (post-edit) narrative values, not the original version's.
6. A `qa`/no-role user viewing the case sees no Narrative card (or sees it read-only with no save
   control — confirmed as read-vs-hide during implementation, matching this session's own
   established "hide entirely, not disable" convention for every prior AP action).
7. No change to `finalize()`/`amend()`'s own signing logic beyond the `buildCaseReportContent()`
   extension, and no change to any existing e2e assertion.

## 8. Testing plan

- New `apps/api` e2e case(s), likely in `case.e2e-spec.ts` or a new `case-narrative.e2e-spec.ts`:
  - `PUT .../narrative` creates a row on first call, updates in place on a second call (confirms
    the upsert), rejects a caller without `manage_specimens` (403).
  - `GET /v1/cases/:id` reflects the current narrative (or `null` before any save).
  - **AC #4's own core property**, tested directly against real transactions: finalize a case with
    narrative A, edit narrative to B, read the *first* `case_report_version` row's own
    `includedContent` and confirm it still shows A.
  - AC #5: amend after editing to B, confirm the *second* version's `includedContent` shows B.
  - Tenant isolation (a second tenant's token cannot read/write the first tenant's narrative — RLS,
    matching every other AP route's own e2e coverage pattern).
- No new `apps/web` automated tests (matching every prior AP-page proposal's own precedent).
- Manual/browser verification (`web-verify` Skill): as a technologist, save narrative on a fresh
  case, reload and confirm persistence (AC #1-3); sign the case out, edit narrative again, confirm
  the case detail page's own "Report versions" section still shows the pre-edit content for the
  existing version (AC #4, browser-visible re-confirmation of the e2e-level check); confirm a
  `qa`/no-role session doesn't see an editable Narrative card (AC #6).

## 9. Rollback plan

Revert the commit(s) and the migration (`drizzle-kit` migrations are forward-only by convention in
this repo — reverting means a new down-migration dropping `case_narrative`, not editing history).
No existing table/route is modified in a way that isn't purely additive (`CaseReportContent`
gaining one more `unknown`-typed key is additive; `getById()`'s response gains one more optional
key). A plain `git revert` plus a compensating drop-table migration fully restores prior behavior.

## 10. Questions requiring human approval

None outstanding — all four scope questions from the research pass were resolved to its own
recommended defaults per explicit instruction (§5). The two additional implementation-level
decisions this proposal makes independently (`onConflictDoUpdate`, adding `@ZodResponse`) are
named in §5 as autonomous decisions with their own reasoning, not open questions, since neither
changes user-facing scope or behavior — flagging here only in case either warrants a second look
before implementation begins.
