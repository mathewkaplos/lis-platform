# Implementation Proposal: Case-level signed report PDF download
Status: APPROVED
ADR: adr-0051 (FEAT-059, existing)    Date: 2026-08-20    Backlog ID: issue #648 (lis-platform)

## 1. Goal

Give any authenticated tenant member a way to download a real PDF of a case's signed report —
any version, not just the latest — closing #610's own last major unbuilt UI gap. Today, no `GET`
route of any kind exists for `case_report_version` content; the only place it's ever visible is the
synchronous JSON response of `finalize()`/`amend()` at the instant a version is created.

## 2. Affected files

- `apps/api/src/case/case-report-render.ts` (new) — a pdfkit-based renderer, own input shape (not a
  reuse of `apps/api/src/report/report-render.ts`, which is `ChemistryReportInput`-shaped and
  structurally specific to ordered-test analyte results).
- `apps/api/src/case/case-report-content-assembler.ts` (new) — rejoins a `case_report_version`
  row's `includedContent` against live `specimen`/`block` and `observation`/`synoptic_element` data
  into a fully human-readable shape the renderer consumes. Kept separate from the renderer itself
  (mirrors `report-assembly.ts`/`report-render.ts`'s own separation of "gather data" from "draw
  PDF").
- `apps/api/src/case/case.controller.ts` — new route
  `GET v1/cases/:id/report-versions/:versionId/pdf`.
- `apps/web/app/(app)/cases/[caseId]/report-versions/[versionId]/download/route.ts` (new) — Route
  Handler mirroring `apps/web/app/(app)/orders/[id]/report/[orderedTestId]/download/route.ts`
  exactly (server-side authenticated `fetch`, streams PDF bytes back,
  `Content-Disposition: attachment`).
- `apps/web/app/(app)/cases/[caseId]/page.tsx` — add a "Download" link per row in the existing
  "Report versions" list.
- `apps/api/test/case-sign-out.e2e-spec.ts` — new e2e coverage for the PDF route (real PDF bytes
  returned, correct content-type/disposition, RLS/tenant isolation, a nonexistent version 404s).

## 3. Architecture consulted

- ADR-0051 / `docs/plans/feat-059-*.md` (digital signature — the content this renders).
- `apps/api/src/report/report.controller.ts` + `report-render.ts` + `report-assembly.ts` (the
  existing, structurally similar but not directly reusable per-ordered-test PDF precedent).
- `apps/web/app/(app)/orders/[id]/report/[orderedTestId]/download/route.ts` +
  sibling `page.tsx` (the literal browser-facing pattern this feature mirrors).
- Issue #615's own `GET /v1/cases/:id/report-versions` (the metadata list this feature adds a
  download action to).
- `engineering/pdf-generation` Skill entry #6 (pdfkit `PDFDocument` constructor `info`-timing
  gotcha — re-confirmed present and unchanged, `report-render.ts:247-267`).

## 4. Skills loaded

- `api-design` (required — new `apps/api` route). Entry #6 (only mutating actions are audited —
  this route is a pure read of already-signed, immutable content; no new `report` row, no audit
  event, matching `GET /v1/cases/:id/report-versions`'s own precedent, not the ordered-test PDF
  route's own write-and-audit shape). Entry #7 (cross-tenant access 404s, never 403 — RLS via
  `TenantContextInterceptor` is the only tenant boundary, same as every other case route this
  session).
- `frontend-design` (required — new `apps/web` route + page edit). Entry #5 (a route whose whole
  point is a clean download must be reached via a plain `<a>`, not `next/link` — directly
  applicable here, matching the ordered-test viewer's own established precedent).
- `pdf-generation` (required — new renderer). Entries #3 (hash the canonical input, not output
  bytes, if determinism is ever needed) and #6 (constructor-`info` timing) both apply directly.

## 5. Assumptions & autonomous decisions

**5.1 — No new `report` row, no audit event on this route.** Unlike the ordered-test PDF route
(which persists a new `report` row + audit event on every call, since regenerating a preliminary
report *can* reflect newly-verified results — a real new fact each time), a `case_report_version`
is already signed and immutable at creation time. Re-rendering its PDF on a later download is a
pure, deterministic read of already-final content — there is no new fact to record. Matches
`GET /v1/cases/:id/report-versions`'s own no-audit precedent (`api-design` entry #6), not the
ordered-test route's write-and-audit shape.

