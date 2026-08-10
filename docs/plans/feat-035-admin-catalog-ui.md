# Implementation Proposal: FEAT-035 Admin catalog UI
Status: **APPROVED** (2026-08-10) — §10's open questions resolved by the human via the native
options-prompt (2026-08-10), all three decided as the recommended option; proposal approved the
same session.
ADR: none yet — §10 Q1 (below) is a genuinely load-bearing, ADR-shaped decision (a tenant-scoped
admin action reaching into global, cross-tenant-visible data) that this proposal deliberately does
not decide unilaterally; if the human resolves it toward allowing analyte authoring, that resolution
should be its own ADR before implementation, not folded silently into this feature's own docs.
Date: 2026-08-10    Backlog ID: FEAT-035 (#44)

**§10 resolved 2026-08-10, all three questions decided as the recommended option:** Q1 (analyte
creation): descoped for this proposal — not built; a future, separate decision. Q2 (§20.5
Templates screen): deferred entirely — not built. Q3 (reference-range editing): add-only, no
archive/supersede flow. Every §5 assumption already matched these — no changes needed to the
design itself, only this record of confirmation.

## 1. Goal

M7's own FEAT-032 (Template engine) shipped this session (PR #447, closing #41). Of M7's three
remaining features, **FEAT-035 is the only Critical-priority item left**, and its one dependency,
`FEAT-004` (Catalog metadata model), has been closed since M1 — genuinely unblocked, not just
next-in-sequence (FEAT-033/034 are both High priority and also unblocked, but neither carries M7's
one Critical label).

FEAT-035's own literal AC: **"A lab admin can add a new analyte, test, and reference range entirely
through the UI."** Its own "Google Stitch prompts required" section names two screens: **§20.4
Reference Ranges** and **§20.5 Templates**.

**Real, load-bearing finding #1 — the literal AC's own "add a new analyte" collides directly with
ADR-0004's own explicit, deliberate scope boundary, and this proposal does not resolve that
collision unilaterally.** `analyte`/`unit`/`code_system_value` (`packages/db/src/schema/catalog.ts`)
are **global reference tables — no `tenant_id`, no RLS** (ADR-0004): "pure coding-standard reference
data... shipped and maintained by the platform, identical across every tenant." ADR-0004's own
"Consequences" section states this plainly: *"A future tenant that needs to diverge from a shipped
analyte/unit definition... has no per-tenant override mechanism yet. That is deliberately out of
scope here — if it becomes a real requirement, it is a new decision (a tenant-level overlay/override
table), not a reason to retrofit RLS onto the global tables themselves."* A tenant-scoped "lab admin"
role authoring a brand-new `analyte` row through the UI is not a per-tenant override — it is a
**write to genuinely global, every-tenant-visible platform data, from a single tenant's own admin
action**, a real cross-tenant blast-radius question ADR-0004 explicitly reserved for a future,
separate decision. This is flagged at §10 Q1, not decided here.

**Real, load-bearing finding #2 — "add a new test" and "add a new reference range" are both
genuinely tenant-scoped, uncontroversial extensions of already-RLS'd tables, with a real, working
precedent to follow.** `test_definition`/`test_analyte`/`panel`/`panel_test` (TASK-017) and
`reference_range` (TASK-018) all already carry `tenant_id` + RLS, exactly the "labs validate their
own ranges... may define their own custom panels" case ADR-0004 itself names as the *contrasting*
example to the global tables. No new migration is needed for either — this proposal is additive at
the API/UI layer only.

**Real, load-bearing finding #3 — `reference_range`'s schema already carries real versioning/
effective-dating columns (`effectiveFrom`/`effectiveTo`/`priority`), directly matching §20.4's own
prompt text ("add/edit with versioning/effective-dating and snapshot note").** TASK-018 built this
in from the start — no schema change is needed to satisfy §20.4's own stated requirement; this
proposal's own job is exposing create/list routes and a UI over columns that already exist.

**Real, load-bearing finding #4 — §20.5 (Templates) is named in the "Google Stitch prompts
required" section but not in the literal AC at all, and its own prompt text ("open in a
template-designer placeholder... field palette, drag-drop layout") describes exactly the KB-13
visual designer FEAT-032's own approved proposal deliberately deferred (§10 Q2, resolved: API/JSON
authoring only, no UI).** Building even a "placeholder" designer screen now would be scope FEAT-032
itself explicitly declined to build, inside a different feature's proposal, without a fresh
human decision. Read the same way this session has read every KB/Stitch-reference-vs-literal-AC
mismatch so far (FEAT-016 vs. KB-12, FEAT-029 vs. KB-25): **this proposal's approvable scope is the
literal AC only — analyte (flagged, §10 Q1), test, and reference range.** §20.5 Templates is
flagged at §10 Q2 as a real, nameable follow-on, not silently dropped.

