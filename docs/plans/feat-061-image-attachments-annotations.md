# Implementation Proposal: FEAT-061 — Image attachments with coordinate annotations
Status: APPROVED
ADR: ADR-0052 (object storage provider + upload mechanism — new, this proposal's own load-bearing decision)
Date: 2026-08-12    Backlog ID: #540 (FEAT-061, depends on FEAT-057 #538, FEAT-058 #539)

**Approved 2026-08-12** via the native options-prompt — all four §10 questions answered with the
Recommended option as drafted: (1) self-hosted MinIO, (2) direct multipart upload through the API,
(3) the discrete per-response Observation as the "finding" link, (4) no malware/size-cap hardening
in this v1 scope.

## 1. Goal

Gross photographs and microscopic images live in object storage, referenced by row — never
inline in Postgres (KB-06: "Big binaries | Object storage, referenced by row | DB stays lean").
Annotations (a marked region, e.g. a tumor boundary) carry coordinate metadata and optionally tie
back to a specific synoptic finding (KB-17, KB-25). Explicitly **not** a whole-slide-image (WSI)
viewer or streaming pipeline (issue #549, deferred).

This is the **first feature in this codebase to touch object storage at all** — confirmed
directly, not assumed: no `@aws-sdk/*`/MinIO dependency, no object-storage client module, and no
binary-upload route exists anywhere in `apps/api` today. This proposal's own object-storage
provider and upload-mechanism choices are genuinely load-bearing (§10), hence the new ADR.

## 2. Affected files

**Object storage infra (new):**
- `docker-compose.yml` — new `minio` service (self-hosted, S3-compatible — §5/§10 Q1), matching
  the existing local-dev pattern for `postgres`/`valkey`/`keycloak` (a plain container, no cloud
  account/credentials this environment can't provision).
- `infra/docker-compose.staging.yml` — same `minio` service for the single Tailscale-networked
  staging host, plus a persisted volume (unlike Keycloak's own ephemeral store — image bytes must
  survive a redeploy).
- `apps/api/src/storage/object-storage.client.ts` (new) — thin wrapper around
  `@aws-sdk/client-s3` (MinIO is S3-API-compatible; using the real AWS SDK rather than a
  MinIO-specific client means a future move to real cloud S3/GCS-via-S3-interop is a config
  change, not a rewrite): `putObject(key, body, contentType)`, `getObjectStream(key)`,
  `deleteObject(key)` (not used by this feature's own AC scope, included for completeness/tests).
  New env vars: `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`,
  `OBJECT_STORAGE_SECRET_KEY`, `OBJECT_STORAGE_BUCKET` — same `requiredEnv`-style enforcement
  convention as `apps/web/auth/secret.ts`/`packages/db/src/case-report-signature.ts`.
- `apps/api/package.json` — new dependencies: `@aws-sdk/client-s3`, `@fastify/multipart` (direct
  upload through the API — §5/§10 Q2, not presigned browser-direct URLs).
- `apps/api/src/main.ts` — registers `@fastify/multipart` on the Fastify instance (`app.register(...)`,
  same pattern `@fastify/static`, already registered for Swagger, already establishes).

**Schema (new tables, both tenant-scoped, RLS):**
- `packages/db/src/schema/image-attachment.ts` (new) — `imageAttachment`: `id`, `tenantId`,
  `resourceType` (text, CHECK-constrained `'case'|'specimen'|'block'|'slide'` — the four resource
  types the issue names), `resourceId` (uuid, **no FK** — same "polymorphic parent, no
  discriminated-union FK mechanism" precedent `audit_event.resource_id` already established),
  `category` (text, CHECK-constrained `'gross'|'microscopic'`, KB-17's own two image categories),
  `objectKey` (text, the object-storage key — never the bytes), `contentType`, `sizeBytes`,
  `uploadedByUserId` (uuid, no FK, same "no user table yet" convention as `report.generatedByUserId`),
  `createdAt`.
  `imageAnnotation`: `id`, `tenantId`, `imageAttachmentId` (FK), `coordinates` (jsonb — a bounding
  box `{x,y,width,height}`, normalized 0–1 fractions of image dimensions so it survives any future
  re-encode/resize — KB-06's own "genuinely free-form... none of which need cross-patient
  trending" JSONB carve-out), `observationId` (uuid, nullable FK to `observation` — "linked to a
  specific synoptic finding" per AC #2, resolved as the discrete per-response Observation FEAT-058's
  `assembleAndPersistSynopticResponse` already writes, §5/§10 Q3), `label` (text, nullable — a
  short free-text caption like "invasive front", narrative-adjacent same as a report's own
  comment field, not itself a structured clinical value, Constitution Law #1 unaffected),
  `annotatedByUserId`, `createdAt`.
- `db/migrations/00XX_image_attachment.sql` (generated).
- `packages/db/src/rls-isolation-check.ts` — fixtures for both new tables (the recurring
  #430/#534/#536 miss pattern — do not repeat it a fifth time).

**Domain + API:**
- `packages/domain/src/image-attachment.ts` (new) — `imageResourceTypeSchema`,
  `imageCategorySchema`, `imageAttachmentSchema`, `imageAnnotationCreateSchema`,
  `imageAnnotationSchema`.
- `apps/api/src/image-attachment/image-attachment.controller.ts` (new) — `POST
  v1/images/:resourceType/:resourceId` (multipart upload; validates `resourceType` against the
  allow-list and that `resourceId` resolves to a real, tenant-visible row of that type before
  streaming to object storage — mirrors `case.controller.ts`'s own "look the parent up first,
  400 if not found" shape), `GET v1/images/:id` (returns a short-lived presigned GET URL, not the
  bytes through the API — keeps the read path off the API's own request budget even though the
  write path is a direct multipart upload, §5), `POST v1/images/:id/annotations`, `GET
  v1/images/:id/annotations`. `manage_specimens` capability (matching `case.controller.ts`'s own
  reasoning: no dedicated pathologist/imaging role exists in Keycloak yet).
- `apps/api/src/image-attachment/image-attachment.module.ts` (new).
- `apps/api/src/app.module.ts` — wires `ImageAttachmentModule`.
- `apps/api/src/image-attachment/image-attachment.spec.ts` / `.e2e-spec.ts` (new) — real MinIO
  round-trip (upload, confirm object exists via a real `getObjectStream`, presigned GET URL
  actually resolves the same bytes), annotation creation + coordinate validation, AC #1/#2
  coverage.
- `.env`/`.env.example`, `.github/workflows/pr.yml`, `infra/docker-compose.staging.yml` — new
  `OBJECT_STORAGE_*` env vars, same wiring discipline as `SIGNING_SECRET` (FEAT-059).

**Frontend:** Google Stitch prompt for the upload + annotation viewer (issue's own item) — written
once this proposal's API shape is approved, not before.

## 3. Architecture consulted

- **KB-17 Histology** — "Images are first-class... object storage... annotations... coordinate
  metadata so a marked region ties back to a finding"; design-decisions table's "Object storage +
  coordinate-annotated refs" row; "Future considerations: Digital pathology / WSI viewer" (out of
  this feature's scope, issue #549).
- **KB-06 Database Architecture** — "Big binaries | Object storage, referenced by row | DB stays
  lean" (the one explicit object-storage precedent in this repo's own architecture docs — never
  previously implemented).
- **`engineering/database-design` Skill** (17 entries, loaded in full) — entry #16 (`-- RLS-exempt
  per ADR-NNNN` marker requirement — not applicable here, both new tables are tenant-scoped with
  real RLS, not global), entry #5 (hand-written migration + snapshot reconciliation — not
  applicable, both tables are fully `drizzle-kit generate`-expressible, no triggers needed).
- **`engineering/api-design` Skill** (16 entries, loaded in full) — entry #8 (explicit
  `ZodValidationPipe` instantiation), entry #11 (`/verb` not `:verb` for action sub-resources —
  applies to `v1/images/:id/annotations` as a sub-resource collection, not an action-suffix, so
  unaffected), entry #7 (cross-tenant access returns 404, not 403).
- **`packages/db/src/schema/audit.ts`** — the exact polymorphic `resourceType`/`resourceId` (no
  FK) precedent reused for `imageAttachment`'s own parent reference.
- **`apps/api/src/main.ts`** — confirmed the real Fastify adapter/bootstrap shape multipart
  registration hooks into.
- **`apps/api/package.json`** — confirmed no `@aws-sdk/*`/multipart dependency exists yet; this is
  genuinely new infrastructure, not a gap in an existing wrapper.
- **`docker-compose.yml`/`infra/docker-compose.staging.yml`** — the existing plain-container
  service pattern (`postgres`/`valkey`/`keycloak`) mirrored for `minio`.

## 4. Skills loaded

`engineering/database-design` (full, 17 entries), `engineering/api-design` (full, 16 entries).

## 5. Assumptions & autonomous decisions

- **Self-hosted MinIO (S3-API-compatible), not a real cloud provider** (§10 Q1). This session has
  no AWS/GCS account access to provision a real bucket/IAM credentials autonomously, and this
  repo's own staging deploy already runs everything as plain containers on one Tailscale-networked
  host (`infra/docker-compose.staging.yml`) — MinIO fits that exact existing pattern with zero new
  external dependencies. Using the real `@aws-sdk/client-s3` (not a MinIO-specific SDK) against
  MinIO's S3-compatible API keeps a future move to real cloud storage a config change, not a
  rewrite.
- **Direct multipart upload through the API, not presigned browser-direct URLs** (§10 Q2). Gross/
  microscopic photographs (not WSI) are single-digit-MB images, well within what a direct
  server-side upload handles cleanly; presigned URLs are the more scalable pattern but add real
  complexity this v1 scope doesn't need yet (MinIO CORS configuration, browser-side upload
  wiring in the Stitch UI, a two-phase intent/complete flow to avoid orphaned rows) — KB-08's own
  "defer until a real endpoint's failure mode needs it" principle (`api-design` Skill entry #4),
  applied here to presigned uploads specifically. Reads still use a short-lived presigned GET URL
  (cheap to add, keeps large binary transfer off the API's own request budget on the read side).
- **`observationId` is the "specific synoptic finding" an annotation links to** (§10 Q3) — the
  discrete, analyte-bound Observation FEAT-058's `assembleAndPersistSynopticResponse` already
  writes per response (e.g. "tumor grade: high_grade"), not the `synoptic_element` definition
  itself (which describes the field, not a specific case's answer) or the `case_report_version`
  (too coarse — that's the whole signed report, not one finding). Nullable — an annotation may
  exist with no specific finding link (e.g. a plain gross-photo region-of-interest marker with no
  synoptic correlate yet).
- **Polymorphic `resourceType`/`resourceId`, no FK** (matches `audit_event`'s own precedent
  exactly, not four separate per-resource-type attachment tables) — one image can attach to any of
  Case/Specimen/Block/Slide, and a discriminated-union FK is not expressible in this schema
  builder (same reasoning `audit.ts`'s own header comment already gives).
- **Coordinates as normalized `{x,y,width,height}` fractions (0–1), not pixel values** — survives
  any future image re-encode/resize without the annotation drifting off its intended region;
  standard convention for this kind of metadata.

## 6. Risks

- **First object-storage infrastructure in this repo** — no existing precedent to mirror. Mitigated
  by keeping the client module narrowly scoped (put/get/delete only, no lifecycle policies,
  versioning, or multi-bucket routing) and proving it against a real local MinIO container, not a
  mock.
- **MinIO's staging persistence** is a new, real operational surface (a volume that must survive
  redeploys, unlike Keycloak's own deliberately-ephemeral store) — flagged, not glossed over;
  `infra/docker-compose.staging.yml`'s own volume declaration is the actual fix, verified by a real
  redeploy-and-confirm-object-still-present check (§8), not assumed from the compose file alone.
- **No image-count/size cap or virus/malware scanning** on upload — explicitly out of this
  proposal's own narrow scope (the issue's ACs don't ask for either); flagged as a real gap for a
  future hardening pass before this is exposed beyond internal staff use, not fixed here.
- **`@fastify/multipart` is a new dependency this repo has never used** — verified directly against
  a real compiled server boot (`api-design` Skill entry #10's own "boot the real compiled server,
  not just the e2e harness" discipline), not assumed to register cleanly from documentation alone.

## 7. Acceptance criteria

Per issue #540's own 2 ACs:
- [ ] A gross or microscopic image can be attached to a Case/Specimen/Block/Slide and stored in
  object storage, not inline in Postgres — proven by a real MinIO round-trip (upload via the API,
  confirm the object exists in the bucket directly, confirm no image bytes anywhere in the
  `image_attachment` row itself).
- [ ] An annotation with coordinate metadata can be attached to an image and linked to a specific
  synoptic finding — proven by creating an annotation referencing a real discrete Observation
  (from a real FEAT-058 synoptic response) and reading it back with its coordinates intact.

## 8. Testing plan

1. `pnpm --filter @lis/db generate` + review the migration diff (two new tables, both real RLS,
   no `-- RLS-exempt` markers needed).
2. Fresh `db-reset.sh`, then `rls-isolation-check.ts` including both new table fixtures.
3. Real MinIO round-trip: `docker compose up -d minio`, a unit/integration spec that puts an
   object, confirms it exists via a direct S3 `HeadObject`/`GetObject` call (not just trusting the
   client wrapper's own return value), and deletes it.
4. `apps/api/test/image-attachment.e2e-spec.ts` — real multipart upload through the compiled API,
   real presigned GET URL that actually resolves the uploaded bytes when fetched directly (not
   just asserting the URL's shape), real annotation creation linked to a real Observation from a
   real synoptic-response flow (reusing FEAT-058's own e2e fixture shape).
5. Boot the real compiled server (`api-design` Skill entry #10) with `@fastify/multipart`
   registered — confirm it actually starts, not just that the e2e harness (which always uses
   Express under `createNestApplication()`) accepts the route.
6. A real staging redeploy check: upload an image, redeploy (or restart the `minio` container),
   confirm the object and its row are both still present — proves the volume persistence
   assumption for real, not just from the compose file's own declaration.
7. Full local verification: fresh db-reset → single new file in isolation → one final
   fresh-reset + full-suite run, this session's own established discipline.

## 9. Rollback plan

Additive: two new tables, one new controller/module, one new infra service (`minio`), two new
dependencies. No existing table, route, or service is modified except `app.module.ts`'s import
list and `main.ts`'s multipart registration (both trivially revertible). Reverting the PR removes
all of the above; any already-uploaded objects in the MinIO bucket become orphaned but harmless
(no other feature reads from this bucket).

## 10. Questions requiring human approval

All four resolved 2026-08-12, Recommended option selected in every case:
1. **RESOLVED — self-hosted MinIO** via docker-compose, not a real cloud provider.
2. **RESOLVED — direct multipart upload through the API**, not presigned browser-direct URLs.
3. **RESOLVED — the discrete per-response `observation` row** as the "finding" link, not
   `synoptic_element` or a new concept.
4. **RESOLVED — no malware/size-limit scanning** in this v1 scope.

**No further questions — implementation begins now.**
