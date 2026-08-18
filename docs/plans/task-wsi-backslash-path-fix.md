# Implementation Proposal: Normalize zip entry path separators in WSI unzip
Status: APPROVED
ADR: none (bug fix within already-decided ADR-0055 semantics)    Date: 2026-08-19    Backlog ID: AP browser acceptance report, BUG-01

**Approved 2026-08-19** via the native options-prompt. §10 Q1 answered: separator-normalization
only, not bundled with path-traversal hardening or verify-before-ready.

## 1. Goal

Fix a real, reproduced defect found during the AP browser acceptance pass (see the published report):
`unzipDziToObjectStorage` (`apps/api/src/whole-slide-image/dzi-unzip.service.ts`) writes each zip
entry to object storage under a key built directly from `entry.path`, with no path-separator
normalization. A zip whose internal entries use `\` instead of `/` (confirmed producible by
Windows' `Compress-Archive` cmdlet, though not by the documented `vips dzsave`/OpenSlide pipeline
or the repo's own `test-dzi.zip` fixture) uploads without error, the `whole_slide_image` row
reaches `status: 'ready'`, and every tile then 404s at view time with zero error surfaced anywhere
in the UI -- confirmed live: upload succeeds, "View whole-slide image" appears, the viewer renders
solid black, console shows repeated `Tile … failed to load … [downloadTileStart]`, and `mc ls`
against the MinIO bucket shows the stored keys literally contain backslashes
(`fixture_files\8\0_0.jpeg` instead of `fixture_files/8/0_0.jpeg`).

## 2. Affected files

- `apps/api/src/whole-slide-image/dzi-unzip.service.ts` -- normalize `entry.path` (backslash →
  forward slash) before it's used to build the object key or checked for the `.dzi` extension.
- `apps/api/test/whole-slide-image.e2e-spec.ts` -- new e2e case: a zip fixture whose entries use
  backslash separators uploads to `status: 'ready'` with correctly forward-slash object keys, and
  every uploaded tile is actually retrievable at those keys.
- `apps/api/test/fixtures/` -- new fixture (e.g. `backslash-paths.zip`), built the same
  reproducible way as the existing three DZI fixtures.

## 3. Architecture consulted

- `dzi-unzip.service.ts`'s own header comment (already documents the "no path-traversal
  protection or size cap" gap as a deliberate, named v1 exclusion -- this proposal does not touch
  that; it fixes only the separator-normalization gap the acceptance report found, not general
  zip-entry hardening).
- ADR-0055 (WSI tiles are DZI pre-tiled input served via authenticated redirect chain) -- unchanged
  by this fix; the redirect/presigned-URL mechanism is not the defect, only the object key written
  at upload time.
- `unzipper`'s `Entry.path`: confirmed (not assumed) that this library returns the path exactly as
  stored in the zip's central directory, with no separator normalization of its own -- the ZIP
  spec itself mandates `/` internally, but a tool that writes `\` anyway (several Windows-native
  zip tools are known to, including `Compress-Archive`) is not rejected or corrected by `unzipper`.

## 4. Skills loaded

- `engineering/api-design` (existing route, no new route added)
- `engineering/database-design` (no schema change)

## 5. Assumptions & autonomous decisions

- **Normalize by replacing `\` with `/` in `entry.path` before any use**, rather than rejecting
  zips containing backslash-separated entries outright. A real DZI pyramid re-zipped by a
  Windows-native tool is still a completely valid, usable pyramid once normalized -- rejecting it
  would be a strictly worse outcome for a lab tech than silently fixing the one thing that's
  actually wrong with it, and normalization is what every well-behaved zip reader (Windows
  Explorer, 7-Zip, `unzip`) already does transparently. This mirrors the "fix what's fixable,
  don't just fail louder" spirit already established in this handler's sibling code
  (`add-reflex-test.command.ts`'s no-op-and-log pattern for expected-shape problems).
- **Out of scope, deliberately:** the pre-existing "no path-traversal protection or size cap" gap
  the file's own header comment already names. A `\`-normalization fix touches the same few lines
  but is a different, narrower concern than general zip-entry hardening (e.g. rejecting `../`
  segments) -- bundling them would blur what this fix actually claims to have tested. If you want
  path-traversal hardening done in the same pass, say so and I'll widen scope before implementing.
- **No change to the "ready" status logic** (i.e. not implementing the report's separate P3
  recommendation to verify tile retrievability before marking ready). That's a genuinely different
  fix -- defense in depth against a different class of failure -- not a natural part of fixing the
  specific normalization bug. Flagging it here in case you want it folded in; recommend a separate
  pass if so, since it changes the success/failure contract of the whole function, not just one
  string transform.

## 6. Risks

- **Very low.** The change is a pure string transform on a value used only to build an object-store
  key and to check a file extension -- no behavior change for any zip that already uses forward
  slashes (the overwhelming majority, including every existing fixture and the real production
  pipeline), confirmed by re-running the existing WSI e2e suite unchanged after the fix.

## 7. Acceptance criteria

- [ ] A zip whose entries use backslash separators, containing a valid single-`.dzi`-descriptor
      pyramid, uploads to `status: 'ready'`.
- [ ] Every object actually written to storage for that upload uses forward-slash keys (verified
      by fetching the stored `.dzi` object and at least one tile object directly, not just
      asserting on the returned `dziObjectKey` string).
- [ ] The three existing WSI e2e cases (valid upload, no-`.dzi`, two-`.dzi`) still pass unchanged.

## 8. Testing plan

- New case in `apps/api/test/whole-slide-image.e2e-spec.ts`, built the same way the existing three
  fixtures were (a real DZI pyramid, this time zipped with backslash-separated entry names),
  asserting both the `ready` status and that `objectExists()` (the same helper the existing suite
  already uses) returns true for the forward-slash key of both the `.dzi` and a tile.
- Full `apps/api` e2e suite re-run against a freshly reset local DB to confirm no regression.
- Live browser re-verification: re-upload the original backslash-path fixture from the acceptance
  pass (still on disk) against the running dev stack and confirm the viewer now renders the tile
  instead of black.

## 9. Rollback plan

Single-function, single-line-of-logic change (one `.replace()` call at the top of the loop body).
Reverting is a clean one-line revert with no data-shape or migration implications.

## 10. Questions requiring human approval

1. **Scope: separator-normalization only, not the path-traversal hardening or the
   "verify-before-ready" P3 recommendation — approve as scoped, or widen?** Recommend: fix only
   BUG-01 as scoped. Both other items are real but separate concerns already named as such in the
   acceptance report; bundling them risks under-testing each on its own.