**5.2 — `case-report-content-assembler.ts` rejoins, not the renderer itself.** `includedContent`'s
`synopticResponses` are `{id, createdAt}` references (safe to rejoin against `observation`, which
is immutable post-verification via a real DB trigger — confirmed directly, not assumed, same
reasoning `buildCaseReportContent()`'s own header comment already documents) — this needs a join
against `observation` (for the value) and `synoptic_element` (for the label), keyed by
`observation.id`. `parts`/`blockIds` need a join against `specimen`/`block` for
`specimenType`/block codes. `narrative` needs no rejoin (already a full value snapshot per issue
#636). Splitting "assemble the renderable content" from "draw the PDF" mirrors
`report-assembly.ts`/`report-render.ts`'s own existing separation, not a new pattern.

**5.3 — `GET`, not `POST` — a deliberate divergence from the ordered-test precedent.** The
ordered-test route is `POST` because it's side-effecting (writes `report`/`audit_event` every
call). This route writes nothing (5.1), so `GET` is the honest HTTP-semantics choice — a repeatable,
cacheable-in-principle read, not an action. `StreamableFile` is still the right response mechanism
for binary content either way; the transaction-commit-ordering hazard the ordered-test route's own
header comment documents (§ found via `report.controller.ts:59-74`) doesn't apply here since there's
no write to commit before the bytes stream.

**5.4 — Per-version, not "latest only."** `GET /v1/cases/:id/report-versions` already exposes every
version's id, newest-first. A specific historical/superseded version's own PDF is a real, plausible
audit/legal need (an amended report's *prior* version is exactly the kind of thing a dispute would
need to produce) — the route addresses `:versionId` explicitly rather than resolving "current" on
the server's behalf.

**5.5 — Rendered layout is fixed/hard-coded chrome, not template-driven.** `report_template`/
`report_template_version` is keyed strictly to `testDefinitionId`
(`ux_report_template_tenant_test_definition`, confirmed directly in
`packages/db/src/schema/report-template.ts:35-44`) — a real structural mismatch for case-level
content, which has no single `testDefinitionId` to key against. Matches the ordered-test renderer's
own boundary: patient/specimen/order header and verification footer are fixed, non-configurable
chrome; only that route's *results body* is template-driven, and this route has no equivalent
"body" concept to templatize. A future case-level template system is a real, separate, much larger
feature — not attempted here.

## 6. Risks

- **Rejoin correctness**: if a synoptic element or response option is ever deleted/renamed after a
  report was signed (not currently possible via any existing route — no delete/update path exists
  for `synoptic_element`/`synoptic_element_response_option` today, confirmed by grep), the rejoin
  could show a stale or missing label. Named, not mitigated further — the same latent risk already
  exists for `buildCaseReportContent()`'s own reference-not-snapshot choice for synoptic responses
  (issue #636's own research explicitly accepted this for `observation`, whose values are
  immutable; element *definitions* being immutable too is a reasonable but unverified assumption,
  since nothing currently exercises an element-definition change after publication).
- **A missing rejoin target** (e.g. a `specimen`/`block` row somehow deleted after signing — not
  currently possible via any existing route either) would need explicit handling: render the
  content that's available with a plain "not available" placeholder for the missing piece, never
  silently omit it or crash the whole PDF.
- **Renderer complexity**: a full case (multiple parts/blocks/slides, narrative, several synoptic
  protocol responses) is a materially bigger rendering surface than one chemistry panel. Scoped
  down deliberately (§7 AC #2) to keep the first version simple and correct over visually polished.

## 7. Acceptance criteria

1. `GET /v1/cases/:id/report-versions/:versionId/pdf` returns a real PDF (`Content-Type:
   application/pdf`, `Content-Disposition: attachment`) for a version belonging to the case; 404 for
   a nonexistent version id or a version belonging to a different case.
2. The rendered PDF includes: case accession number and status context; each part's specimen type
   and accession number with its block codes; the narrative (gross/microscopic/diagnosis, only
   non-null fields); every synoptic response's element label and value, grouped by which
   `orderedTestId`/protocol they came from if more than one protocol was recorded on the case;
   the version's own signing metadata (version number, status, signed by role, signed at, reason if
   amended).
3. A "Download" link appears per row in the case detail page's existing "Report versions" list,
   reached via a plain `<a>`, triggers a real browser file save.
4. Cross-tenant version id access 404s (RLS), matching every other case route's own established
   behavior.
5. No new `report` row or `audit_event` is written by this route (5.1) — confirmed by a real e2e
   assertion (row counts unchanged before/after the call), not just reasoned about.

## 8. Testing plan

- New e2e case in `case-sign-out.e2e-spec.ts`: finalize a real case with narrative + at least one
  synoptic response, call the new PDF route, confirm a `200` with `application/pdf` content-type
  and real non-empty PDF bytes (starts with `%PDF-`); confirm `report`/`audit_event` row counts are
  unchanged before/after (AC #5); confirm a second call (re-download) produces byte-identical output
  given unchanged input (determinism, matching `pdf-generation` entry #3's own discipline) —
  or explicitly document why not, if a genuinely non-deterministic element turns out to be
  unavoidable (e.g. `CreationDate` if not pinned the same way `report-render.ts` already pins it).
- Regression: `nonexistent versionId` → 404; a version id belonging to a real case under a
  different tenant (via `tokenB`) → 404 (RLS).
- Live browser verification (`web-verify`): the Report versions list shows a working "Download"
  link per row; clicking it produces a real browser download; the PDF's own text content (checked
  via a real PDF-text-extraction step, not `pdf.toString('latin1')` per `pdf-generation` entry #7's
  own documented unreliability of that approach against compressed content streams) contains the
  case's real accession number, narrative text, and at least one synoptic response's real label and
  value.

## 9. Rollback plan

Purely additive: two new backend files, one new route, one new frontend route handler, one small
edit to an existing list (adding a link). No migration, no schema change, no change to any existing
route's behavior. Revert is a plain `git revert`.

## 10. Questions requiring human approval

All three resolved by explicit human walkthrough, 2026-08-20 — recommended defaults taken in every
case:

**Q1 — Capability gate for the new route. RESOLVED: `JwtAuthGuard`-only, matching
`report-versions`.** This route is a pure read of content already reachable in less-readable form
via other JwtAuthGuard-only routes (the version metadata itself, plus the case's own narrative via
`GET /v1/cases/:id`), not a generate-and-persist action the way the ordered-test route's own
`verify` gate protects. RLS remains the real tenant boundary.

**Q2 — Grouping synoptic responses by protocol in the rendered PDF. RESOLVED: group by
part/protocol**, resolved via each response's own `orderedTestId` → order → the synoptic protocol
version used — clearer for a real multi-part case (confirmed possible this session — issue #645's
own live-verification case had Breast/Colorectal/Cervical-Cytology parts on one case).

**Q3 — Missing-rejoin-target handling. RESOLVED: render `"[data unavailable]"` inline**, never
silently drop the line or fail the whole render — an honest placeholder makes a data gap visible
rather than invisible, matching this session's own "logged no-op over crash for an expected-shaped
gap" discipline.
