# Status — 2026-08-18 (session 39, refreshed twice)

Last commit on main: `68e234d` (`lis-engineering`) — `lis-platform`'s own last commit before this
breadcrumb refresh itself lands is `5d7e043`; this refresh will land as a further `lis-platform`
commit on top of that, so that line will already be one commit behind by construction — check
`git log origin/main -5` for the real current tip.

**Second refresh this session (first refresh, PR #596, went stale again within the hour — PR #597
landed right after it and was unrecorded until now; see `/close`'s own
`2026-08-18-1326-pre.md`).** The three sections below (WSL→Windows migration, `/close`, Carried
into next session) are the same session's work as the first refresh, updated to also cover what
landed afterward — not a new session.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## WSL → native Windows dev-environment migration — this session's entire scope

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

- **New this session:** WSL→Windows migration complete for `lis-platform` dev workflow (Docker,
  `pnpm dev`, build scripts, line endings); `lis-engineering` re-established as a real git repo;
  three Engineering Flow Retrospective findings from `/close` approved and applied (see above).
- **New this session, still pending human action:** the 5-item Manual Verification Checklist —
  see `/close` section above. No Final Close Report yet for cycle 2.
- No feature/issue work happened this session — every item below is unchanged from session 38.
- No new milestone/epic has been scoped yet for what comes after M13 — the roadmap's own Phase 5
  (AI & advanced: molecular/blood bank packs, digital pathology) is the one clearly-unstarted major
  direction; #546 (AI-assisted synoptic pre-fill, deferred from EPIC-012) is a real, already-filed
  entry point if that's the next pick.
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds screens) remains
  open, unstarted, unchanged.
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted, unchanged.
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
