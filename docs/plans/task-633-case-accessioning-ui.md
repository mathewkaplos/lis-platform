# Implementation Proposal: Case/specimen accessioning browser UI
Status: APPROVED
ADR: n/a (implements existing ADR-0049 create flow, adds no new architecture)    Date: 2026-08-19    Backlog ID: issue #633

## 1. Goal

`POST /v1/cases` (ADR-0049) is a genuine, already-heavily-exercised backend action — every test
case created during this session's own six-PR AP browser-UI run was seeded through this exact
route via direct API calls, because there is still no way to create a case from the browser at
all. Add a `/cases/new?orderId=<uuid>` page, the seventh AP browser-UI slice this session and the
first that's a full new page with a dynamic multi-row form, not an addition to the existing case
detail page. This is the last item on #610's own list that fits the "backend already correct and
tested, just needs a UI" shape — everything else remaining there needs new backend/schema work
first.

## 2. Affected files

- `apps/web/app/(app)/cases/new/page.tsx` (new) — Server Component, mirrors `orders/new/page.tsx`'s
  own shape exactly: `orderId` required query param (`?orderId=<uuid>`), a real error state (not a
  silent redirect/guess) if missing, fetches the order via `client.GET('/v1/orders/{id}')` for
  display context (patient name/MRN, same summary line `orders/new/page.tsx` already renders),
  renders `<CaseAccessionForm orderId={orderId} order={order} />`.
