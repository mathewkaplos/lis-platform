# Implementation Proposal: WSI zip path-traversal / size-cap hardening (issue #660)
Status: APPROVED
ADR: adr-0055 (WSI tiles/DZI)    Date: 2026-08-20    Backlog ID: issue #660

## 1. Goal

`unzipDziToObjectStorage` (`apps/api/src/whole-slide-image/dzi-unzip.service.ts`)
streams every zip entry straight into object storage under
`objectPrefix + entry.path`, with no path-traversal (zip-slip) protection and
no size cap — a gap the file's own header comment already names explicitly
("No zip path-traversal protection or size cap exists here ... real named v1
gap"), confirmed still true and unaddressed during the 2026-08-20 AP
architecture review
(https://claude.ai/code/artifact/684ca0a6-a210-4d86-8063-ec6adad91dcc, §5,
§19, §23).

Two real risks: (1) a crafted entry path (`../../etc/whatever`, an absolute
path) could write outside the intended `tileObjectPrefix`; (2) an oversized
or maliciously-crafted archive (a decompression/zip bomb) could exhaust
object storage or memory, since nothing bounds how many bytes a single entry
or the whole archive expands to as it streams through.

## 2. Affected files

- **Modify:** `apps/api/src/whole-slide-image/dzi-unzip.service.ts` — add
  path-traversal rejection and streamed byte-count enforcement (per-entry and
  cumulative).
- **New:** a small counting-stream helper, likely in the same file (kept
  private) or a new co-located file if it grows — exact placement decided
  during implementation; kept small either way.
- **New (test):** `apps/api/src/whole-slide-image/dzi-unzip.service.spec.ts`
  — unit tests for the byte-limit mechanism in isolation (small, injectable
  limits — see §8 for why this is a unit test, not an e2e fixture).
- **New (test fixture):** `apps/api/test/fixtures/path-traversal.zip` — a
  small, hand-crafted zip with one entry whose path attempts to escape the
  upload prefix (`../escaped.txt`), built via a one-off local script (no new
  runtime dependency — no zip-writer package exists in this repo today, and
  building one raw STORED-entry zip by hand is small and self-contained;
  confirmed no `archiver`/`yazl`/`jszip` already available, transitively or
  otherwise).
- **Modify:** `apps/api/test/whole-slide-image.e2e-spec.ts` — one new e2e
  case proving the real HTTP upload path rejects the traversal fixture
  end-to-end.

## 3. Architecture consulted

- `dzi-unzip.service.ts`'s own header comment and full implementation (read
  in full — see §5 for the two mechanics it depends on: `unzipper.Parse`'s
  sequential, backpressured entry consumption, and the existing backslash-
  normalization step this fix builds directly on top of).
- `whole-slide-image.controller.ts`'s `upload()` handler — confirmed any
  `Error` thrown out of `unzipDziToObjectStorage` is already caught and
  turned into a clean `status: 'failed'` / `errorMessage` row (no controller
  change needed; the existing failure path is reused as-is).
- ADR-0054 (object storage: direct multipart upload, streaming preferred
  over buffering) — the fix must preserve the existing never-buffer-the-
  whole-zip property; a fix that buffers to check size first would undo the
  file's own already-proven streaming design.
- `whole-slide-image.e2e-spec.ts` — read in full for fixture conventions
  (`apps/api/test/fixtures/*.zip`, real files, no mocking) and the existing
  `objectExists()` proof-not-just-status-row pattern this proposal's own new
  test reuses.

## 4. Skills loaded

- `anatomic-pathology-synoptic-engine` (new Skill, 2026-08-20) — not directly
  applicable to WSI, but consulted for the general "verify against current
  code, not stale planning docs" discipline (entry #7) before treating this
  gap as still real — confirmed still present by direct re-read of the
  current file, not assumed from the architecture review alone.
- `engineering/api-design` — required per the `plan` Skill's own rule only
  if a route signature changes; it doesn't here (no new route, no changed
  request/response shape) — checked and confirmed not applicable beyond
  entry #6's already-satisfied "only mutations are audited" (unchanged,
  upload route already correctly un-audited per its own header comment).
- No `frontend-design` — this is a pure backend change, no `apps/web` files
  touched.
- `engineering/testing` (implicitly, via `database-design`/general test
  conventions in this repo) — consulted for this repo's real/no-mocking test
  discipline, which is why the size-cap mechanism is factored into a
  directly-unit-testable piece rather than asserted only through an
  impractical-to-construct giant e2e fixture (see §8).

## 5. Assumptions & autonomous decisions

- **Path-traversal check runs after the existing backslash-normalization
  step**, on the normalized (forward-slash) path — rejects if any path
  segment equals `..` or the path is absolute (starts with `/`). Checked by
  splitting on `/` and testing segments exactly, not a substring match (a
  real filename like `..config.jpg` must not be rejected as if it contained
  a traversal segment).
- **Size enforcement is based on real streamed bytes, never a zip entry's
  own declared header size.** A declared `uncompressedSize` field is
  attacker-controlled and cannot be trusted (the classic zip-bomb vector:
  a small compressed entry that expands to an enormous real byte count) — so
  the fix counts actual bytes as they stream out of `unzipper`'s
  decompression, not a number read from the archive's own metadata.
