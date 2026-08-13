# Implementation Proposal: FEAT-067 — Digital pathology / whole-slide-image (WSI) viewer
Status: IMPLEMENTED (PR #582, merge commit f3a7080995facf5fca505d4c7e4a65010b8d2c14)
ADR: ADR-0054 (backfill — FEAT-061's own object-storage decision, never actually committed) +
ADR-0055 (new — WSI tile representation/storage/serving, KB-17's own named open question)
Date: 2026-08-13    Backlog ID: #549 (FEAT-067, milestone M13, no epic — EPIC-012 already closed;
same standalone-gap-closure standing as FEAT-065/066)

## 1. Goal

KB-17's own "Future considerations" names this directly: "Digital pathology / WSI viewer
integration for whole-slide review in-app." Its own "Open questions" section names the
prerequisite this proposal resolves: "WSI storage/streaming approach — how whole-slide images are
stored, tiled, and served at scale." FEAT-061 (image attachments) explicitly deferred this exact
scope in its own Goal statement: "Explicitly **not** a whole-slide-image (WSI) viewer or streaming
pipeline (issue #549, deferred)."

**A real, load-bearing scoping finding from this proposal's own research, confirmed with the human
before drafting further:** every one of M13's 8 shipped features (Case/Specimen/Block/Slide,
synoptic protocols, sign-out, reflex stains, image attachments) is API-only — no `apps/web` page,
route, or component exists anywhere for Case/Specimen/Block/Slide today. "A WSI viewer for
whole-slide review in-app" therefore has no "in-app" to review from yet. Rather than ship an
unreachable viewer or silently expand into a full AP frontend build-out, this proposal's scope is
the WSI mechanism itself **plus the minimal case/slide UI needed to reach it** — a cases list, a
case detail page (parts → blocks → slides), and the viewer — nothing broader (no synoptic-result
display, no sign-out UI, no image-attachment gallery for gross/microscopic photos).

## 2. Affected files

**ADR backfill (real gap found during this proposal's own research, not new scope):**
- `lis-engineering/adr/adr-0054-*.md` (new) — backfills FEAT-061's own object-storage decision
  (self-hosted MinIO, `@aws-sdk/client-s3` against MinIO's S3-compatible API, direct multipart
  upload not presigned browser uploads, presigned-GET-only reads). FEAT-061's own proposal names
  this as "ADR-0052... this proposal's own load-bearing decision, hence the new ADR" — but no such
  file was ever committed to `lis-engineering/adr/` (confirmed: `adr-0052-*.md` is patient merge,
  unrelated, from FEAT-065). This backfills the already-approved, already-shipped content as a real
  committed record, not a new decision.
- `lis-engineering/adr/adr-0055-*.md` (new) — this feature's own genuinely new decisions (§5 below).

**Schema (new table, tenant-scoped, RLS):**
- `packages/db/src/schema/whole-slide-image.ts` (new) — `wholeSlideImage`: `id`, `tenantId`,
  `slideId` (FK → `slide.id`, **not** the polymorphic `resourceType`/`resourceId` pattern
  `imageAttachment` uses — a WSI is a slide-specific artifact of a structurally different shape, a
  tile-pyramid set rather than one flat image, so a dedicated table with a direct FK is the honest
  model, not a forced fit into `image_attachment`'s existing `category` CHECK or single-`objectKey`
  column; see ADR-0055 §Alternatives), `status` (text, CHECK `'processing'|'ready'|'failed'` —
  unzip-to-object-storage is a real multi-second-to-minutes operation that can genuinely fail
  partway, unlike FEAT-061's single-buffered-PUT upload which either succeeds or 500s outright),
  `tileObjectPrefix` (text, e.g. `{tenantId}/wsi/{id}/` — every tile plus the `.dzi` descriptor
  live under this prefix, same per-tenant-prefixed key convention `image-attachment.controller.ts`'s
  own `objectKey` construction already establishes), `dziObjectKey` (text, nullable until
  `status = 'ready'` — the specific key of the `.dzi` XML descriptor within the prefix),
  `errorMessage` (text, nullable — populated only on `status = 'failed'`), `uploadedByUserId`
  (uuid, no FK, same "no user table yet" convention as `imageAttachment.uploadedByUserId`),
  `createdAt`. Multiple rows per slide allowed (a rescan is a real, plausible event) — no
  supersede/version chain built for v1 (no named requirement for it; the case detail page shows
  only the most recent `ready` row per slide).
- `db/migrations/00XX_whole_slide_image.sql` (generated).
- `packages/db/src/rls-isolation-check.ts` — new fixture for `whole_slide_image` (the
  #430/#535/#536/#549(FEAT-066) pattern, now confirmed 4 times: any new tenant table needs its own
  fixture here or the live cross-tenant leak check silently can't prove isolation for it).

**Domain:**
- `packages/domain/src/whole-slide-image.ts` (new) — `wholeSlideImageStatusSchema`,
  `wholeSlideImageSchema` (mirrors the row), `wholeSlideImageTilePathQuerySchema` (`{ path:
  z.string().min(1) }`, validates the query-string tile path — see §5 on why a query param, not a
  wildcard route segment).

**API (new module):**
- `apps/api/src/whole-slide-image/dzi-unzip.service.ts` (new) — pure-ish, unit-testable logic
  (mirrors `billing.service.ts`'s own `validateAndTotal` extraction pattern): given a zip entry
  stream (`unzipper`'s streaming API, not buffered — FEAT-061's own upload buffered the whole file
  into memory and explicitly flagged that as acceptable *because* it wasn't WSI-scale; this feature
  is exactly the "future caller that needs streaming" `putObjectStream`'s own header comment already
  anticipated), streams each entry to object storage under `tileObjectPrefix + entry.path`, finds
  exactly one top-level `.dzi` file among the entries (the standard `vips dzsave`/OpenSlide
  `deepzoom` output shape: one `<name>.dzi` XML file plus a sibling `<name>_files/` tile-pyramid
  folder), and returns its key or throws if zero or more than one `.dzi` file is found.
- `apps/api/src/whole-slide-image/whole-slide-image.controller.ts` (new):
  - `POST v1/whole-slide-images/slides/:slideId` — multipart upload of one `.zip`. Validates
    `slideId` resolves to a real, tenant-visible `slide` row first (mirrors
    `image-attachment.controller.ts`'s own `resourceExists` check). Inserts a `status: 'processing'`
    row, streams the zip through `dzi-unzip.service.ts`, updates to `status: 'ready'` +
    `dziObjectKey` on success or `status: 'failed'` + `errorMessage` on any error (never throws past
    this point — the row itself is the durable record of failure, matching `case.controller.ts`'s
    own "the row is the state," not an exception the caller must separately handle). `201`,
    `manage_specimens` capability (same as `image-attachment.controller.ts`'s upload route), **not**
    `@Audit()`'d (matches that same sibling route's own precedent exactly — a real, already-approved
    choice, not reinvented here).
  - `GET v1/whole-slide-images/:id` — metadata only (status, slideId, createdAt) — no capability
    gate, `JwtAuthGuard` + `TenantContextInterceptor` only (matches `case.controller.ts`'s own
    read-route precedent).
  - `GET v1/whole-slide-images/:id/tiles?path=<relative path>` — validates the WSI row resolves
    (tenant-scoped, `404` if not — `api-design` Skill entry #7), resolves
    `tileObjectPrefix + path` against object storage, and returns a **302 redirect** to a
    fresh `getPresignedDownloadUrl` (60-second expiry — long enough for one browser fetch, short
    enough not to become a durable leaked credential) for that exact object — never proxies tile
    bytes through the API itself, extending FEAT-061's own "reads never proxy bytes through the API"
    principle to a request shape (hundreds to thousands of small sequential fetches per viewing
    session) FEAT-061 itself never had to handle.
- `apps/api/src/whole-slide-image/whole-slide-image.module.ts` (new).
- `apps/api/src/app.module.ts` — wires `WholeSlideImageModule`.
- `apps/api/package.json` — new dependency: `unzipper` (+ `@types/unzipper`). Pure-JS streaming zip
  reader, no native/compiled dependency — matches this repo's existing "no native deps" posture
  (unlike, e.g., `sharp`/`libvips` bindings, which this proposal deliberately does not need since it
  never decodes or re-tiles image pixels itself, only relocates already-tiled bytes).
- `apps/api/test/whole-slide-image.e2e-spec.ts` (new) — real MinIO round-trip against a tiny
  synthetic fixture (a handful of 1×1-pixel-tile levels, zipped), proving: upload → `processing` →
  `ready` with a real `dziObjectKey`; a bad zip (no `.dzi`, or two) → `failed` with a real
  `errorMessage`; the tile-redirect route actually 302s to a URL that resolves the exact uploaded
  bytes when fetched directly (not just asserting the redirect's shape); cross-tenant `slideId` →
  `400`; cross-tenant WSI `id` on the tile route → `404`.
- Real compiled-server boot check (`api-design` Skill entry #10) for the new routes — **not**
  because a wildcard/colon-suffix syntax is used here (deliberately avoided, see §5), but because
  this is the first route in this repo to issue a real `302` from a NestJS/Fastify handler at all;
  confirmed the redirect actually reaches the browser correctly under the real compiled server, not
  assumed from the e2e harness's Express-backed proof alone.

**Frontend (new — the minimal case/slide UI + viewer, per this proposal's own §1 scoping):**
- `apps/web/app/(app)/cases/page.tsx` (new) — a plain list, `GET /v1/cases`, `DataTable` (accession
  number, status, createdAt) — mirrors `patients`/`orders` list pages' own shape, top-level nav
  item (operational data, not `/admin/*` config).
- `apps/web/app/(app)/cases/[id]/page.tsx` (new) — `GET /v1/cases/:id`, renders the parts → blocks →
  slides tree. Each slide row: a "View whole-slide image" link if a `ready`
  `wholeSlideImage` exists for it, an inline upload form if not. **Requires extending
  `caseLineageBlockSchema`'s `slides` field** — currently `z.array(slideSchema)` with no WSI
  awareness — with a new `caseLineageSlideSchema = { ...slideSchema.shape, wholeSlideImage:
  z.object({ id: z.uuid(), status: wholeSlideImageStatusSchema }).nullable() }`, and
  `case.controller.ts`'s `getById()` batch-fetching the most-recent `wholeSlideImage` row per
  resolved `slideId` (same batch-query shape the handler already uses for
  blocks/slides/fulfillments) — an additive, backward-compatible extension of an already-shipped
  response shape, same class of change FEAT-065/066 already made to `patient`/`order`/`invoice`
  responses this session.
- `apps/web/app/(app)/cases/[id]/upload-wsi-form.tsx` (new, `'use client'`) — the per-slide upload
  affordance, `useActionState` + `FormField`, mirrors `admin/tests/create-test-form.tsx`'s own
  shape.
- `apps/web/app/(app)/cases/[id]/actions.ts` / `types.ts` (new) — the upload Server Action (`'use
  server'` file exports only the async action, per `frontend-design` Skill entry #8 — the initial
  state constant lives in `types.ts`, not the actions file).
- `apps/web/app/(app)/cases/[caseId]/slides/[slideId]/viewer/page.tsx` (new, Server Component) —
  nested under the case, not a flat `/slides/[id]/viewer` (§10 Q4: resolves "the ready WSI for this
  slide" by re-fetching `GET /v1/cases/:caseId`'s already-extended lineage and reading the matching
  slide's `wholeSlideImage`, rather than adding a new `GET /v1/whole-slide-images?slideId=` filter
  route for a single-row lookup). `frontend-design` entry #9's own route-group-collision failure
  mode is about the *same* dynamic-segment name reused across *different* top-level route groups —
  `caseId`/`slideId` are distinctly named within one route group here, not that shape, so nesting is
  safe. Passes the resolved `wholeSlideImage.id` to the client viewer.
- `apps/web/app/(app)/cases/[caseId]/slides/[slideId]/viewer/wsi-viewer.tsx` (new, `'use client'`) — mounts
  OpenSeadragon against a **custom `TileSource`**, not a bare `.dzi` URL string: fetches the `.dzi`
  XML itself (via the same tile-proxy route, `path=<dziObjectKey relative to prefix>`), parses
  `Width`/`Height`/`TileSize`/`Overlap`/`Format` from it, and supplies a `getTileUrl(level, x, y)`
  callback that builds `/api/wsi-tiles/{wsiId}?path=<level>/<x>_<y>.<format>` — see §5 for why a
  custom tile-source over OpenSeadragon's default DZI-relative-URL convention. Dynamically imported
  (`next/dynamic`, `ssr: false`) — OpenSeadragon touches `window`/canvas at construction time, same
  general SSR-incompatibility class any canvas-heavy client library has in the App Router.
- `apps/web/app/api/wsi-tiles/[id]/route.ts` (new Route Handler) — **the first genuinely
  client-browser-facing proxy this codebase has needed.** Confirmed directly, not assumed: every
  existing `apps/web` → `apps/api` call today runs server-side (a Server Component or Server
  Action), carrying a bearer token fetched via `getValidAccessToken()`; no client component anywhere
  calls `apps/api` directly, and no `NEXT_PUBLIC_*` env var exposing `API_BASE_URL` to the browser
  exists. OpenSeadragon issuing one authenticated fetch per tile through a Server Action (one
  Next.js server round-trip per tile) is not workable at real tile-fetch volume. This route runs
  server-side (same-origin to the browser, so the existing `lis_session` cookie is sent
  automatically, no CORS/new public env var needed), reads `?path=`, calls `apps/api`'s tile route
  with a real bearer token, and forwards the resulting `302`'s `Location` straight back to the
  browser — zero tile bytes ever pass through `apps/web` either, same "reads never proxy bytes"
  principle held end to end across one extra authenticated hop.
- `apps/web/package.json` — new dependency: `openseadragon` (+ `@types/openseadragon`). MIT
  licensed, no server component of its own, the standard open-source DZI/IIIF deep-zoom viewer —
  matches this repo's "self-hosted, no new vendor account" posture already established for MinIO.
- `apps/web/next.config.*` — confirm `transpilePackages` isn't needed here (OpenSeadragon is a
  plain npm dependency of `apps/web` itself, not a new `packages/ui` primitive — `frontend-design`
  Skill entry #4 is about workspace packages specifically, not applicable, but worth a real check
  during implementation rather than assuming).
- `apps/web/app/(app)/_components/sidebar.tsx` — new "Cases" nav item, mirrors the "Referring
  facilities" precedent from FEAT-066 (unconditionally listed, no nav-level role gate).
- `apps/web/messages/en.json` / `fr.json` — new sidebar label (`fr.json`'s string joins FEAT-048's
  own unreviewed-French-strings set, same standing caveat, not resolved here).

## 3. Architecture consulted

- **KB-17 Histology** — "Images/WSI | inline vs. object storage + references | Object storage +
  coordinate-annotated refs | Scales to large WSI... | Storage/streaming to design" (design
  decisions table); "Future considerations: Digital pathology / WSI viewer"; "Open questions: WSI
  storage/streaming approach — how whole-slide images are stored, tiled, and served at scale" — the
  literal, still-open question this proposal resolves.
- **KB-06 Database Architecture** — "Big binaries | Object storage, referenced by row" — same
  precedent FEAT-061 already applied, extended here to a multi-object (tile-pyramid) shape rather
  than a single object.
- **FEAT-061's own Implementation Proposal** (`docs/plans/feat-061-image-attachments-annotations.md`)
  — read in full. Its own §1 Goal explicitly deferred this scope by name; its own §6 Risks flagged
  issue #564 (staging has no MinIO headroom) as blocking, not resolved — directly relevant here,
  see §6 below. Its own upload route's buffered (not streamed) approach, and its own explicit
  "`putObjectStream` itself still supports true streaming... for a future caller that needs it"
  comment, is the direct precedent this proposal's streaming unzip fulfills.
- **`engineering/frontend-design` Skill** (full, 10 entries — required per the `plan` Skill's own
  instruction for any new `apps/web` page/component). Entry #4 (`transpilePackages` — checked
  during implementation, see §2). Entry #6 (function props into Client Components — the case
  detail page's slide-row upload form must itself be `'use client'`, matching `results-grid.tsx`'s
  own precedent, not a Server Component constructing client-bound closures). Entry #8 (`'use
  server'` files export only async functions — the upload action's own `types.ts` split). Entry #9
  (route-group dynamic-segment collisions — `/slides/[id]/viewer` deliberately kept flat, not
  nested under `/cases/[id]/slides/[slideId]`, avoiding this class of bug entirely rather than
  navigating around it).
- **`engineering/api-design` Skill** (full, 16 entries). Entry #7 (cross-tenant → 404, not 403).
  Entry #8 (explicit `ZodValidationPipe` schema, not reflection-based DTO inference). Entry #10
  (boot the real compiled server before trusting a new route works — applied here for the new `302`
  response shape, the first in this repo). Entry #11 (KB's literal colon-suffix action-route syntax
  breaks on this repo's real Fastify stack; found via FEAT-012's own `:id:cancel` failure) — this
  is exactly why this proposal deliberately avoids a wildcard/catch-all path-segment route (e.g.
  `GET tiles/*path`) for tile serving, choosing a `?path=` query parameter instead: a wildcard
  route's cross-harness behavior under this repo's actual NestJS+Fastify stack is unverified
  territory, and entry #11's own precedent is a direct warning against assuming any KB-adjacent or
  REST-conventional path syntax "just works" here without a real compiled-server check. A query
  parameter needs no new routing syntax at all, sidestepping the risk rather than taking it on.
- **`engineering/database-design` Skill** (full, 16 entries). Entry #1 (discriminator column: text
  + CHECK, not a Postgres ENUM — `status`'s 3 values, well under the "8+ on a central table"
  threshold). Entry #16 (RLS-exempt marker — not applicable, `whole_slide_image` is fully
  tenant-scoped with real RLS).
- **`apps/api/src/image-attachment/image-attachment.controller.ts`/`.module.ts`** — the direct
  sibling precedent for capability choice, "look the parent up first" validation shape, and the
  per-tenant-prefixed object-key convention.
- **`apps/api/src/storage/object-storage.client.ts`** — reused as-is (`putObjectStream`,
  `getPresignedDownloadUrl`); no changes needed to this module itself.
- **`apps/api/src/case/case.controller.ts`** — the exact `GET /v1/cases`/`GET /v1/cases/:id`
  response shapes this proposal's new `apps/web` pages consume, and the batch-query pattern
  `getById()` already uses (blocks/slides/fulfillments) that the new `wholeSlideImage`
  batch-fetch extends.

## 4. Skills loaded

`engineering/frontend-design` (full, 10 entries), `engineering/api-design` (full, 16 entries),
`engineering/database-design` (full, 16 entries).

## 5. Assumptions & autonomous decisions

- **Input is a pre-tiled Deep Zoom Image (DZI) pyramid (`.dzi` + `_files/` folder), zipped — never
  a raw scanner file (`.svs`/`.ndpi`/etc.)** (§10 Q1). Decoding and tiling a proprietary
  whole-slide scanner format requires OpenSlide (a C library with no pure-JS equivalent) or an
  external conversion service — real, substantial infrastructure this session cannot provision or
  size against a real scanner/vendor, exactly the "not guessed" caveat issue #549's own text states.
  A pathologist's own workstation (or a lab's scanner-vendor software) producing a `.dzi` export via
  `vips dzsave`/OpenSlide's own `deepzoom` script and uploading the zip is this v1's real, narrow,
  honestly-stated path — not a claim that raw scanner ingestion is solved.
- **Dedicated `whole_slide_image` table, not `image_attachment`'s polymorphic shape** (§2, ADR-0055).
  `image_attachment`'s `category` CHECK (`'gross'|'microscopic'`) and single-`objectKey` column
  don't fit a multi-thousand-object tile pyramid; forcing the fit would mean either loosening that
  CHECK for an unrelated artifact class or storing a `.dzi` key while leaving the actual tiles
  untracked by any row at all. A WSI is also structurally slide-specific (unlike gross/microscopic
  photos, which attach to Case/Specimen/Block/Slide alike) — a direct `slideId` FK is the honest
  model.
- **Synchronous, in-request unzip-to-object-storage, not a background job/queue** (§10 Q2). This
  codebase has no async job/queue infrastructure anywhere (`SlaBreachDetectorService`/
  `CriticalNotificationEscalationService` are `@nestjs/schedule` cron-style pollers, not a true job
  queue) — building one would be new, substantial infrastructure, clearly out of this proposal's own
  "prove the mechanism" scope. A real large pyramid (thousands of tiles) synchronously handled
  within one HTTP request is a genuine, named risk (§6), not silently accepted as fine at any scale.
- **Tile serving via an authenticated-redirect chain (apps/api 302 → apps/web proxy → presigned
  MinIO URL), not a wildcard path route, not a public bucket/prefix, not bytes proxied through
  either server** (§2/§3, ADR-0055). The three real alternatives — bytes actually streamed through
  the API, a public-read bucket/prefix, or a CloudFront-style signed-cookie scheme MinIO doesn't
  natively support the way AWS does — were rejected: streaming loses FEAT-061's own established
  "reads never proxy bytes" principle for the one workload that most needs it (hundreds of
  sequential small fetches); a public prefix would make PHI-adjacent slide imagery genuinely
  world-readable, a real Constitution-adjacent concern this proposal will not accept unreviewed.
- **`?path=` query parameter for tile identity, not a wildcard/catch-all route segment** — sidesteps
  `api-design` entry #11's own precedent (KB-literal route syntax silently failing on this repo's
  real Fastify stack) entirely rather than taking on new, unverified routing-syntax risk.
- **A custom OpenSeadragon `TileSource`/`getTileUrl` callback, not the library's built-in
  "point it at a `.dzi` URL" convenience** — required because tile identity here is a query
  parameter through a proxy chain, not a path OpenSeadragon's own default relative-URL resolution
  assumes.
- **No `.dzi`/zip-content validation beyond "exactly one `.dzi` file exists"** — no size cap, no
  scan for path-traversal in zip entry names (a real, named gap — see §6), no malware scanning.
  Matches FEAT-061's own explicit "no malware/size-cap hardening in this v1 scope, flagged not
  fixed" precedent exactly, not a new omission invented here.
- **`manage_specimens` capability reused for the upload route, no new capability** — same reasoning
  `image-attachment.controller.ts`'s own upload route already gives: no dedicated
  pathologist/imaging role exists in Keycloak yet.

## 6. Risks

- **Staging deployment is blocked before this feature even starts, not newly blocked by it.**
  Issue #564 already established the staging droplet has no memory headroom left for MinIO at all
  (FEAT-061's own ordinary few-MB images). WSI tile pyramids are categorically larger — this
  feature will ship fully built and verified against local dev only, same as FEAT-061, with staging
  demo blocked on #564's own resolution and now a materially harder version of the same constraint
  (WSI storage volume dwarfs FEAT-061's own numbers). Not fixed here; flagged, same as FEAT-061's
  own precedent for this exact issue.
- **No zip path-traversal protection.** A malicious or malformed zip entry path (e.g. `../../etc/
  passwd`-shaped) fed into `tileObjectPrefix + entry.path` could theoretically escape the intended
  object-storage prefix. Real gap, matching FEAT-061's own "no hardening in v1 scope" precedent —
  flagged for a pre-external-exposure hardening pass, not fixed in this proposal (internal
  staff-only upload, same trust boundary FEAT-061's own image upload already accepts).
- **Synchronous unzip-in-request has no real ceiling.** A very large pyramid could exceed a
  reasonable HTTP request timeout or memory profile for the streaming unzip itself. Mitigated for
  v1 by testing against a small synthetic fixture only — a real production-scale ingestion pipeline
  (background job, chunked/resumable) is deferred, named explicitly, not silently assumed fine at
  arbitrary scale.
- **First `302`-issuing route, first genuinely client-browser-facing proxy, first custom
  (non-default) OpenSeadragon tile source in this codebase** — three separate pieces of genuinely
  new mechanism, none with an existing precedent to mirror exactly. Mitigated by the real
  compiled-server boot check (§2) for the redirect chain and a real `web-verify` browser pass
  (§8) for the viewer itself, not assumed correct from typecheck/lint alone.
- **`unzipper`/`openseadragon` are both new dependencies this repo has never used.** Verified
  against a real install + real usage in this proposal's own testing plan, not assumed to register
  cleanly from documentation alone (same discipline FEAT-061's own Risks section applied to
  `@fastify/multipart`).

## 7. Acceptance criteria

Per issue #549's own scope (a real WSI viewer for whole-slide review in-app, backed by a real,
designed — not guessed — storage/streaming approach):
- [ ] A pathologist can upload a zipped, pre-tiled DZI pyramid against a real Slide and see it reach
  `status: 'ready'` — proven by a real MinIO round-trip (upload via the API, confirm every tile
  object plus the `.dzi` descriptor exist in the bucket directly, not just trusting the row's own
  `status` field).
- [ ] A malformed zip (no `.dzi` file, or more than one) reaches `status: 'failed'` with a real
  `errorMessage`, not a 500 or a silently-stuck `'processing'` row.
- [ ] From `/cases/:id`, a slide with a `ready` WSI shows a working "View whole-slide image" link;
  a slide without one shows the upload form instead — proven by a real `web-verify` browser pass,
  not just an API-level assertion.
- [ ] The viewer page actually renders the uploaded test pyramid via OpenSeadragon, zoomable and
  pannable — proven by a real browser pass, the class of check no automated test alone can
  meaningfully substitute for.
- [ ] Every tile request during a viewing session resolves to the correct bytes, is
  tenant-isolated (a cross-tenant WSI `id` on the tile route 404s), and never exposes a durable
  (non-expiring) object-storage URL to the browser.

## 8. Testing plan

1. `pnpm --filter @lis/db generate` + review the migration diff (one new table, real RLS, no
   `-- RLS-exempt` marker needed).
2. Fresh `db-reset.sh`, then `rls-isolation-check.ts` including the new `whole_slide_image` fixture.
3. Build a tiny synthetic DZI fixture (checked into `apps/api/test/fixtures/` as a zip): a 2-3-level
   pyramid, a handful of small tiles, one `.dzi` XML — small enough for the synchronous unzip path
   to run fast and reliably in CI, real enough to prove the actual mechanism end to end.
4. `apps/api/test/whole-slide-image.e2e-spec.ts` — real multipart zip upload through the compiled
   API, real unzip-to-MinIO round trip (confirmed via direct `HeadObject` calls, not just trusting
   the client wrapper), the malformed-zip failure path, the tile-redirect route resolving real bytes
   when followed directly, cross-tenant `slideId`/WSI-`id` rejection.
5. Boot the real compiled server (`api-design` entry #10) — confirm the `302` response and the
   multipart upload both work under the real Fastify adapter, not just the e2e harness's Express
   backing.
6. A real `web-verify` browser pass (this project's own headless-browser Skill, working around this
   sandbox's missing `libnss3.so` per its own header) — the case list, case detail page (upload
   form + view link), and the viewer page itself actually rendering and being zoomable/pannable
   against the synthetic fixture. This is the first feature this session drafts a plan for that
   both needs and has real browser verification available — no repeat of the earlier
   typecheck-only-verified caveat FEAT-065/066 both carried.
7. Full local verification: fresh db-reset → single new file in isolation → one final fresh-reset +
   full-suite run, this project's own established discipline.
8. Regenerate `openapi.json`/SDK **as the literal last code step before committing** — per the
   `develop` Skill's own newly-added checklist line (this session's own `/close` retrospective
   finding, approved same day) — not once mid-implementation only.

## 9. Rollback plan

Additive: one new table, one new API module/controller, one new dependency each in `apps/api`/
`apps/web`, a handful of new `apps/web` pages/routes (§2), one extended (not breaking) response schema
(`caseLineageBlockSchema`'s `slides` field gains a nullable `wholeSlideImage` sub-object — every
existing consumer that ignores the new field is unaffected). No existing table, route, or file is
modified except `app.module.ts`'s import list, `case.controller.ts`'s `getById()` (additive batch
fetch), `sidebar.tsx`'s nav list, and the i18n message files. Reverting the PR removes all of the
above; any already-uploaded WSI objects in the MinIO bucket become orphaned but harmless (no other
feature reads from the `wsi/` prefix).

## 10. Questions requiring human approval

1. **Pre-tiled DZI-only input (no raw scanner-format ingestion)?** Default: **yes** (Recommended) —
   see §5. Rejecting this means scoping down to "prove the storage/serving mechanism only, against
   a manually-pre-tiled fixture" with upload itself possibly cut entirely for v1 — a real, smaller
   alternative if even the DZI-input assumption feels premature.
2. **Synchronous in-request unzip, not a background job?** Default: **yes** (Recommended) — see §5/
   §6. The alternative (building real async job infrastructure first) is a materially larger,
   separate effort this proposal does not think is justified before any real WSI usage exists to
   size it against.
3. **Backfill ADR-0054 (FEAT-061's own object-storage decision, never committed) alongside this
   proposal's own new ADR-0055?** Default: **yes** (Recommended) — same reasoning as this session's
   own ADR-0053 backfill during `/close`: real, already-approved, already-shipped content that
   should have a real committed record, not new scope.
4. **How does the viewer page resolve "the ready WSI for this slide"?** Default: **nest the viewer
   under the case** (`/cases/:caseId/slides/:slideId/viewer`) and re-fetch `GET /v1/cases/:caseId`'s
   already-extended lineage rather than adding a new `GET /v1/whole-slide-images?slideId=` filter
   route for a single-row lookup (Recommended, reflected in §2) — smaller API surface, one small
   extra fetch instead of a new endpoint.