**Real, load-bearing finding #5 — no admin/mutation route exists anywhere in this catalog area
today; `GET /v1/catalog` (TASK-043) is the only existing route, and it is read-only.** Confirmed by
reading `apps/api/src/catalog/catalog.controller.ts` in full: one `@Get()` handler, no capability
gate (informational browsing), no `@Audit()`. Every route this proposal adds is new.

## 2. Affected files

**Backend (all new; no route in `catalog.controller.ts` is modified):**
- `apps/api/src/auth/capabilities.ts` — new `manage_catalog` capability, granted to `qa` (mirroring
  `manage_workflow`/`manage_report_templates`'s identical "lab-oversight, not day-to-day" reasoning).
- `packages/domain/src/catalog.ts` — new `testDefinitionCreateSchema` (code, displayName,
  analyteIds: existing analyte ids to bind via `test_analyte`) and
  `referenceRangeCreateSchema`/`referenceRangeSchema` (mirroring `reference_range`'s own columns),
  single source of truth for validation + OpenAPI (`engineering/api-design` entry #1).
- `apps/api/src/catalog/test-definition.controller.ts` (new) — `POST /v1/test-definitions`
  (audited, `manage_catalog`-gated): creates a `test_definition` row + one `test_analyte` row per
  bound analyte id, in one transaction.
- `apps/api/src/catalog/reference-range.controller.ts` (new) — `POST /v1/reference-ranges`
  (audited, `manage_catalog`-gated): creates a new `reference_range` row; `GET /v1/reference-ranges`
  (ungated read, filterable by `analyteId`, mirroring `GET /v1/catalog`'s own gate-free-read
  convention) for the admin table.
- `apps/api/src/catalog/catalog.module.ts` — registers the two new controllers.
- `apps/api/src/app.module.ts` — no change (`CatalogModule` already imported).

**Frontend:**
- `apps/web/app/(app)/admin/reference-ranges/page.tsx` (new) — §20.4: a `DataTable` of
  `reference_range` rows (analyte, sex, age band, method, low/high, unit, range type, effective
  dates), filterable by analyte, with an "Add range" `SlideOver` form built from `FormField`/`Input`
  primitives, mirroring `qc-violations/page.tsx`'s existing table+actions structure.
- `apps/web/app/(app)/admin/reference-ranges/reference-ranges-table.tsx` (new) — the `DataTable`
  columns + `SlideOver` form component (a Client Component, per `frontend-design` Skill entry #6 —
  `DataTable`'s function-valued `columns` prop cannot cross the Server→Client boundary from a plain
  Server Component).
- `apps/web/app/(app)/admin/reference-ranges/actions.ts` (new) — Server Action calling
  `POST /v1/reference-ranges`, mirroring `qc-violations/actions.ts`'s own shape.
- `apps/web/app/(app)/admin/tests/page.tsx` (new) — a simpler "create a test" screen: a form
  selecting one or more existing analytes (from `GET /v1/catalog`'s own already-fetched-everywhere
  analyte list) and binding them to a new `test_definition` via `POST /v1/test-definitions`.
- `apps/web/app/(app)/admin/tests/actions.ts` (new) — Server Action for the create call.
- `apps/web/app/(app)/_components/` (existing sidebar nav) — an "Admin" nav entry, visible only to
  `qa`-role sessions (mirroring `manage_workflow`'s own UI-side role gate, if such a gate already
  exists on the sidebar — checked at implementation time; if none exists yet for `manage_workflow`
  either, this task adds the first one, not a new pattern already established and merely unused).

**Not affected under this proposal's own scope (§10-gated or explicitly deferred):**
- No new `analyte`/`unit`/`code_system_value` write route — blocked on §10 Q1.
- No `panel`/`panel_test` write route — not named in the literal AC.
- No report-template list/designer screen (§20.5) — blocked on §10 Q2, and already has a real,
  separate API-only mechanism from FEAT-032 if/when a UI is built later.
- No update/archive route for an existing `test_definition`/`reference_range` row — the literal AC
  says "add," not "edit"; a natural, small follow-on, not built speculatively here.
- No migration — every target table already has RLS from TASK-017/018.

## 3. Architecture consulted

- **KB-15 Reference Ranges** — the multi-dimensional resolution model (sex/age/method/condition/
  population), already fully reflected in `reference_range`'s own existing columns (finding #3); this
  proposal exposes create/list over that shape, it does not change it.
- **ADR-0004** (Catalog reference tables are global) — the direct source of finding #1/§10 Q1; read
  in full, including its own "Alternatives rejected" (a tenant-level overlay/override table) as the
  real design space if Q1 resolves toward allowing analyte authoring later.
- **Google Stitch Prompt Library §20.4/§20.5** — the two named screens; §20.4's own text ("Pattern A
  + editor... data-dense config screen... States/dark/a11y per §0") is the direct source of this
  proposal's `DataTable` + `SlideOver` structure.
- **`engineering/api-design` Skill** — entry #5 (audit + capability-gate ordering — every new
  mutating route here needs both, together), entry #6 (reads aren't audited — `GET /v1/reference-
  ranges` stays ungated/unaudited), entry #15 (an `@Audit()` route must return `{resourceId,
  before?, after?}` — checked for both new `POST` routes), entry #1 (Zod schema lives in
  `packages/domain`, drives both validation and OpenAPI).
- **`engineering/frontend-design` Skill** — entry #1 (no color-only flags — not directly triggered
  here, no clinical-flag rendering in this screen, but checked), entry #6 (`DataTable`'s function
  props require a Client Component wrapper), entry #4 (`transpilePackages` already wired, nothing
  new needed unless a new `packages/ui` primitive is added, which this proposal doesn't add one).
- **`apps/api/src/catalog/catalog.controller.ts`** (TASK-043) — the existing read shape/join
  pattern (separate queries + in-memory maps, not `.innerJoin()`) reused for the new
  `GET /v1/reference-ranges` route's own analyte/unit resolution.
- **`apps/web/app/(app)/qc-violations/`** (existing) — the closest existing "list + slide-over
  action" screen precedent; its `page.tsx`/`*-table.tsx`/`actions.ts` three-file split is reused
  as-is, not a new page-composition pattern.

## 4. Skills loaded

- `engineering/frontend-design` — as cited in §3; this is also the first feature to genuinely
  exercise this Skill since its own "not (yet) covered here" section named FEAT-035 explicitly as
  the feature that would give it real usage to learn from.
- `engineering/api-design` — entries #1/#5/#6/#15, the route/audit/schema conventions this
  proposal's two new controllers must follow.
- `engineering/database-design` — checked for whether any new column/table is needed; confirmed
  none is (finding #2/#3), so no entry here is directly triggered, but the check itself is the
  point (don't assume a migration is needed without checking).

## 5. Assumptions & autonomous decisions

- **Analyte creation is out of scope for this proposal's approvable slice** (finding #1) — flagged
  at §10 Q1 for explicit human resolution before any code touching `analyte`/`unit`/
  `code_system_value` is written.
- **Panel creation/editing and the §20.5 Templates screen are out of scope** (findings #2/#4) —
  natural follow-on revisions to this same proposal file, not built speculatively now.
- **Editing or archiving an existing `test_definition`/`reference_range` row is out of scope** — the
  literal AC says "add," not "edit"; `POST` (create) only in both new controllers.
- **A new reference range is always a new, additive row — this proposal never mutates or
  auto-closes an existing row's `effectiveTo`.** If an admin needs to correct/end-date an existing
  range, that is a real, separate "archive/supersede" action, deliberately not built here (matching
  the literal AC's own "add," and avoiding an unrequested supersede-semantics decision this
  proposal's own scope doesn't need to make).
- **`manage_catalog` is one capability covering both test and reference-range creation**, not split
  per-resource — no stated reason yet to differentiate which `qa`-role actions are permitted
  independently; splitting later is additive, not a redesign, if a real need for that granularity
  emerges.
- **Test creation binds only already-existing global analytes** (via `test_analyte`) — since new
  analyte authoring is itself gated on §10 Q1, "add a new test" cannot depend on also being able to
  create a new analyte in the same flow; the admin picks from the existing catalog.

## 6. Risks

- **§10 Q1 is the central risk of this entire feature** — the literal AC's own "analyte" clause is
  either descoped (this proposal's default) or requires a real, separate ADR-shaped decision about
  cross-tenant-visible writes from a tenant-scoped role. Shipping this proposal's own narrowed scope
  without that resolution being visible to the human/reviewer would look like a silently-incomplete
  AC, not a deliberate, flagged narrowing — the PR description and this document's own §10 must both
  say so plainly.
- **A `qa`-role admin creating a `test_definition` with zero bound analytes** (an empty
  `analyteIds` array) would produce a test no order can ever meaningfully result — `report-
  assembly.ts`'s own existing `ConflictException` ("Test definition ... has no analytes defined")
  already guards the *report* path, but nothing guards *order entry* or *result entry* against an
  analyte-less test today. This proposal's own `POST /v1/test-definitions` should require at least
  one bound analyte (`analyteIds.min(1)` in the Zod schema) rather than relying on a downstream
  guard discovered later, the same "guard at the point of creation, not just at a distant consumer"
  discipline this repo has used before.
- **This is the first screen `manage_catalog`/any `qa`-only UI element gates in `apps/web`** — worth
  a reviewer's attention on whether the sidebar/nav-level role gate this proposal adds is the first
  of its kind or already has a precedent to match (checked at implementation time, per §2's own
  note).

## 7. Acceptance criteria

The issue's own literal AC, narrowed per findings #1–#5:
- [ ] A `qa`-role user can create a new `test_definition`, binding one or more existing analytes to
  it via `test_analyte`, entirely through the UI — the new test is immediately visible via
  `GET /v1/catalog`.
- [ ] A `qa`-role user can create a new `reference_range` for an existing analyte (sex/age-band/
  method/condition/range-type/low/high/effective-from, etc.) entirely through the UI, and the new
  row is visible in the admin table without a page reload requiring a manual refresh.
- [ ] Both create actions are audited (`@Audit()`, `manage_catalog`-gated) and rejected with 403 for
  a non-`qa` session.
- [ ] `POST /v1/test-definitions` rejects an empty `analyteIds` array (400) — never creates an
  analyte-less test.
- [ ] The Reference Ranges screen matches §20.4's own stated shape: a filterable, data-dense table
  plus an add form, states/dark-mode/a11y per Google Stitch §0.
- [ ] Analyte creation, panel creation/editing, edit/archive of existing rows, and the §20.5
  Templates screen are **not** built — explicitly out of scope, not silently missing.

## 8. Testing plan

1. New unit tests for the two new Zod schemas (boundary cases: empty `analyteIds`, missing
   required reference-range dimensions).
2. New e2e tests (`apps/api/test/catalog-admin.e2e-spec.ts` or similar): `POST /v1/test-definitions`
   happy path + 400 on empty `analyteIds` + 403 for non-`qa`; `POST /v1/reference-ranges` happy path
   + 403 for non-`qa`; `GET /v1/reference-ranges` filtering by `analyteId`; an audit-count delta
   proof for both `POST` routes (mirroring every prior audited-route test in this repo); RLS
   isolation (tenant B cannot see tenant A's new `test_definition`/`reference_range` rows — both
   tables already have RLS, this proves the new routes don't bypass it).
3. A real `web-verify` pass (headless browser): both new screens' four states (populated, empty,
   loading skeleton, error), keyboard navigation, WCAG 2.2 AA contrast, dark mode, zero console
   errors — per `frontend-design` Skill's own established discipline and this issue's own explicit
   Frontend-work checklist.
4. Repo-wide `pnpm typecheck`/`pnpm lint`/`pnpm build`, including `nest build`/`next build`.
5. `openapi.json`/`packages/sdk/src/schema.ts` regeneration for the two new routes.

## 9. Rollback plan

Fully additive: two new backend controllers + one new capability + two new `apps/web` routes/nav
entry. No existing route, table, or screen is modified. No migration exists to roll back — every
target table already has RLS from TASK-017/018. Reverting the PR removes the entire feature
cleanly.

## 10. Open questions — resolved 2026-08-10 via the native options-prompt

1. **Analyte creation (the literal AC's own "add a new analyte").** **Resolved: Option A.**
   - **Option A (recommended): descope for this proposal.** Ship test + reference-range creation
     only now; analyte authoring becomes its own follow-on decision (likely its own ADR, per
     ADR-0004's own named "ADR-shaped" alternative — a tenant-level overlay/override table, or a
     platform-admin-only tool distinct from a tenant's own `qa` role) once a real design-partner
     need for it is confirmed. Avoids inventing cross-tenant-blast-radius UI/authorization ahead of
     a concrete requirement.
   - **Option B: allow `qa`-role tenant admins to create new global analytes now**, accepting that
     the new row is immediately visible to every other tenant too. Satisfies the AC's literal
     wording today, at the cost of a real, unreviewed cross-tenant side effect from a tenant-scoped
     role's own action — no capability/audit precedent in this repo currently gates "an action by
     tenant A's user changes data every other tenant sees."
   - **Option C: allow analyte creation, but scoped as a tenant-private analyte** (requires
     inventing the tenant-level overlay/override table ADR-0004's own "Alternatives rejected"
     section names as future work) — satisfies the AC without the cross-tenant side effect, at the
     cost of a real, new schema decision this proposal's own ~6-day estimate did not budget for.

2. **§20.5 Templates screen.** **Resolved: Option A.**
   - **Option A (recommended): defer entirely** — not named in the literal AC; FEAT-032 already
     ships a working API-only mechanism; a real UI (even a "placeholder" one, per the Stitch
     prompt's own wording) is a separate, later decision once real usage pressure for one exists.
   - **Option B: build a minimal read-only list screen now** (name/status/version per template,
     using FEAT-032's own `GET /v1/report-templates`) — no "designer placeholder," just a list, a
     small addition reusing an API that already exists.

3. **Scope of "reference range" creation — should this proposal also support ending/archiving an
   existing range (not just adding new ones)?** **Resolved: Option A.**
   - **Option A (recommended): add-only**, matching the literal AC's own word choice. An
     edit/archive flow is a natural, small follow-on task once "add" is proven in real use.
   - **Option B: also support setting an existing range's `effectiveTo`** (a real "supersede" action)
     in this same proposal — more complete, but a real scope increase this proposal's findings
     didn't budget for, and risks conflating two different admin actions (add vs. correct) in one
     review.