- `apps/web/app/(app)/cases/new/case-accession-form.tsx` (new) — client component. A dynamic list
  of specimen-part rows (`useState<{ id: string; specimenType: string; rejectionReason: string
  }[]>`, seeded with one empty row — `caseCreateSchema`'s own `.min(1)` requires at least one
  part), each row: a free-text `specimenType` input (matches the schema's own genuinely
  unconstrained `z.string().min(1)` — confirmed directly, no enum/CHECK constraint exists anywhere
  for this field) and an optional rejection-reason `<select>` (the same 7-value
  `specimenRejectionReasonSchema` enum reception's own specimen-rejection workflow already uses,
  plus a "None" default), "Add another part"/"Remove" buttons (client-side array state, no server
  round trip per row — matches `order-builder-form.tsx`'s own "client-side, not a server round
  trip" reasoning for its checkbox selection state). On submit, the full parts array is serialized
  to a hidden JSON field (same "state resubmitted via a hidden field" convention
  `order-builder-form.tsx`'s own `testDefinitionIds`/`panelIds` hidden fields already establish —
  a dynamic-length list doesn't compose with native form serialization otherwise). On
  `state.status === 'created'`, replaces the form with a confirmation card ("Case accessioned",
  the new accession number, a `Link` to `/cases/{createdCaseId}`) — exactly
  `order-builder-form.tsx`'s own `state.status === 'created'` pattern, not a hard server-side
  `redirect()`.
- `apps/web/app/(app)/cases/new/actions.ts` (new) — `createCase` server action. Parses the
  hidden-field JSON parts array, validates against `caseCreateSchema` client-side via
  `.safeParse()` (same precedent `createOrder` already establishes for its own hidden-field JSON
  fields) before calling the API, surfacing a clear "add at least one part" error if empty rather
  than relying solely on the API's own 400. Calls `client.POST('/v1/cases', { body: parsed.data
  })` — the **typed** `@lis/sdk` client, not raw `fetch` — matching `createOrder`'s own precedent
  exactly: `POST /v1/cases`' request body **is** documented in `openapi.json` (confirmed directly:
  `requestBody` present, schema-typed), only the response has no `@ZodResponse` (confirmed
  directly: bare `"201": { "description": "" }`, no content schema) — so the request stays
  fully typed while the response needs the same explicit cast `createOrder`'s own header comment
  already documents (`data as unknown as { resourceId: string; after: { accessionNumber: string }
  }`). Surfaces the API's own 400 message verbatim on failure (covers both real validation errors
  and the `ux_case_tenant_order` "already has a case" collision, which needs no client-side
  pre-check — the API is authoritative and the message is already clear).
- `apps/web/app/(app)/cases/new/types.ts` (new) — `CreateCaseState` type + initial state, matching
  `CreateOrderState`'s exact shape (`status: 'idle' | 'error' | 'created'`, `formError?`,
  `createdCaseId?`, `createdAccessionNumber?`).
- `apps/web/app/(app)/orders/[id]/page.tsx` — add a "New AP case" `Button`/`Link` to
  `/cases/new?orderId=${order.id}`, in the same conditional-action-button row as "Receive at
  reception"/"Enter results"/"Cancel order"/"Generate invoice". Gating: `order.status !==
  'cancelled'` (matching `GenerateInvoiceButton`'s own exact gate — see §5 for why this one over
  the alternatives, and §10 Q1 to confirm).
- No `apps/api` changes, no domain schema changes, no OpenAPI/SDK regeneration — `POST /v1/cases`
  is reused unmodified; its request shape is already fully documented, its response shape stays
  undocumented exactly as `createOrder`'s own sibling route already is.

## 3. Architecture consulted

- `apps/api/src/case/case.controller.ts` `create()` (lines ~318-395) — confirmed directly: no
  `@ZodResponse`, `manage_specimens` capability, the exact request shape (`orderId` + `parts:
  [{specimenType, rejectionReason?}]`, min 1 part), the `ux_case_tenant_order` "already has a
  case" 400, and that `specimenType` is written through unmodified (no server-side enum
  validation beyond `z.string().min(1)`).
- `packages/domain/src/anatomic-pathology.ts` `caseCreateSchema`/`caseCreatePartSchema` and
  `packages/domain/src/specimen.ts` `specimenRejectionReasonSchema` — confirmed the exact
  7-value rejection-reason enum and that `specimenType` is genuinely free text.
- `apps/api/openapi.json` — confirmed directly (not assumed) that `POST /v1/cases`'s request body
  is documented (real schema) while its response is not (bare `201`, no content) — the exact
  situation `createOrder`'s own header comment already documents for its sibling route, and the
  basis for reusing that same typed-request/cast-response pattern here rather than the
  case-detail-page actions' own fully-raw-`fetch` style (those routes have undocumented
  *request* shapes too — multipart uploads or no body at all — which is why they went raw; this
  route's request is fully typed, so there's no reason to give that up).
- `apps/web/app/(app)/orders/new/page.tsx` / `order-builder-form.tsx` / `actions.ts` — the
  complete structural precedent this proposal follows: required-query-param entry pattern,
  hidden-field-JSON dynamic-list-state convention, `state.status === 'created'` confirmation-card
  pattern (not a hard redirect), and the typed-client-plus-explicit-cast pattern for an
  undocumented-response create route.
- `apps/web/app/(app)/orders/[id]/page.tsx` — the exact conditional-action-button row this
  proposal's new entry-point link joins, and `GenerateInvoiceButton`'s own `order.status !==
  'cancelled'` gate, the closest existing precedent for gating a new action off order status.
- `docs/plans/task-630-block-ordered-test-ui.md` (issue #630's own proposal) — carried forward:
  `hasSpecimenManagementRole` as the correct capability-matching UI gate (this page's own action
  needs the exact same `manage_specimens` grant `addBlock`/`addSlide`/`screen`/`addOrderedTest`
  all already use), and the general "let the API's own message surface verbatim, no client-side
  business-rule duplication" discipline (applied here to the duplicate-case 400).

## 4. Skills loaded

- `engineering/frontend-design` (required — Affected Files add a new `apps/web` route with new
  Server and Client Components). Checked: no function-valued props cross the Server/Client
  boundary (`CaseAccessionForm` takes only plain string/object props — `orderId: string`, `order:
  Order` — same shape `OrderBuilderForm` already takes `catalog`/`referringFacilities` as plain
  props); the new `/cases/new` route sits at the same path depth as `/cases/[caseId]` and
  `/orders/new` sits at the same depth as `/orders/[id]` — confirmed this doesn't collide with
  the dynamic `[caseId]` segment (a literal `new` segment and a dynamic `[caseId]` segment at the
  same position don't conflict in Next.js's own routing — same as `orders/new` and `orders/[id]`
  already coexisting in this exact codebase, direct precedent, not just a rule read).
- `engineering/api-design` — not reloaded as required new reading since this proposal adds zero
  `apps/api` routes — `POST /v1/cases` is reused unmodified.

## 5. Assumptions & autonomous decisions

- **Entry point gated on `order.status !== 'cancelled'`**, matching `GenerateInvoiceButton`'s own
  exact gate rather than inventing a new one (e.g., gating on whether any ordered test looks
  "AP-shaped" — no such signal exists anywhere in the order/catalog data model, confirmed by
  grep). A cancelled order accessioning a new case is a genuine nonsense state; every other gate
  on that button row is about order lifecycle, not test content, and this one matches that
  pattern. Flagged explicitly in §10 since it's a real design call, not a forced one.
- **No client-side "already has a case" pre-check.** The unique constraint
  (`ux_case_tenant_order`) is enforced server-side with a clear message; adding a client-side
  check would mean either a new read endpoint (out of scope) or trusting a possibly-stale read —
  the API's own 400 is authoritative and immediate.
- **One combined submission for the whole case**, matching the backend's own "one combined create
  action" shape exactly — never one API call per part. The dynamic-row UI only ever produces a
  single `POST /v1/cases` call with a `parts` array, regardless of how many rows the user added.
- **`specimenType` is a free-text input, not a dropdown**, because the schema and DB genuinely
  impose no constraint on it (confirmed directly) — a curated dropdown would be a client-side
  invention of a business rule that doesn't exist anywhere else in this codebase, the same
  "don't duplicate/invent business rules client-side" discipline #621's and #624's own proposals
  already established for different fields. Flagged in §10 since a free-text field for something
  this structurally important (it drives `requiresTwoTierReview`'s own cytology-detection logic)
  is worth a deliberate confirm, not a silent default.
- **Rejection reason is optional per part, defaulting to "None."** Per the schema's own design
  (`rejectionReason?`), a part with a rejection reason is created directly in `rejected` status —
  a genuine, deliberate feature (a specimen can arrive already unsuitable), not a workaround.
- **No "add another order" or patient-search entry point from this page itself** — matches
  `orders/new`'s own "entry point is exclusively from an existing screen with a required query
  param, not a standalone searchable page" precedent exactly, avoiding a second, parallel
  order/patient lookup implementation.

## 6. Risks

- **Low-to-moderate.** Larger surface than the prior six proposals (a new page + two new
  supporting files, dynamic client-side list state), but every individual piece reuses an
  already-established, already-tested convention from `orders/new`'s own real, shipped
  implementation — no genuinely novel pattern is introduced.
- The free-text `specimenType` field (§5) is the one place a typo has real consequences —
  specifically, `requiresTwoTierReview()`'s own `CYTOLOGY_SPECIMEN_TYPES = ['cervical_cytology']`
  exact-string match (case.tiering.ts) means a mistyped specimen type silently skips the two-tier
  cytology workflow entirely, with no error anywhere (the case just accessions normally, and
  issue #624's own Screen action would then correctly-but-confusingly 400 with "does not require
  screening" for what should have been a cytology case). This is not a new risk introduced by this
  proposal — the same exposure already exists for every case created via direct API call all
  session — but it's worth surfacing explicitly rather than silently inheriting. Mitigation
  considered and rejected for this pass: a curated dropdown would need this codebase's first-ever
  client-side specimen-type value list, duplicating (and risking drift from) the one canonical
  cytology-type list that already lives in `apps/api` — see §10 Q2.
- Dynamic list state (add/remove rows) has no persistence across a failed submission beyond
  React's own client state — a submission that 400s leaves the rows exactly as typed (the page
  doesn't reload), so no data loss, but this is worth confirming live rather than assumed.

## 7. Acceptance criteria

1. A `manage_specimens`-granted user (technologist or verifier) viewing a non-cancelled order sees
   a "New AP case" link; a cancelled order shows no such link.
2. Navigating to `/cases/new` with no `orderId` query param shows a real error state (matching
   `orders/new`'s own missing-`patientId` error), not a crash or silent redirect.
3. Submitting the form with one part (a specimen type, no rejection reason) creates a case with a
   real accession number and one `accessioned`-status specimen part; the confirmation card shows
   the accession number and links to the new case's own detail page (already fully built out by
   #615/#621/#624/#627/#630 — the case is immediately usable end to end from there).
4. Adding a second part row before submitting creates a case with two specimen parts in one
   transaction, each with its own correctly-derived part accession number (`{case}-P1`,
   `{case}-P2`).
5. Setting a rejection reason on a part creates that part with `status: 'rejected'` and the chosen
   reason, not `accessioned`.
6. Submitting a second time for the same order (e.g., via back-navigation and resubmit) shows the
   API's own "already has a case" message verbatim, no new case created.
7. Removing a row (when more than one exists) works correctly; attempting to submit with zero
   parts is prevented client-side with a clear message.
8. No change to `POST /v1/cases`'s own business logic, any other AP mutation, or any existing e2e
   assertion.

## 8. Testing plan

- No new `apps/api` e2e tests — `create()`'s behavior is already exhaustively covered by
  `case.e2e-spec.ts` (this session's own repeated direct use of this exact route all session is
  itself informal, extensive proof it works correctly), and this proposal adds no backend route or
  logic change.
- No new `apps/web` automated tests (matching every prior AP-page proposal's own precedent — no
  page-level test coverage exists for any AP or order screen in this app yet).
- Manual/browser verification (`web-verify` Skill), broader than the prior six passes given the
  larger surface: as a technologist, open a real order's detail page, follow "New AP case" (AC
  #1), submit with one part (AC #3), follow the confirmation link to the new case and confirm the
  #615/#621/#624/#627/#630 UI all still works correctly on a case created this way (not just
  API-seeded ones — a genuine first for this session); create a second case with two parts, one
  of them rejected (AC #4/#5); attempt a duplicate case on an already-cased order (AC #6); test
  the missing-`orderId` error state (AC #2) and the zero-parts client-side guard (AC #7).

## 9. Rollback plan

Revert the commit(s). No migration, no backend route change — a plain `git revert` fully restores
prior (API-only) behavior.

## 10. Questions requiring human approval

1. Confirm gating "New AP case" on `order.status !== 'cancelled'` (matching `GenerateInvoiceButton`'s
   own exact gate) is the right condition, rather than always showing it or picking a different
   status check.
2. Confirm a free-text `specimenType` input (matching the backend's own genuinely unconstrained
   field) is acceptable for this pass, accepting the real typo-risk named in §6, rather than
   introducing this codebase's first client-side specimen-type value list (which would need its
   own source of truth decision — a new shared constant, or just the one known cytology value
   `'cervical_cytology'` plus free text for everything else).
3. Confirm no order-status/order-content pre-check beyond §5's own "match `GenerateInvoiceButton`'s
   gate" decision — e.g., should accessioning be blocked if none of the order's ordered tests look
   AP-relevant? (No such signal exists in the data model today, so this would need new scope; flagged
   only so the human can explicitly say "not now" rather than it being silently assumed.)
