# Status — 2026-08-19 (session 40, continued)

Last commit on main: `8611cad` (`lis-platform`) — `lis-engineering`'s tip is `9dc9908` (unchanged
this leg). Since the AP testing passes below (pure QA, no code touched), eleven issues broken out
of #610 were each filed, planned, implemented, and merged this session: issue #613 as PR #617
(Cases list status-filter tabs, breadcrumb PR #618); issue #615 as PR #619 (case amendment browser
UI, breadcrumb PR #620); issue #621 as PR #622 (case sign-out/finalize browser UI, breadcrumb PR
#623); issue #624 as PR #625 (cytology two-tier screening browser UI, breadcrumb PR #626); issue
#627 as PR #628 (block/slide creation browser UI, breadcrumb PR #629); issue #630 as PR #631
(block-level reflex/add-on test ordering browser UI, breadcrumb PR #632); issue #633 as PR #634
(case/specimen accessioning browser UI, breadcrumb PR #635); issue #636 as PR #637
(gross/microscopic/diagnosis narrative entry — the first of these eleven requiring new schema, not
just a thin UI layer); issue #639 as PR #640 (cytology reviewer return-to-screening action); issue
#642 as PR #643 (synoptic protocol recording UI); and **issue #645 as PR #646** (Prostate/Lung
synoptic protocol pilot + `coded_multi` elements — see updated bullet below). A histology
case can go accessioned →
signed_out → amended entirely through the browser; a cytology case can go accessioned →
pending_review → signed_out → amended entirely through the browser, and a verifier can now send a
cytology case back to `in_process` from `pending_review` with a required reason instead of only
ever moving forward; a case's own block/slide
hierarchy can be built out in the browser; a reflex/add-on test can be ordered onto a block from
the browser, immediately result-enterable via the existing generic results screen; a case can be
created from scratch in the browser (`/cases/new?orderId=`); a pathologist can enter and
persist gross/microscopic/diagnosis narrative on a case, correctly captured into the signed report
at finalize/amend time; and a pathologist can now record a full synoptic protocol (Breast,
Colorectal, Cervical Cytology/Pap, Prostate, or Lung — five real, cited protocols now seeded) against
an eligible part, through a single generic protocol renderer with live conditional-field visibility
and multi-select ("select all that apply") support. Check `git log origin/main -5` for the
real current tip if this has drifted.

## Session 40 (continued) — AP full acceptance pass #4: Amendments, Reflex/IHC, Reporting

Human asked for a comprehensive AP acceptance pass explicitly re-verifying all three prior passes'
findings against the (unchanged) current checkout, plus covering what those passes had explicitly
flagged as untested: Amendments, Reflex/IHC ordering, and Reporting. Report:
`https://claude.ai/code/artifact/64c45b7b-460a-4a64-9fe4-577f9afcbcab`.

**Amendments (`POST /cases/:id/amend`), tested for the first time — backend confirmed correct and
robust:** RBAC (technologist 403), wrong-state rejection (a case never signed out correctly 400s),
validation (empty `reason` 400s), and — the real substance of the test — a genuine **3-version
chained amendment** on the cytology case from the earlier pass: v1 signed out → amended (v2,
`amendmentOf` v1) → amended again (v3, `amendmentOf` v2). The `trg_case_report_version_supersede`
DB trigger correctly, atomically flipped v1 then v2 to `status: 'superseded'` with `superseded_by`
pointing forward each time — a real database guarantee, not application logic, verified by direct
query, not assumed. Full correct audit trail (`case.sign_out`, `case.amend` ×2) confirmed. Zero
browser UI exists for any of it — confirmed again by grep, matching every other AP mutation.

**Reflex/IHC ordering (`POST /blocks/:id/ordered-tests`), tested for the first time:** RBAC
correct (qa role 403); a technologist-ordered add-on test correctly links to the *same* existing
case/order (no accidental duplicate case — confirmed by a `count(*) = 1` check on the order's own
case), with both `block_fulfillment` and `specimen_fulfillment` rows present (matching issue #561's
prior fix). **Real, non-obvious positive finding:** the newly-ordered test turned out to be
genuinely enterable through the *pre-existing generic* chemistry/hematology result-entry screen
(`/orders/[id]/results`) — confirmed live in the browser: the original "ordered"-status test row
renders correctly disabled, the new "received"-status AP test row is live, accepts real input, and
autosaves a draft. This partially closes the "result entry" gap specifically for reflex/add-on
tests, since that mechanism deliberately reuses the same `ordered_test` shape every other
discipline already uses.

**Reporting — a stronger finding than "no UI":** no `GET` route of any kind exists anywhere for
`case_report_version` (confirmed by grepping every file that touches the table) — the *only* way
its content is ever visible to any caller, human or API, is the synchronous JSON response of the
`finalize`/`amend` POST itself, at the instant it's created. Distinct from, and not to be confused
with, the real and working per-ordered-test PDF report (`POST /v1/ordered-tests/:id/report`,
TASK-060/FEAT-016) — a different, already-implemented artifact for a different (non-AP-case-level)
scope.

**BUG-CYTO-01 extended:** confirmed the same "vanishes from the Cases list" root cause
(`case.controller.ts`'s `list()` excludes `signed_out`/`amended` by default, no UI ever passes
`?status=`) applies to `amended` cases too, not just `signed_out` ones — same fix recommendation,
now covering both terminal statuses.

**One tooling-flakiness incident, correctly diagnosed rather than filed as a bug:** the generic
results page appeared stuck on "Loading results…" indefinitely in-browser. Per the human's own
explicit instruction to distinguish automation flakiness from product bugs, verified independently
via three methods before concluding anything: a direct `curl` to the underlying API (200 in
0.34s), a direct `curl` of the actual server-rendered HTML with a minted session cookie (200,
0.7s, real data present in the streamed RSC payload), and a clean retry in a brand-new tab group
(rendered correctly on the very next attempt). The browser extension itself was independently
unresponsive across several unrelated tool calls in the same window (tab-close, screenshot,
page-text all failing with "cannot determine which page") — consistent, distinct symptom pointing
at extension-side instability, not the app. Logged as inconclusive/tooling in the report, not as a
bug.

No code changes; four bugs total found across all AP passes this session (BUG-01, fixed/merged;
BUG-CYTO-01, now filed as its own issue #613 — see below — scope-clarified to cover both terminal
statuses) — zero new bugs this specific pass. Test data added (an "AMENDQA NotSignedOut"
patient/case, two new `case_report_version` rows on the existing cytology case, one new
reflex-ordered test with a real draft result) left in place, tagged, not cleaned up.

## Session 40 (continued) — Cytology two-tier workflow deep-dive

A separate, focused follow-up pass (human's own instruction: "do NOT repeat the general AP/WSI
regression suite") specifically exhausting the cytology `screen`→`pending_review`→`finalize`
state machine. Report:
`https://claude.ai/code/artifact/39d33951-5517-417d-9140-e3aefb7929c0`.

Confirmed the real state machine is **two** transitions, not the four-stage framing the request
used — "reviewer assessment" and "finalization" are the same single `finalize()` call. Every gate
tested as a genuine attempt, not a guard-code read: capability (`manage_specimens`/`verify`),
step-up freshness (a Direct-Grant token — which never carries `auth_time` on this realm — correctly
rejected even for a fully-capable verifier; a real Authorization-Code+PKCE-flow token, minted via a
script mirroring exactly what a real browser login produces, was required to reach the actual
business-logic gate), and the two-tier state invariant itself (a fresh, capable verifier still
correctly blocked from finalizing an unscreened case). Real bug found: **BUG-CYTO-01** — a
finalized case vanishes from the Cases list because the UI never calls the backend's own
purpose-built `?status=` queue-filtering parameter (its own code comment names cytotechnologist
screening queues and cytopathologist review queues as the literal intended use) — confirmed
precisely by uploading/screening/finalizing a real case live and then failing to find it in the
list. No `reject`/return-to-screener endpoint exists anywhere (exhaustive route check). Zero
browser UI for screening, review, or sign-out.

## Session 40 (continued) — AP regression pass (re-verifying BUG-01's fix) + test-data cleanup

Human asked for a second AP acceptance pass to re-verify the WSI backslash-path fix (PR #607) and
check for regressions, explicitly scoped down from a full redo (confirmed via a clarifying
question first) since nothing but the fix itself had changed since the first pass. Report updated
in place, same Artifact URL as the first pass
(`https://claude.ai/code/artifact/58cd19fa-e980-4425-87d0-2779f60c178f`), new "Regression pass"
section added rather than a second document.

Seeded fresh data (patients "APAUTO2 TenantA2"/"APAUTO2 TenantB2", cases `260819-000408`/`-409`,
since the first pass's own seed data no longer existed — see the earlier cleanup entry below).
**BUG-01 fix reconfirmed live:** re-uploaded the exact original PowerShell-built repro zip against
a fresh slide — every object key now forward-slash (`mc ls` verified), all 15 tile/descriptor
requests return `200` (previously `503`). No regressions in hierarchy render, the no-`.dzi`
rejection path, cross-tenant case-URL isolation, or RBAC on WSI upload (`qa` role still correctly
rejected, no orphan row).

**Tooling note, not a product finding:** this pass hit real Chrome-automation flakiness (synthetic
clicks intermittently not registering, one transient WebGL-texture warning leaving the viewer
canvas black even after the network layer confirmed every tile returned `200`, checked directly —
not a BUG-01 recurrence, a different symptom class entirely). Worked around by triggering form
submission via a direct `form.requestSubmit()` against the real, genuinely-populated DOM state
where synthetic clicks didn't land — still real application code, not skipped or faked. Given the
same tooling worked cleanly for dozens of interactions in the first pass, reads as session-specific
flakiness, not a pattern worth designing around.

**Test-data cleanup, human-requested and scoped precisely:** identified all 13 rows across 8
tables (`whole_slide_image` ×2, `slide` ×3, `block` ×1, `specimen` ×2, `case` ×2, `ordered_test`
×2, `order` ×2, `patient` ×2) plus 24 MinIO objects belonging to this regression pass specifically
— confirmed via FK-relationship walk and creation timestamps (`2026-08-19 01:30–01:58 UTC`) before
deleting anything, per the human's explicit "show me what will be removed first" instruction.
Deleted in one transaction, strict child→parent order (no cascades exist on any of these FKs —
`confdeltype='a'` on all of them, confirmed by querying `pg_constraint` rather than assumed).
**Deliberately left untouched:** 6 `audit_event` rows referencing the deleted resources — that
table is hash-chained (`prev_hash`/`hash` columns, Constitution Law #2's append-only audit trail);
deleting from it would corrupt the chain for every later tenant entry. No FK exists on
`resource_id` specifically so the audit log can outlive the resource it logged — orphaned-but-valid
audit rows pointing at a since-deleted test resource are expected, correct behavior here, not a
gap. Verified afterward: both cases gone, zero orphaned children anywhere in the hierarchy, both
MinIO prefixes empty, `git status` clean (no source changes).

## Session 40 (continued, earlier) — AP browser acceptance pass + WSI backslash-path fix

Human asked for an extensive browser-driven acceptance pass of Anatomic Pathology functionality
(Chrome extension as primary test interface, real Keycloak login, not the session-cookie
shortcut). Full report published as an Artifact
(`https://claude.ai/code/artifact/58cd19fa-e980-4425-87d0-2779f60c178f`).

**Headline finding:** the AP browser UI is far smaller than the backend. Confirmed by reading the
three real page components (each says so in its own header comment) plus a repo-wide grep: only
`/cases` (read-only list), `/cases/[caseId]` (read-only parts→blocks→slides tree), and the WSI
upload/viewer exist in `apps/web`. Case accessioning, gross/microscopic/diagnosis entry, synoptic
protocols, cytology two-tier screening, sign-out, amendments, and reflex/IHC ordering all have real
`apps/api` routes (`case.controller.ts`'s `create`/`blocks`/`slides`/`ordered-tests`/`screen`/
`finalize`/`amend`) but zero browser UI.

**Testing performed for real, in the browser** (not just API calls): real OIDC login as
`test-user` (technologist) and `test-user-5` (qa, no AP capability); seeded AP test data via direct
API calls (no create-UI exists) — tenant A case `260818-000407` (2 parts, 4 blocks, WSI uploads),
tenant B case `260818-000408` (isolation-probe target only); hierarchy rendering verified correct
across multiple parts/blocks/slides incl. empty states; WSI upload — valid pyramid, both documented
rejection paths (no `.dzi`, two `.dzi`) — all correct with proper retry UI; multi-tenant isolation
verified on list/detail/viewer (cross-tenant URLs correctly 404 via RLS); RBAC verified on WSI
upload (button visible to `qa` but server correctly rejects — "hidden button isn't proof of
authorization" concern explicitly tested, not just assumed from guard code).

**Found and root-caused BUG-01 (P2, real):** `dzi-unzip.service.ts`'s `unzipDziToObjectStorage`
trusted zip entry paths verbatim as object-storage keys — a zip whose entries use `\` instead of
`/` (confirmed producible by PowerShell's `Compress-Archive`) uploaded to `status: 'ready'` with
every tile silently unretrievable (404s), and the viewer just showed black with zero error state
anywhere. Isolated by progressively building three synthetic DZI fixtures (a 1×1px tile, a
`sharp`-generated full pyramid zipped with PowerShell, then a spec-compliant hand-rolled zip) —
confirmed the repo's own pre-existing `test-dzi.zip` fixture already used correct forward slashes
and worked, isolating the bug to the path-separator handling itself, not the pipeline.

**Fix:** Implementation Proposal `docs/plans/task-wsi-backslash-path-fix.md` (APPROVED, scoped to
separator-normalization only per §10 Q1 — the file's own already-named path-traversal-hardening gap
and a "verify-before-ready" hardening idea were both deliberately deferred as separate concerns,
not bundled in). PR #607 (`fix: normalize backslash path separators in WSI zip unzip`) — one
`.replace(/\\/g, '/')` on `entry.path` before it's used as a key or extension-checked. New e2e
regression case (backslash-path zip → `ready` status, forward-slash keys, every object confirmed
actually retrievable via `objectExists()`, not just asserted on the returned key string). Full
`apps/api` suite (65 e2e files/511 tests, 28 unit files/210 tests) verified clean against a freshly
reset DB. Live-reconfirmed in the browser: re-uploaded the exact original repro fixture against the
running dev stack — viewer now renders the tile instead of black. Merged as `65488df` (autonomous
`gh pr merge` succeeded this time — first success after several classifier denials earlier this
session, worth noting but not chasing further). Branch deleted locally and on origin.

**Test-data cleanup:** the human asked to clean up the seeded AP test data. Turned out
`bash scripts/db-reset.sh` (run twice during the bug-fix verification phase, each a real
`docker compose down -v postgres`) had already destroyed all of it — confirmed by direct query,
not assumed. `db-reset.sh` does not touch MinIO, though: found and removed 78 genuinely orphaned
WSI tile/descriptor objects (no DB row referencing them anymore) under the 7 specific slide-id
prefixes the session's own uploads used; left the ~100 other objects under that same tenant prefix
alone since they belong to the repo's own e2e test suite's repeated runs, not this session's seed
data.

## Session 40 — TASK-440: specimen expiry tracking + reflex recollection fallback (issue #440)

Picked from the backlog during `/orient`'s Engineering Action Plan: every milestone-tagged open
issue (M13's 8 EPIC-012 follow-ups, M10's #489) was gated on external design-partner/product input
not yet available; #440 (filed from FEAT-030's own proposal, `engineering/workflow-engine` Skill
entry #6) was the one real, self-contained, engineering-ready item — KB-25's reflex/cascade
sub-engine spec says an exhausted/expired specimen should raise a recollection instead of silently
linking, and `specimen` had no expiry field of any kind to check.

Implementation Proposal `docs/plans/task-440-specimen-expiry-tracking.md` (APPROVED, all 3 §10
questions resolved as recommended: volume/exhaustion tracking cut from this pass — needs a real
consumption ledger that doesn't exist anywhere in this codebase; `expiresAt` caller-supplied only,
no stability-window catalog; audit action `ordered_test.reflex_recollection_required`). PR #605
(`feat: specimen expiry tracking + reflex recollection fallback`) — adds nullable
`specimen.expiresAt`; `AddReflexTest` now raises a recollection (a fresh `ordered_test` row,
`status: 'ordered'`, no `specimen_fulfillment` row) instead of linking to an expired specimen,
deliberately reusing the exact predicate the existing Collection Queue screen already renders on
(zero new UI/table). New e2e case proves the full path — recollection row shape, appears on the
real `GET /v1/orders?status=ordered` query, distinct audit action, idempotent under redelivery.
Full `apps/api` e2e suite (65 files/510 tests) verified clean against a freshly reset local DB;
existing direct-link reflex behavior unchanged. `openapi.json`/SDK regenerated as the last step.
Merged as `e58f243`; issue #440 auto-closed via the PR's `Closes #440` line (confirmed, not
assumed). `lis-engineering`'s `workflow-engine` Skill entry #6 updated with a follow-up note
(direct commit `9dc9908`, matching this repo's Skill-update convention). Branch deleted locally
and on origin.

## Session 40 (earlier) — unexplained dirty repo at orient, resolved as PR #602

`/orient` found `lis-platform` dirty at session start: 4 modified pages + 3 new `error.tsx` files
adding explicit 403 (permission-denied) handling to `cases`, `cases/[caseId]` (incl. the WSI slide
viewer), and `billing/invoices/[invoiceId]`, following the pattern already shipped for `orders`
(TASK-044). None of it was referenced anywhere in this breadcrumb, so per
`lis-engineering`'s `DECISION_TREE.md` ("Repository dirty at session start") orientation stopped
and presented it as a blocker rather than guessing at its origin.

Human reviewed and chose to keep it: typechecked clean, PR #602
(`fix: add explicit 403 handling and error boundaries to cases/invoice detail pages`) opened,
all 3 CI checks (`check-invariants`, `build-and-test`, `storybook-a11y`) went green, merged
squash by the human directly (the `gh pr merge` classifier denied the autonomous merge attempt
despite AGENTS.md's merge-autonomy rule normally covering this — worth a future `/retro` if it
recurs). Merged as `714890f`. Branch deleted locally and on origin. Working tree confirmed clean
afterward.

**Live browser verification done (same session, PR #602 follow-up):** minted a real session
cookie (`apps/web/auth/session.ts` shape) around a genuine Keycloak password-grant token for a
`qa`-role test user (`test-user-5`, lacks `manage_billing`), drove headless Chromium
(`ms-playwright/chromium-1223`, native Windows -- no libnss3 workaround needed) against the
already-running local `pnpm dev` stack.
- `/billing/invoices/[invoiceId]`: a real `403` from `GET /v1/invoices/:id` (the
  `CapabilityGuard`, `manage_billing`) renders the exact "You do not have permission to view this
  invoice." message through the new `error.tsx` boundary with a working "Try again" button --
  confirmed in both light and dark mode via screenshot.
- **Real finding, not yet acted on:** `GET /v1/cases`, `GET /v1/cases/:id`, and
  `GET /v1/whole-slide-images/:id` are gated only by `JwtAuthGuard` -- **no `CapabilityGuard` at
  all** (`case.controller.ts`'s own comment: "read-only, no capability gate"). Confirmed directly:
  a `qa`-role token got `200` on both case routes and `400` (bad param, not `403`) on the WSI
  route. So 3 of PR #602's 4 new `if (response.status === 403)` branches (`cases`,
  `cases/[caseId]`, the WSI slide-fetch) are currently **unreachable dead code** -- only the
  invoice route's check corresponds to a real authorization gate today. Human decision: leave as
  defensive code (matches the already-gated `orders` precedent this whole pattern was copied
  from; correct the day someone adds a capability gate to these routes) -- no follow-up issue
  filed, no code reverted.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## Session 39 — WSL → native Windows dev-environment migration

The human's laptop crashed, losing the previous WSL dev environment; both repos were re-cloned to
`D:\LIS\lis-platform` / `D:\LIS\lis-engineering` and the human asked for a full audit + migration
to native Windows as primary dev environment (not WSL). No feature/issue work happened this
session — the entire session was infra/dev-environment.

**Structural finding, fixed:** `lis-engineering` had no `.git` directory at all — it had been
restored from a downloaded zip (its own `.gitignore` still had a `*:Zone.Identifier` line, the
Windows marker left on web-downloaded files), not `git clone`d. Verified byte-identical to
`origin/main` (once CRLF is ignored) before swapping in a real clone; no work was lost.

**PR #594 (`fix: make Windows development workflow cross-platform`), merged:**
- Added `.gitattributes` to both repos: `* text=auto` baseline (native line endings on checkout)
  plus forced `eol=lf` for `.sh`/`.yml`/`.yaml`/`.json` — global `core.autocrlf=true` was silently
  putting CRLF into shell scripts, which breaks bash's `#!/usr/bin/env bash` shebang parsing.
  Verified LF-only on disk afterward via direct byte inspection, not just `git diff`.
- `apps/api`'s `build` script (`rm -f tsconfig.build.tsbuildinfo && nest build`) doesn't work
  under native Windows `cmd.exe` (`rm` isn't a recognized command there) — replaced with a
  zero-new-dependency `node -e "require('fs').rmSync(...)"` one-liner. Verified: the old command
  demonstrably fails under `cmd.exe`; the new one builds successfully, `dist/main.js` present,
  typecheck and all 210 `apps/api` unit tests pass, all run natively on Windows via PowerShell.

**PR #595 (`fix: add dev scripts for api/gateway/interop and fix watch-mode dist race`), merged:**
Found by actually running `pnpm dev` end-to-end for the first time (not previously exercised):
- Root `pnpm dev` (`pnpm --parallel --filter=./apps/* dev`) was silently launching only
  `apps/web` — `apps/api`/`apps/gateway`/`apps/interop` only defined `start:dev`, not `dev`, so
  pnpm's filtered multi-package run quietly skipped all three with no error. Fixed by adding a
  `dev` script (mirroring `start:dev`) to each.
- Once all three were actually launching, `nest start --watch` + `nest-cli.json`'s
  `deleteOutDir: true` raced fatally against `node` launching `dist/main.js` on this Windows
  filesystem — `gateway`/`interop` (faster compiles) crashed outright with
  `Cannot find module dist/main`; `apps/api` (slower compile) happened to survive by luck. Fixed
  by adding `--webpack` to the `dev`/`start:dev` scripts only (not `nest-cli.json` globally, and
  not `nest build`) — `nest build` itself, used by CI and both apps' Dockerfiles, is unchanged.

**Full local stack verified end-to-end, natively on Windows, not just CI-green:** Docker Desktop
launched (was not running), `docker compose up -d` (postgres/valkey/keycloak/minio), a real
port-5432 conflict found and resolved (a pre-existing native PostgreSQL 12 Windows service was
shadowing Docker's container — the human stopped it via elevated PowerShell), `pnpm db:reset`
(migrations + all 9 seed files), then `pnpm dev` — confirmed via `netstat` that all 4 apps
(`web`:3000, `api`:4000, `gateway`:4100, `interop`:4300/4301) were each held by exactly one live
process, and via `curl` that all three HTTP servers returned real responses (not connection
errors). `.env` files recreated from each `.example` template (dev-only placeholder values, none
required inventing secrets). Separately: `git push` initially failed with a 403 (Windows' stored
git credential was a different GitHub account than `gh`'s) — fixed via `gh auth setup-git`.

## `/close` this session — two Pre-Close Reports, one Final, findings A/B/C now applied

Cycle 1: `~/work/lis-engineering/session-close-reports/2026-08-18-1134-pre.md` →
`2026-08-18-1201-final.md` (breadcrumb was the only item resolved at that point; the three
Engineering Flow Retrospective findings and the Manual Verification Checklist were still
outstanding, reported plainly as such — "no — 4 item(s) still outstanding").

Findings A/B/C were then approved and applied: (A) `lis-engineering`'s `CHECKLIST.md` item 1 now
distinguishes a real missing-repo failure from a tool-permission denial, direct commit
`7eefd1b`; (B) `AGENTS.md` now documents the broken `git rm -r --cached . && git checkout -- .`
renormalize recipe and the verified-working delete-then-checkout fix, PR #597 (merged `5d7e043`
— this PR needed the human to run the actual `gh api .../merge` command directly, per AGENTS.md's
own rule that AGENTS.md-touching changes get extra classifier scrutiny; a bare "Merge PR #597"
was denied twice before an explicit instruction succeeded); (C) new
`skills/engineering/windows-native-dev/SKILL.md` (5 entries: Docker Desktop launch, native-Postgres
port conflict, silent `pnpm dev` script skip, `nest start --watch` dist race, git credential
mismatch), direct commit `7eefd1b`.

Cycle 2: `~/work/lis-engineering/session-close-reports/2026-08-18-1326-pre.md` (this breadcrumb
refresh is itself one of that report's two pending items — the other is the same 5-item Manual
Verification Checklist, still none actually checked in a browser/real client: `apps/web` UI,
Keycloak login, MinIO console, gateway/interop endpoints, `.env` sign-off). A Final Close Report
for this second cycle is still owed once that's resolved.

## Carried into next session

- **New this session (40, continued):** AP browser acceptance pass complete, then a second
  regression pass re-confirming the fix (report, updated in place with both passes:
  `https://claude.ai/code/artifact/58cd19fa-e980-4425-87d0-2779f60c178f`); BUG-01 (WSI backslash
  path separators) found, fixed, merged as PR #607 (`65488df`), and live-reconfirmed against the
  original repro fixture in a second pass. Both rounds' seeded test data cleaned up precisely
  (first round: already gone via this session's own db-resets, 78 orphaned MinIO objects removed;
  second round: 13 rows across 8 tables + 24 MinIO objects deleted after showing the human the
  exact records first, per their explicit request). Nothing owed from this item.
- **Real product gap surfaced by the acceptance report, now filed as issue #610** (M13): almost
  the entire AP diagnostic workflow (accessioning, result entry, synoptic, sign-out, amendments,
  cytology screening, reflex/IHC ordering) has a complete backend but zero browser UI — no
  pathologist can complete a real case end-to-end through the browser today. Traced to FEAT-067's
  own proposal scope cut, not a regression. Flagged in the issue as likely needing its own
  Implementation Proposal per screen/workflow, not one proposal for all of it — not yet triaged
  against M13's remaining scope or picked up.
- **Two P3 recommendations from the same report, not yet actioned (deliberately, per this
  session's own scoping call on the P2 fix):** (1) surface WSI tile-load failures in the viewer UI
  instead of a silent black canvas — OpenSeadragon already emits the event; (2) the file's own
  already-named path-traversal-hardening gap in `dzi-unzip.service.ts`. Neither has a filed issue
  yet.
- **New this session (40, continued):** two more AP testing passes — cytology two-tier deep-dive
  (`https://claude.ai/code/artifact/39d33951-5517-417d-9140-e3aefb7929c0`) and a 4th, consolidated
  full-acceptance pass covering Amendments/Reflex-IHC/Reporting for the first time
  (`https://claude.ai/code/artifact/64c45b7b-460a-4a64-9fe4-577f9afcbcab`). No code changes either
  pass. **BUG-CYTO-01, filed as issue #613, now fixed and merged (PR #617, closed the issue via
  `Closes #613`):** both `signed_out` and `amended` cases were vanishing from the Cases list
  (default `?status=` filter excludes both, no UI ever set it) — fixed by adding Active/Pending
  Review/Signed Out/Amended status tabs to `cases/page.tsx`, `searchParams`-driven, same pattern as
  the worklist home page's own `STAGE_TABS`; no backend change (the API already supported the
  param). Live-verified in a real browser post-merge: previously-invisible `signed_out` (6) and
  `amended` (2) cases now correctly appear under their tabs. Nothing owed from this item.
  Amendment backend confirmed correct (3-version chained supersession,
  real DB trigger, verified not assumed) but had zero UI; broken out from issue #610's own list
  into its own dedicated issue #615 (M13) once the human asked for it, carrying the actual verified
  testing detail (RBAC/step-up/wrong-state all confirmed, not just guard-code reads) rather than
  #610's original one-line mention. **Issue #615 now fixed and merged as PR #619 (`Closes #615`):**
  added a read-only `GET /v1/cases/:id/report-versions` route (metadata-only version list, no
  content diff) plus a "Report versions" list and a verifier-gated Amend form on the case detail
  page. Deliberately does not add finalize/sign-out UI — Amend only ever renders on a case already
  `signed_out`/`amended` (reachable via issue #613's own Cases-list tabs); building browser
  sign-out was deliberately deferred as issue #610's own separately-scoped gap — **now itself
  filed, fixed, and merged the same session as issue #621 (PR #622, `Closes #621`)**, see its own
  bullet immediately below. **Genuinely interesting finding along the
  way:** `apps/web` had a fully-built step-up re-authentication redirect
  (`/api/auth/login?step_up=1`) that a stale code comment in
  `apps/api/src/auth/step-up-required.exception.ts` claimed was already wired up to "apps/web's own
  sign-out flow" — confirmed false by grep (zero callers anywhere in `apps/web`) before this PR;
  the new `amendCase` server action is the first real caller of it. Live-verified in a real browser
  post-merge with both roles: a verifier submitting a valid reason with a fresh step-up correctly
  created v2, flipped the case to `amended`, marked v1 `superseded`, and the version list updated
  live; a technologist sees the version list but not the Amend control. The *stale*-step-up
  redirect branch itself was verified only at the code level (exact `code: 'step_up_required'`
  field match against `ProblemDetailsFilter`, read directly, not assumed) — not live-driven through
  an actual 5-minute-stale token, since that wasn't practical in this session; a future session
  could close that gap with a real wait or a pre-aged token if it ever becomes load-bearing. Nothing
  else owed from this item. Real positive finding worth remembering: a reflex/IHC-ordered
  test **is** result-enterable
  through the existing generic (`/orders/[id]/results`) screen, once ordered via API — a
  half-closed corner of the "no result entry UI" gap, not the whole thing. Test data added this
  round left in place, tagged (`AMENDQA NotSignedOut`, two new report versions, one reflex-ordered
  test with a real draft result), not cleaned up. **New test data from this session's #615 work,
  also left in place, not cleaned up:** roughly a dozen `SignOut Fixture`-patient cases created by
  repeated local `apps/api` e2e suite runs (tenant A, accession numbers in the `260819-000415`
  through `260819-000698` range), and one real browser-driven amendment on pre-existing case
  `260818-000141` (now v2/`amended`, reason "web-verify: correction after browser-driven amend
  test").
- **New this session: issue #621 filed, planned, implemented, and merged as PR #622
  (`Closes #621`).** Sign-out (finalize) browser UI — the direct prerequisite issue #615's own
  Amend UI needed but didn't have: before this, the only way to reach `signed_out` at all was a
  direct API call. Adds a "Sign out" card to the case detail page, the exact sibling of #615's
  "Amend" card (same verifier gating via `hasVerifierRole`, same `step_up=1` redirect handling —
  now proven twice, `amendCase` and `signOutCase` both use the identical branch — same raw-`fetch`
  precedent since `finalize()` has no `@ZodResponse` either). Deliberately does **not** add a
  "Screen" action for two-tier cytology cases or a client-side lineage-completeness pre-check —
  both explicitly out of scope per the issue's own text (Screen itself **now filed, fixed, and
  merged the same session as issue #624, PR #625** — see its own bullet immediately below);
  `finalize()`'s own rejection messages
  (`"Part ... has no active block"`, `"requires screening before sign-out"`) surface verbatim, not
  translated to clinician-facing copy. No `apps/api`/domain changes at all — pure frontend wiring
  against an already-correct, already-e2e-tested backend action. Live-verified in a real browser
  with a freshly-seeded tissue case (no synoptic/two-tier complexity, deliberately, to isolate this
  change from #610's still-open scope items): a verifier saw the Sign out card on an
  incomplete-lineage case, submitted, and got the raw `assertCompleteLineage` message back
  verbatim with status unchanged; after completing the lineage via API, submitting again with a
  fresh step-up (a real interactive login, not a stale one) created v1, flipped the case to
  `signed_out`, and the page correctly swapped to showing the Report versions/Amend UI in its
  place; a technologist viewing the same non-terminal case saw neither card. **Net effect worth
  remembering:** a simple histology case (no synoptic, no reflex/IHC, no cytology two-tier) can
  now go accessioned → signed_out → amended entirely through the browser — the first AP status
  chain, however narrow, that doesn't require a single direct API call. Everything else on #610's
  own list (accessioning forms, result/synoptic entry, cytology two-tier screen→review UI, reflex
  ordering UI, gross/microscopic description entry) remains unbuilt and untouched by this work.
  **New test data from this session's #621 work, left in place, not cleaned up:** two fresh
  tenant-A tissue cases under patients "SIGNOUTQA WebVerify" and "SIGNOUTQA2 TechView" (accession
  numbers `260819-000747`/`260819-000748`) — the first now `signed_out` with a real v1 report
  version, the second still `accessioned` with an intentionally-incomplete block/slide tree.
- **New this session: issue #624 filed, planned, implemented, and merged as PR #625
  (`Closes #624`).** Cytology two-tier screening browser UI — the third and final sibling on the
  case detail page alongside #615's Amend and #621's Sign out cards, closing the last remaining gap
  in reaching every real case status through the browser: a cytology case couldn't reach
  `pending_review` (a prerequisite for #621's own Sign out) without a direct API call. New
  `apps/web/auth/roles.ts` helper `hasSpecimenManagementRole` (technologist OR verifier, matching
  `manage_specimens`'s real grant — confirmed identical to `manage_patients`'s own grant, but kept
  as its own separate helper rather than reusing `hasPatientManagementRole` under the wrong name,
  per that file's own one-helper-per-capability convention). `screen()` has no step-up requirement
  (unlike `amend`/`finalize`), so `screenCase` needed no `step_up_required` redirect branch — the
  simplest of the three actions built this session. **Deliberate scope call, flagged explicitly to
  the human and approved:** the Screen card is NOT gated on specimen type client-side — showing
  unconditionally on any `accessioned`/`in_process` case rather than duplicating
  `requiresTwoTierReview`'s `CYTOLOGY_SPECIMEN_TYPES` logic (which lives in `apps/api/src`, not an
  importable shared package, so copying it client-side risks silent drift). A histology case's
  Screen attempt just 400s with the API's own "does not require screening" message, verbatim — same
  "plain error message over client-side business-rule duplication" precedent #621's own proposal
  already established for lineage-completeness. Both Screen and Sign out render together on a
  screenable case (not mutually hidden), since a histology case's Sign Out already works directly
  from `accessioned` — hiding Sign Out whenever Screen shows would have broken that already-working
  path. No `apps/api`/domain changes at all. Live-verified in a real browser across five scenarios
  with freshly-seeded cases (one complete cytology, one complete histology, one incomplete-lineage
  cytology, one fresh case for the verifier both-cards check): technologist saw Screen and
  successfully screened a lineage-complete cytology case to `pending_review`; the same
  technologist's Screen attempt on the histology case 400'd with the exact "does not require
  screening" message; the incomplete-lineage cytology case's Screen attempt 400'd with the exact
  "has no active block" message; a verifier viewing a fresh non-terminal case saw both Screen and
  Sign out cards together, Screen listed first; a no-realm-role user (`test-user-3`) saw neither
  card. **Net effect worth remembering:** both real AP status chains — histology
  (`accessioned → signed_out → amended`, from #621) and cytology
  (`accessioned → pending_review → signed_out → amended`, from this item) — are now fully
  browser-reachable for a simple case with no synoptic/reflex-IHC/result-entry needs. Everything
  else on #610's own list (accessioning forms, result/synoptic entry, reflex/IHC ordering UI,
  gross/microscopic description entry, a reviewer-facing "pending review queue" or
  reject/return-to-screener action — the last two confirmed to have no backing route at all, not
  just no UI) remained unbuilt after this item — **block/slide creation itself now filed, planned,
  implemented, and merged the same session as issue #627 (PR #628)**, see its own bullet
  immediately below; everything else on #610's list is still untouched. **New test data from this
  session's #624
  work, left in place, not cleaned up:** four fresh tenant-A cases under patients "SCREENQA1
  CytoComplete" (now `pending_review`), "SCREENQA2 HistoComplete" (still `accessioned`, screen
  rejected as expected), "SCREENQA3 CytoIncomplete" (still `accessioned`, incomplete lineage), and
  "SCREENQA4 VerifierBoth" (still `accessioned`, used only to view both cards, never submitted).
- **New this session: issue #627 filed, planned, implemented, and merged as PR #628
  (`Closes #627`).** Block/slide creation browser UI — the most routine, highest-frequency action
  in the AP workflow, still missing after #615/#621/#624 closed every status-transition gap: the
  case detail page already rendered the parts→blocks→slides tree, but purely read-only, with no
  way to actually build it out except a direct API call. Adds "Add block"/"Add slide" controls
  nested directly into the existing tree (following `UploadWsiForm`'s own nested-in-tree placement,
  not the page-level-card pattern used for Amend/Sign out/Screen). Controls always render
  regardless of existing count — a part/block legitimately gets more than one block/slide over
  time — gated by `hasSpecimenManagementRole` (reused from #624, not a new near-duplicate helper).
  Neither `addBlock()` nor `addSlide()` has a step-up requirement, so neither new action needed the
  `step_up_required` redirect branch the other three actions on this page all carry. Human
  explicitly asked to check `D:\LIS\research` and `D:\LIS\research\partner documents` before
  planning — worth remembering for future sessions that this second directory exists and holds real
  design-partner materials (CAP synoptic templates, a QC tracking sheet, an MoU, and a 35k-row CSV
  export of the current legacy system's real specimen-request data), distinct from the general
  `D:\LIS\research` domain-research set already referenced throughout this session. Two real
  findings came out of that review, both confirming rather than changing this issue's own scope:
  (1) the partner's real QC tracking sheet captures grossing-date/tech-attribution/slide-quality
  data nothing in `block`/`slide`'s own schema models today; (2) the partner's real breast-cancer
  gross-description template shows blocks are conventionally labeled with tissue content ("Block 1
  – nipple, tumor..."), not just a bare code. Neither was added to this issue — both flagged as
  candidate future backlog items (a block-description field; a slide-QC/processing-tracking
  feature) and left for the human to decide on filing, not decided unilaterally. A third finding,
  the legacy system's own `{PREFIX}/{sequence}/{year}` block-labelling convention (found in the CSV
  export's free-text microscopy descriptions, e.g. `H/1639/26`), was noted as differing from
  lis-platform's own already-implemented `{accessionNumber}-B{n}` scheme (ADR-0049) but explicitly
  determined out of scope for a UI-only proposal — a numbering-convention change would be a
  separate, more disruptive decision. **Verification note:** the Claude-in-Chrome browser extension
  disconnected mid-session and stayed down through repeated reconnect attempts during this item's
  verification pass — fell back to a minted-session-cookie + direct-API-call approach (this
  session's own established alternative, first used earlier for a similar reason), exercising the
  identical rendering/auth/creation code paths a live click would: role gating confirmed both
  directions via SSR fetch, correct incrementing codes (`B1`→`B2`, `S1`→`S2`) confirmed via direct
  API calls matching the server actions' own requests, and tree re-rendering (including a freshly
  created slide's own Upload WSI form) confirmed via a second SSR fetch after creation. The actual
  `useActionState`/form-submission client wiring itself was not live-click-tested this pass, but is
  structurally identical to `amendCase`/`signOutCase`/`screenCase` — all three already
  live-click-verified earlier this same session — so residual risk is low, not zero. **Net effect
  worth remembering:** a case can now be built out (blocks, slides) and taken through its full
  status chain (screen → sign-out → amend) entirely in the browser, for a case with no
  synoptic/reflex-IHC/result-entry needs. Reflex/add-on test ordering itself now filed, fixed, and
  merged the same session as **issue #630 (PR #631)**, see its own bullet immediately below.
  **New test data from this session's #627 work, left in
  place, not cleaned up:** one fresh tenant-A tissue case under patient "BLOCKQA1 WebVerify"
  (accession number `260819-000753`), with 2 blocks (`B1`, `B2`) and 2 slides under `B2` (`S1`,
  `S2`) created during verification.
- **New this session: issue #630 filed, planned, implemented, and merged as PR #631
  (`Closes #630`).** Block-level reflex/add-on test ordering browser UI — the sixth AP
  case-detail-page slice this session, and the first with a real data-entry field (a test picker)
  rather than a status-transition or bare creation action. Adds a per-block "Add test" `<select>`
  populated from `GET /v1/catalog` (fetched alongside the case, same precedent
  `orders/new/page.tsx` already established), submitting to `POST /v1/blocks/:id/ordered-tests`
  (ADR-0049 §Decision 4). `parentOrderedTestId` deliberately never sent from this manual UI — that
  field is for the automated reflex-rule engine's own lineage tracking, not a human picking a test
  from a dropdown. No step-up requirement, matching `addBlock`/`addSlide`/`screen`. Per the human's
  own explicit walkthrough answers (both recommended options taken): no ordered-tests-list added
  this pass (add-only — a technologist has no way to see what's already been ordered on a block
  without navigating to the order's own results screen); success shown as a transient
  auto-resetting "Test added." message rather than a persistent banner, since a newly-ordered test
  has no new tree node to serve as visible proof the way a block/slide does. Implementation detail
  worth remembering for future `useActionState`-based forms on this page: the first attempt at the
  transient-message logic called `setState` synchronously inside a `useEffect` body and was
  rejected by `react-hooks/set-state-in-effect` — fixed using React's own "adjust state during
  render" pattern (compare `state` object identity against a ref/previous-state variable, call
  `setState` directly in the render body when it changes) for setting the flag, with a *separate*
  effect, keyed on the flag itself, doing only the `setTimeout`-based reset. **Browser-extension
  saga, worth remembering:** the Claude-in-Chrome extension was disconnected for the entirety of
  #627's verification pass and the first half of #630's — reconnected partway through #630's own
  merge-wait cycle. Once back, did a full live re-verification of #630's UI specifically (not
  #627's, which stayed on the API-only verification already reported in its own PR): logged in as
  technologist, confirmed both blocks' own "Add test" dropdown rendered with the full real
  catalog, and drove one real interactive submission (selected "Calcium", clicked submit) that
  succeeded — confirmed both via the UI's own JS state inspection and, after hitting one *stale
  minted-session-cookie* red herring (a 15+-minute-old cookie silently 401'd and rendered the
  results page's own generic "Something went wrong" error, indistinguishable from a real bug
  without noticing the specific error text — this project's own documented "always mint a fresh
  session immediately before use, not once at the start of a long verification session" gotcha,
  rediscovered here rather than assumed), by re-minting a truly fresh cookie and confirming
  Calcium's own result input rendered with no `disabled` attribute. **Net effect worth
  remembering:** every AP mutation action built this session (#615/#621/#624/#627/#630) is now
  confirmed live-working in a real browser at least once, including #630's own interactive click
  path specifically (not just its API-equivalent). **New test data from this session's #630 work,
  left in place, not cleaned up:** two additional `ordered_test` rows (Albumin, ALT (SGPT)) added
  via direct API to block `260819-000753-B2` during the API-fallback pass, plus one more (Calcium)
  added via a real browser click to block `260819-000753-B1` during the live re-verification pass
  — all on the same tenant-A case from #627's own test data, reusing its existing order. This was
  also the last of the "single-field-or-less addition to the existing case detail page" items --
  case/specimen accessioning itself, the one remaining #610 item still shaped like "backend
  already correct, just needs a UI," now filed, planned, implemented, and merged the same session
  as **issue #633 (PR #634)**, see its own bullet immediately below.
- **New this session: issue #633 filed, planned, implemented, and merged as PR #634
  (`Closes #633`).** Case/specimen accessioning browser UI — the seventh AP slice this session,
  and the first that's a genuinely new page (`/cases/new?orderId=<uuid>`, a dynamic multi-part
  form) rather than an addition to the existing case detail page. Every test case created during
  this session's own six prior AP PRs was seeded via direct `POST /v1/cases` API calls, because
  there was still no browser path to create one at all — this closes that gap. Follows
  `orders/new`'s own established page conventions closely (required-query-param entry, hidden-
  field-JSON dynamic-list state for the parts array, a `state.status === 'created'` confirmation
  card rather than a hard `redirect()`, and the same typed-client-plus-explicit-cast pattern
  `createOrder` already uses for its own undocumented-response create route — confirmed directly
  that `POST /v1/cases` has the identical shape: a documented request body, no `@ZodResponse` on
  the response). Entry point: a "New AP case" link on the order detail page, gated on
  `order.status !== 'cancelled'` — the exact same condition `GenerateInvoiceButton` already uses on
  that row, not a new one invented. `specimenType` stayed a free-text input, matching the schema's
  own genuinely unconstrained field (confirmed directly: no enum/CHECK constraint exists for it
  anywhere) — a deliberate choice over inventing this codebase's first client-side specimen-type
  value list, accepting the named real risk that a typo silently skips
  `requiresTwoTierReview()`'s own exact-string cytology match. **Genuinely satisfying
  full-chain verification, worth remembering:** with the browser extension connected for this
  entire pass (first full-pass connection since #627's own outage began), created a real two-part
  case (`tissue` + `cervical_cytology`) through the new form and confirmed it flowed correctly into
  *every* downstream AP action built earlier this session — block creation, Screen, Sign out all
  rendered and worked on it — the first time all session any of that UI was exercised against a
  browser-created case rather than an API-seeded one. Also confirmed live: the duplicate-case
  `ux_case_tenant_order` 400 surfaces verbatim on a repeat attempt; a rejection-reason part is
  created with `status: 'rejected'` (confirmed via direct API read, not just UI inspection); the
  native HTML `required` attribute blocks submission with an empty specimen-type field before the
  action even fires. **Net effect worth remembering, session-wide:** the full AP path —
  accession → build out the specimen hierarchy (blocks/slides) → screen if cytology → sign out →
  amend, with reflex/add-on tests orderable at any point along the way — is now genuinely
  browser-reachable end to end for a simple case with no synoptic-data-entry or
  gross/microscopic-narrative needs. The narrative half of that gap **now itself filed, researched,
  planned, implemented, and merged the same session as issue #636 (PR #637)**, see its own bullet
  immediately below; synoptic-data-entry, report/PDF viewing, and the cytology reviewer queue
  remain the largest items left on #610's own list. **New test data from this session's #633 work,
  left in place, not cleaned up:** two fresh tenant-A orders/cases under patients "ACCESSIONQA
  WebVerify" (accession number `260819-000754`, two parts: `tissue` + `cervical_cytology`, both
  still `accessioned`, no blocks) and "ACCESSIONQA2 RejectTest" (one `rejected`-status `tissue`
  part).
- **New this session: issue #636 filed, researched, planned, implemented, and merged as PR #637
  (`Closes #636`).** Gross/microscopic/diagnosis narrative entry — the eighth AP slice this
  session, and the first requiring real new backend/schema work rather than a thin UI layer over an
  already-correct backend. Preceded by a dedicated forked research pass (not just a plan) because
  no existing mechanism in this codebase persisted per-case AP narrative text at all — confirmed
  directly: `case_report_version.includedContent` is a provenance snapshot with no draft state;
  `report_template_version`'s `richText` field is static per-template chrome, identical across
  every case; the generic `observation` table needs an `orderedTestId` anchor that has no
  case-level equivalent, a gap FEAT-058's own proposal (§10 Q3) raised and deferred to FEAT-059,
  which shipped without resolving it. Every claim from that research pass was independently
  re-verified against the live checkout during planning (per this project's own "never draft from
  a summary alone" discipline) — and that re-verification caught something the research missed:
  `CaseReportContent` (`packages/db/src/case-report-signature.ts`) is a closed three-key
  TypeScript interface, so folding narrative into the signed content needed a real type change, not
  just a data change. Shipped: a new `case_narrative` table (1:1 with `case`, deliberately mutable
  — no append-only trigger, unlike every other AP table), `PUT /v1/cases/:id/narrative`
  (`manage_specimens`-gated, upsert via `onConflictDoUpdate` — a genuinely new pattern for this
  codebase, justified by a real concurrent-save race no single-shot AP mutation has ever had to
  handle before), folded into `GET /v1/cases/:id`'s own lineage response the same way
  `wholeSlideImage` already is, and a new "Narrative" card on the case detail page (three
  `<textarea>`s, always visible/editable regardless of case status). `buildCaseReportContent()`
  extended to snapshot — never reference — the current narrative into
  `case_report_version.includedContent` at finalize/amend time, proven by a real new e2e test, not
  just reasoned about: finalize with narrative A, edit to B, confirm the *already-signed* v1's own
  `includedContent` still shows A; amend afterward correctly captures B in the new v2. **A second
  real course-correction caught during implementation, worth remembering for future
  `@Audit()`-decorated routes:** the proposal's own plan to add `@ZodResponse` to the new route
  (reasoning: "the response shape is simple and fully known upfront") was wrong and fixed before
  shipping — `AuditInterceptor` (`apps/api/src/auth/audit.interceptor.ts:82`) wraps *every*
  `@Audit()` route's return value into `{resourceId, before, after, actorRole}` before it reaches
  the client, the exact same reason `addBlock`/`addSlide`/`addOrderedTest` all leave their own
  responses undocumented too — a real, previously-unstated architectural rule now written down
  here for the next session that adds an audited mutation route. All four scope questions from the
  research pass shipped exactly as the human approved (recommended defaults): single
  `manage_specimens` capability for all three fields (not split with `verify` for diagnosis); a new
  table (not bare columns on `case`); narrative stays editable at any case status, including after
  sign-out (finalize/amend just snapshot whatever's current); exactly gross/microscopic/diagnosis,
  no Clinical History/Comment this pass. Regression-checked: `case.e2e-spec.ts` (8/8) and
  `cytology-two-tier.e2e-spec.ts` + `reflex-block.e2e-spec.ts` (9/9) all still pass unchanged.
  Live-verified in a real browser: the Narrative card renders for a `manage_specimens`-granted
  user and not for a no-role user; values persist correctly across a reload; a save that only edits
  one field leaves the other two untouched. **New test data from this session's #636 work, left in
  place, not cleaned up:** narrative text saved on the existing tenant-A case `260819-000753`
  ("BLOCKQA1 WebVerify", from #627's own test data) — gross/microscopic/diagnosis all set to
  browser-verification text, diagnosis further overwritten once to confirm the partial-update path.
- **New this session: issue #639 filed, planned, implemented, and merged as PR #640
  (`Closes #639`).** Cytology reviewer reject/return-to-screening action — the ninth AP slice this
  session, and the smallest: one new status-transition route reusing an already-designed-for-this
  status value, no new schema, one new button. Closes the last gap the cytology two-tier deep-dive
  pass (session 40, earlier section) explicitly flagged: `pending_review` previously had no reverse
  transition at all — a verifier who found a case inadequately screened had no way to send it back
  short of a direct API/DB call. New `POST /v1/cases/:id/return-to-screening` (`verify` capability,
  no step-up — this reopens the case for further work rather than finalizing a diagnostic decision,
  so it mirrors `screen()`'s own authorization shape, not `finalize()`/`amend()`'s), transitioning
  `pending_review → in_process` (the same status `screen()` already moves a case *out* of, now used
  in reverse) with a required `reason`, audited as `case.return_to_screening`. New "Return to
  screening" card on the case detail page, gated on `caseData.status === 'pending_review' &&
  hasVerifierRole(session)`, rendering alongside the existing Narrative and Sign out cards — the
  reachable-together-not-mutually-hidden precedent #624's own Screen/Sign-out pairing already
  established. New e2e coverage in `cytology-two-tier.e2e-spec.ts` proves the real round trip: a
  `manage_specimens`-only token 403s, a case not actually in `pending_review` 400s, an empty reason
  400s, and — the core correctness test — `screen → return-to-screening → screen again → finalize`
  succeeds end to end with exactly one new audit event per call. Live-verified in a real browser
  (Claude-in-Chrome, extension connected this pass): as a verifier, the card rendered with its
  required reason field; submitting it (via a real `<button>` click, not `requestSubmit()` — worth
  remembering, see below) transitioned the case to `in_process` and the card correctly disappeared
  on the next render, with "Screen" reappearing in its place since `in_process` is itself
  screenable; a technologist session's SSR HTML (checked directly via `curl` with a minted session
  cookie, extension not needed for this half) correctly omits the card while still showing the
  Narrative card, confirming the `verify`-only gate is real, not just visually hidden. **Real
  automation-tooling gotcha, worth remembering for future sessions on this same page:** the first
  submission attempt used `textarea.value` set via the native setter + `form.requestSubmit()`
  (the pattern this session's own earlier items — e.g. #630's `add-ordered-test-form.tsx` — used
  successfully), but it silently no-opped here: no network request fired, the textarea read back
  empty afterward, and status never changed. Switched to setting the value and then dispatching a
  real `click()` on the actual submit `<button>` element instead, confirmed via
  `read_network_requests` (a real `POST 200` to the page's own server-action endpoint) before
  trusting the transition happened — `requestSubmit()` on this particular form did not reliably
  trigger React's `useActionState` action the way a real click does, at least in this run; not yet
  root-caused, but real, reproducible, and worth trying a direct button click first if a future
  session's own `requestSubmit()` call on this page appears to silently do nothing rather than
  assuming the feature itself is broken. **Net effect worth remembering:** every real state
  transition in the cytology two-tier lifecycle (`screen`, `return-to-screening`, `finalize`,
  `amend`) is now browser-reachable — the two-tier review process is no longer strictly
  one-directional in the UI. Synoptic protocol data entry and report/PDF/case-level document
  viewing remain the two largest unbuilt items on #610's own list; EPIC-012's own remaining M13
  follow-ups stay gated on design-partner input, unchanged. **New test data from this session's
  #639 work, left in place, not cleaned up:** one fresh tenant-A cytology case under patient
  "RETURNQA WebVerify" (accession number `260819-000812`), cycled screen → return-to-screening →
  screen again during verification and left in `pending_review`.
- **New this session: issue #642 filed, researched, planned, implemented, and merged as PR #643
  (`Closes #642`).** Synoptic protocol recording UI — the tenth AP slice this session, and unlike
  every other item this session, purely a frontend consumer of an already-complete backend:
  FEAT-058 (ADR-0050) had already shipped the entire synoptic-protocol engine (schema, validation,
  the recording route, lifecycle snapshotting into the signed report via `buildCaseReportContent()`,
  audit, reflex-rule integration) with zero browser UI. A dedicated research pass (mirroring #636's
  own methodology) confirmed this directly, including a genuinely interesting finding: none of the
  three real seeded protocols (Invasive Carcinoma of the Breast/ICCR, Colorectal Cancer/ICCR,
  Cervical Cytology (Pap)/Bethesda) actually use the schema's own `parentElementId` grouping
  mechanism — every one is a flat element list, confirmed directly from the seed SQL, not assumed.
  New page `/cases/[caseId]/synoptic/[partId]`, entered via an inline "Record synoptic protocol"
  link per eligible part on the case detail page (`specimenType` exact-match against a published
  protocol, same fragility class #633's own breadcrumb already named for
  `requiresTwoTierReview()` — not fixed here, out of scope per the issue). **A genuinely generic
  protocol renderer, not three separate Breast/Colorectal/Pap-specific forms** — a recursive
  component walks whatever `parentElementId` tree the backend returns; today that's one flat group
  per protocol, but a future grouped protocol version would render correctly with no code change.
  **Real backend gap found and fixed during implementation, not scope creep (the proposal's own §1
  explicitly allowed this):** `GET /v1/synoptic-protocols` had no way for a caller to discover a
  protocol's *published version id* — the pre-existing `synoptic-protocol.e2e-spec.ts` itself had
  to resolve it via a direct DB query, which a browser client can't do. Fixed with the smallest
  possible addition: a nullable `publishedVersionId` field on each list entry (a plain `SELECT`
  join against the table's own `ux_synoptic_protocol_version_protocol_published` partial unique
  index, no new route, no migration). **Second real architectural improvement:** `evaluateCondition`
  (the pure condition-tree evaluator FEAT-029's workflow engine already used) moved from
  `apps/api/src/workflow/workflow-condition-evaluator.ts` into `@lis/domain`, re-exported unchanged
  for every existing `apps/api` caller — finishing a migration FEAT-047 had only done halfway (it
  moved the `ConditionNode` *type* to `@lis/domain` for the report designer's own client-side
  validation, but left the evaluator itself server-only). This means the new synoptic form's live
  conditional-visibility logic is the literal same function `apps/api`'s own recorder uses
  authoritatively, not a hand-copied duplicate that could drift — confirmed behavior-preserving by
  re-running `workflow-condition-evaluator.spec.ts` unmodified (12/12 still pass) against the
  re-exported function. All three §10 proposal questions (no double-submission guard; inline
  per-part entry-link placement; take-the-first-match on a theoretical multi-protocol collision)
  resolved by explicit human walkthrough, recommended defaults taken in every case. Regression
  suites re-run unmodified and clean: `synoptic-protocol.e2e-spec.ts` (8/8), `case-sign-out.e2e-spec.ts`
  (13/13, confirming `buildCaseReportContent()`'s own synoptic-response snapshot logic is genuinely
  untouched), `synoptic-response-recorder.spec.ts` (3/3). **Live-verified in a real browser against
  all three real seeded protocols through the same generic component** — Breast (25 elements),
  Colorectal (19+), Pap (smaller) all rendered correctly; both of Breast's own conditionally-hidden
  elements (`tumor_focus_count`, `her2_percent_membrane_staining`) were correctly absent by default;
  the exact §3.3 worked visibility trace was live-driven on Colorectal (selecting `neoadjuvant_therapy
  = given` correctly revealed `response_to_neoadjuvant_therapy`); a real 16-response Breast
  submission succeeded, rendered a confirmation view, and — verified directly against the database,
  not inferred from the UI — persisted exactly those 16 discrete `observation` rows with neither
  conditionally-hidden element present; an empty submission surfaced the backend's own validation
  message verbatim; a `qa`-role session's SSR HTML correctly omitted the entry link and a direct
  navigation attempt threw rather than rendering the form. **One real automation-methodology pitfall
  caught and corrected mid-pass, worth remembering for future `get_page_text`/`textContent`-based
  verification on this codebase:** `document.body.textContent` includes the content of Next.js's
  own inline RSC flight-data `<script>` tag (the same underlying mechanism `frontend-design` Skill
  entry #5 already documents for a different reason — PHI leaking across client-side navigations),
  so a naive `textContent.includes(someElementLabel)` check produces a false positive for an element
  that is genuinely absent from the rendered DOM; switched to `document.getElementById` checks
  against the real DOM, which is what actually caught this rather than trusting the first
  (incorrect) result. **Net effect worth remembering:** the entire cytology two-tier lifecycle
  (screen → return-to-screening → finalize → amend) plus synoptic protocol recording are all now
  browser-reachable — the last two items remaining on #610's own list are synoptic-protocol UI's own
  once-largest sibling gap, report/PDF/case-level document viewing (confirmed again this session:
  still no `GET` route of any kind exists for `case_report_version` content), and any EPIC-012
  follow-ups still gated on design-partner input. **New test data from this session's #642 work,
  left in place, not cleaned up:** one fresh tenant-A case under patient "SYNOPTICQA WebVerify"
  (accession number visible via its three parts, ids ending `...7511`/`...c370b`/`...2dfc1`) with
  three parts (breast/colorectal/cervical_cytology, no blocks/slides), the breast part carrying two
  full recorded synoptic response sets (one seeded via direct API call during investigation, one via
  a real browser submission during verification — both left in place since the recording route has
  no update/dedup mechanism, matching §10 Q1's own accepted risk).
- **Real, large finding, surfaced by the human just after #642 merged; a first pilot on it now
  shipped as issue #645 (see the dedicated bullet immediately below) — the *rest* of it remains
  not-yet-actioned:** `D:\LIS\research\cap documents` (a directory new this session, appearing
  between the #642 and #643 CI-wait cycles) holds 106 real, official CAP Cancer Protocol (CAPCP)
  `.docx` templates — the full CAP synoptic library, not a handful of samples, covering nearly
  every organ site (Adrenal through Vulva, plus several biomarker-specific protocols). Spot-checked
  directly (Vulva, Prostate): confirmed the same official CAP Core/Conditional/Optional format
  already used to seed the three protocols #642's own UI rendered at the time. One structural
  detail worth remembering: several of these real templates (e.g. Vulva's SPECIMEN → TUMOR →
  REGIONAL LYMPH NODE) use genuine section groupings, which would be the first real exercise of the
  `parentElementId` grouping mechanism #642's own generic renderer already supports but that no
  currently-seeded protocol data uses (still true after #645 — see below). Scaling to the remaining
  ~104 documents beyond the #645 pilot's own two is still not yet actioned (no issue filed, no plan
  drafted) — a real, separate future decision, not blocked on anything technical.
- **New this session: issue #645 filed, planned, implemented, and merged as PR #646
  (`Closes #645`).** Prostate/Lung synoptic protocol pilot — the eleventh AP slice this session,
  and the human's own explicit choice of pilot scope after seeing the CAP documents finding above:
  seed two more real, cited CAP protocols (Prostate radical prostatectomy, Lung resection) as a
  deliberately small proof of the docx-to-seed-data pipeline, rather than committing straight to
  all 106 documents. **Real schema gap found and fixed during scoping, not scope creep (explicitly
  decided by the human via a targeted walkthrough before any transcription work started):** both
  source documents use "select all that apply" (multi-select) fields as a recurring pattern, which
  the existing schema (built for Breast/Colorectal/Pap, none of which needed it) couldn't
  represent — every element accepted exactly one value. Added a new `coded_multi` data type:
  `synoptic_element`'s own CHECK constraint widened (migration `0053_synoptic_multi_select.sql`),
  the response schema accepts `string[]` alongside `string | number`, the recorder validates every
  selected value against `responseOptions` (all-or-nothing, matching `coded`'s own discipline) and
  persists via the *existing* `observation.dataType='structured'`/`valueJson` variant — no new
  `observation` column. The generic renderer (#642) gained a checkbox-group branch; still one
  generic component, no protocol-specific code. **Before committing to this schema shape, a broader
  7-document survey (Bladder, Kidney, Skin/Melanoma, Stomach, Testis, Thyroid, Uterus, plus a
  biomarker template) confirmed `coded_multi` is very likely the *only* extension a much larger
  slice of the 106-document CAP library would need** — no other novel input-format primitive (a
  date field, a file attachment, a second condition operator) turned up anywhere in that sample.
  Deeply-nested conditional sub-branches in both source documents (e.g. Prostate's
  per-Gleason-grade-group tertiary-pattern sub-questions) are flattened to top-level elements with
  an `in`/`eq` `visibilityCondition` on the relevant parent selection(s), per the proposal's own
  approved §5.5/Q1 decision — every real data element stays recordable, only the presentation
  grouping is flattened. **Real CI gap found and fixed in a follow-up commit, worth remembering for
  any future seed-file addition:** `.github/workflows/pr.yml` maintains its own hand-written,
  separate list of `psql -f db/seed/*.sql` steps — its own header comment already warns this list
  is "wired here separately from `scripts/db-reset.sh`, not assumed to share one seed sequence" —
  missed in the initial PR (only `db-reset.sh` was updated), causing a real CI failure (`Prostate`/
  `Lung` genuinely absent from CI's own seeded DB, both new coded_multi e2e tests failing to find
  them) rather than a flaky one; fixed by adding the same two `psql` steps to `pr.yml`, confirmed
  via grep that no third seed-invocation site exists anywhere else in the repo. **Live-verified**
  via the established minted-session-cookie + direct-API fallback (the Claude-in-Chrome extension
  was unresponsive for this entire pass — confirmed via repeated navigate/get_page_text failures
  across a fresh tab group; a future session should retry it fresh rather than assume it's
  permanently broken): both new protocol pages' SSR HTML showed exactly the expected element/
  checkbox counts by literal HTML-attribute matching (Prostate: 30 checkboxes across 4 multi-select
  elements + 14 selects + 1 text input, correctly excluding a 14-option conditional multi-select
  that stays hidden by default; Lung: 19 checkboxes + 14 selects + 3 number inputs + 1 text input);
  a real submission on Lung mixing a `coded_multi` field with ordinary single-select/text fields in
  the same request succeeded and persisted correctly; both new seed files applied cleanly against a
  real local Postgres (Prostate 28 elements/122 options, Lung 25 elements/155 options). **A second
  real library was surfaced by the human in the same conversation, looked at but not yet actioned,
  folded into the same future protocol-library-expansion backlog item as the CAP documents rather
  than treated separately:** `D:\LIS\research\ICCR\ICCR_Datasets_2026-08-20` — a fresh crawl of the
  official ICCR datasets site, 234 files resolving to 64 distinct real ICCR datasets across 11
  anatomical categories. Real, confirmed overlap worth remembering: ICCR is the same standard
  already used for the original Breast/Colorectal seeds (predating #642), and this library includes
  ICCR's own distinct "Prostate Cancers – Radical Prostatectomy Specimen" and "Lung Cancers"
  datasets — different documents from the CAP versions #645 just seeded, likely with some real
  divergence (the same class already documented between ICCR and CAP for colorectal pT staging).
  **Net effect worth remembering:** five real, cited synoptic protocols now exist (Breast,
  Colorectal, Cervical Cytology/Pap, Prostate, Lung), all rendering through one generic component;
  `coded_multi` is proven end-to-end, not just designed. Any further protocol seeding — from either
  library — is a separate, not-yet-decided future task, not committed to by this pilot.
- **New this session:** TASK-440 (specimen expiry + reflex recollection) merged as PR #605
  (`e58f243`), issue #440 closed — see session 40 section above. Nothing owed from this item.
  Volume/exhaustion tracking was deliberately cut from scope (§10 Q1) — a real, separate follow-up
  if a future session wants to pick it up, but no issue filed for it yet (the human's own call was
  to wait for real usage data first, not pre-file speculative scope).
- **New this session (40):** PR #602 (403 handling + error boundaries for cases/invoice detail
  pages) merged as `714890f`, live-verified in a real browser same session — see session 40
  section above. Nothing owed from this item; the "3 of 4 routes have no capability gate" finding
  was a deliberate human decision to leave as-is, not a pending task.
- **New in session 39:** WSL→Windows migration complete for `lis-platform` dev workflow (Docker,
  `pnpm dev`, build scripts, line endings); `lis-engineering` re-established as a real git repo;
  three Engineering Flow Retrospective findings from `/close` approved and applied (see above).
- **New in session 39, still pending human action:** the 5-item Manual Verification Checklist —
  see `/close` section above. No Final Close Report yet for cycle 2.
- No other feature/issue work happened in session 39 — every item below is unchanged from session 38.
- No new milestone/epic has been scoped yet for what comes after M13 — the roadmap's own Phase 5
  (AI & advanced: molecular/blood bank packs, digital pathology) is the one clearly-unstarted major
  direction; #546 (AI-assisted synoptic pre-fill, deferred from EPIC-012) is a real, already-filed
  entry point if that's the next pick.
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds screens) remains
  open, unstarted, unchanged.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issues #427 (backfill missing M1-M5 retrospectives), #267 (pnpm-workspace config ignored in CI)
  both remain open, untouched since filed.
- Deliberately-deferred M11/M12 follow-ups remain open, tracked, not blocking (#506, #507, #509,
  #510 under M11; #519, #520 under M12), same as prior sessions.
- Manual Verification Checklist items from session 35 remain open, unchanged: #529 (real
  antibiogram S/I/R rendering in `apps/web`), #530 (real culture-report PDF appearance).
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- The staging droplet's `restore-drill.sh` cron job still has no active alerting beyond its own log
  file — unchanged, still worth a periodic human spot-check until real alerting exists.
- Manual verification still owed by a human, carried forward unchanged: FEAT-047's JSON-mode
  `visibilityCondition` editor (mechanically verified, not yet a live lab-admin pass); FEAT-048's
  shipped French translations (not yet a native-speaker review); FEAT-049's `/signup` UX; FEAT-046's
  take-payment UX + confirming the placeholder billing metadata reads unambiguously as placeholder;
  FEAT-045's Constitution-gate marker-recognition logic; a live technologist pass on FEAT-024's
  notes-textarea/grade-button spacing; a live pass confirming FEAT-022's SLA amber/red badges read
  clearly at a glance.
- FEAT-065/066/067 and issues #564/#531's own human-facing manual-verification items (session
  37/38 breadcrumb) remain owed, unchanged — not repeated in full here; see session 38's own
  breadcrumb (`git log -- docs/scope/current.md`) for the complete list.
