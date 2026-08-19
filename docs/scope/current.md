# Status — 2026-08-19 (session 40, continued)

Last commit on main: `6a33fde` (`lis-platform`) — `lis-engineering`'s tip is `9dc9908` (unchanged
this leg). Check `git log origin/main -5` for the real current tip if this has drifted.

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