- **Two limits, both enforced live while streaming:** a per-entry cap (each
  individual file/tile/descriptor) and a cumulative total cap (the whole
  archive across all entries) — a per-entry-only cap would still allow an
  unbounded total via many entries each just under the cap.
- **Proposed default values** (§10 Q1 — flagged for explicit confirmation,
  not silently picked): per-entry cap **100 MB**, total cap **5 GB**. Reasoning:
  a real DZI tile is typically well under 1 MB (JPEG tiles at standard
  Deep Zoom tile sizes) and the `.dzi` XML descriptor itself is tiny — 100 MB
  per entry is already 100×+ more generous than any legitimate file in this
  format should ever be. A full high-resolution whole-slide pyramid can
  genuinely reach into the low gigabytes across thousands of tiles — 5 GB
  total is generous enough not to false-positive on a real scan while still
  bounding an otherwise-unbounded upload.
- **On limit violation, the entry stream is destroyed with a real `Error`**,
  propagating up through `putObjectStream`'s `await upload.done()` the same
  way any other thrown error already does — reusing the controller's
  existing `catch` → `status: 'failed'` / `errorMessage` path verbatim, no
  new failure-handling code needed there.
- **No zip-writer dependency added.** The one new test fixture
  (`path-traversal.zip`) is built by a small one-off local script producing
  a minimal, valid STORED-format zip by hand (well-documented, simple format
  for the no-compression case) — not committed as a repo script, only its
  output binary is committed, matching how the existing
  `backslash-paths.zip`/`two-dzi.zip` fixtures were presumably produced.

## 6. Risks

- **A traversal or oversized entry that appears after other, legitimate
  entries in the same archive leaves those earlier entries' bytes already
  written to object storage** before the throw aborts the rest — the WSI row
  correctly ends up `status: 'failed'`, but the partial objects aren't
  cleaned up. This is the same pre-existing "no failed-upload retry/cleanup
  mechanism" gap the architecture review already named separately (§5) —
  explicitly out of scope for this fix, not silently expanded into it.
- **Chosen limit values are a real judgment call**, not derived from a hard
  spec — flagged explicitly in §10 rather than asserted as obviously correct.
- Low overall risk: additive, backend-only, no schema/route/frontend change,
  and the existing failure-handling path is reused rather than modified.

## 7. Acceptance criteria

- A zip entry whose path resolves outside the upload prefix (`../`-style
  traversal, or an absolute path) is rejected; the resulting WSI row is
  `status: 'failed'` with a clear `errorMessage`; no object is written to
  that escaped path (checked directly via `objectExists()`, not just the
  response body).
- An entry (or the archive's cumulative total) exceeding the configured
  byte cap is rejected the same way, proven at the unit-test level against
  the underlying counting mechanism with small, fast, injectable limits.
- Every existing WSI e2e test (valid upload, backslash-paths regression,
  no-`.dzi`, two-`.dzi`, tile-redirect, cross-tenant isolation, case-lineage
  summary) continues to pass unchanged — the real fixtures already in use
  stay well under both new caps by construction.

## 8. Testing plan

- **New unit test** (`dzi-unzip.service.spec.ts`) for the byte-counting
  limit mechanism in isolation: small in-memory streams, small injected
  limits (e.g. a 500-byte cap fed 1000 bytes) — proves the exact enforcement
  logic without needing to construct or stream gigabyte-scale fixtures,
  which would be impractical to commit as a test fixture and slow to run.
- **New e2e test** (`whole-slide-image.e2e-spec.ts`) using the new
  `path-traversal.zip` fixture — proves the real HTTP upload route rejects a
  real traversal attempt end-to-end, `status: 'failed'`, no escaped object
  written.
- Full existing `apps/api` e2e suite re-run clean against a freshly reset
  local DB (this repo's standing bar for any AP/WSI change) — confirms no
  regression to the six existing WSI e2e cases or anything else.

## 9. Rollback plan

Purely additive hardening on one self-contained function, no schema/route
change, no change to the controller's error handling (already correct and
reused as-is) — a plain revert of this PR's diff fully restores prior
behavior with no data migration in either direction.

## 10. Questions requiring human approval

1. **Per-entry cap 100 MB, total cap 5 GB** — reasoned defaults above;
   confirm or adjust before implementation. (If real production WSI files
   are expected to be materially larger than a few GB, the total cap should
   move accordingly — no such data point exists in this repo yet.)
2. **Enforcement mechanism: real streamed byte-counting only, never a zip's
   own declared size metadata** — recommended default (the metadata is
   attacker-controlled); confirm this is acceptable rather than also adding
   a cheap declared-size pre-check (which would need to trust a value this
   proposal explicitly argues shouldn't be trusted).
3. **No cleanup of partially-written objects on a rejected upload** — stays
   a known, separately-tracked gap (not expanded into this task); confirm
   this scope boundary is acceptable.

If all three defaults are acceptable, approving this proposal as-is is
sufficient to proceed.
