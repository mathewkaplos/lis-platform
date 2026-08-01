# Status — 2026-08-01 (session 7, corrected during session 8 orientation)

## What's actually done (per real evidence)

Session 6 approved FEAT-010's proposal (§10 Q1/Q2/Q3 resolved) and implemented TASK-034
(tokens). This session finished the rest of FEAT-010's design-system tasks, ran a full audit on
#138, and closed out #188 — a real, hard 11-attempt infra saga, not a quick fix.

- **TASK-035 (6 primitives) — implemented and merged as PR #216.** DataTable, StatusPill,
  FilterBar, SlideOver, StatCard, FormField, built on 9 shadcn/ui base components. First real
  packages/ui component work in this repo.
- **TASK-037 — completed and closed this session** (PR #217, Storybook + axe a11y CI check).
  Once wired up for real, it caught a genuine WCAG AA contrast failure in StatCard's delta
  indicator on its very first real run — fixed in the same PR before merge, not a hypothetical
  the check never actually exercised.
- **CORRECTION (found during 2026-08-01 session 8 orientation): TASK-036 was NOT actually
  completed this session, despite what this breadcrumb previously claimed.** Issue #95 is still
  OPEN on GitHub, untouched since creation (2026-07-26) — no commit or PR anywhere implements an
  app shell in `apps/web`. The original claim below ("TASK-036 and TASK-037 — completed and
  closed this session... FEAT-010... fully closed out... all four tasks done") was wrong for
  TASK-036 specifically. Root cause not established (likely a session-7 reporting error, not a
  reverted merge — no trace of the work ever existing). **FEAT-010 is therefore NOT fully closed
  out** — TASK-036 remains to be implemented, under the already-APPROVED
  `docs/plans/feat-010-design-system-v1.md` proposal (no new proposal needed).
- **#138 (audit all GitHub Actions secrets for placeholder values) — closed.** Systematic audit
  this issue always asked for, never actually done until now. All 8 secrets referenced across
  workflows are set and independently confirmed functionally live (not just present) — most via
  a real Deploy to Staging success, `SENTRY_DSN` specifically via the Sentry API directly (a
  bad DSN fails silently, deploy success alone wouldn't have caught it). No new placeholder/
  missing secrets found — the two real gaps from session 5 (`KEYCLOAK_ADMIN_PASSWORD`,
  `LIS_APP_DB_PASSWORD`) were already fixed by then.
- **#188 (staging TLS + KC_HOSTNAME hardening) — closed. The largest single piece of work this
  session, and the one worth reading the source-of-record for, not this summary.** Staging's
  Keycloak moved off `start-dev` (no TLS, no real hostname) onto production `start` mode, fronted
  by `tailscale serve` — Tailscale-only per ADR-0003's existing precedent, no public domain, no
  new reverse-proxy container (tailscaled already ran on the droplet for deploy access). Took 11
  real live deploy attempts and 9 total fixes (7 code PRs, 1 human Tailscale-ACL action, 1 config
  revert) to get to a genuinely green run — each failure was a distinct real bug, found via
  direct evidence (`docker compose logs`/`ps` on the droplet, not guessed twice in a row).
  **Full detail lives in `docker-pnpm-monorepo-deploy` Skill entries 15–22 (lis-engineering) and
  `docs/plans/task-188-staging-tls-hostname-hardening.md`'s own §11 — read there, not narrated
  again here.** Headline lesson for next time this pipeline gets touched: a `tailscale serve`/
  Keycloak-production-mode change needs real droplet-log verification at multiple points, CI logs
  alone were not enough on their own for at least 4 of the 10 failures.
- **Two Skill files updated to match reality:** `docker-pnpm-monorepo-deploy` (entries 15–22, the
  #188 saga) and `authentication` (its own long-standing "still not addressed" TLS/hostname note,
  now correctly says fixed).

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 9 closed / 6 open as of session 8 orientation
(session 7's "10 closed / 5 open" count wrongly included #95/TASK-036 as closed — see correction
above; #93/#94/#96 and #188 genuinely closed that session, #95 was not). M1 unchanged at 3
open/16 closed, all three still individually blocked (see earlier session detail via git history
if needed — not repeated here).

M2's remaining open items:
- **#95 (TASK-036)** — App shell: sidebar, top bar, org/branch switcher, theme, palette. Not
  started. Dependencies (TASK-034 tokens, TASK-035 primitives) both genuinely merged; proposal
  already APPROVED. Session 8's active task.
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved. TASK-034's own §10
  Q1 (option c) only unblocked that one task's bootstrapping — it explicitly does not resolve
  #192 itself. Do not conflate the two.
- **#193, #194** — still open, still genuinely unresolved, unchanged across multiple sessions now
  (unreproduced exit-56/exit-52 deploy smoke-test failures from session 4). Do not assume closed
  or explained by anything in this session's #188 work, even though it touched the same deploy
  pipeline — different failure signatures, never reproduced since.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish) not yet scoped as
  a next feature — not started, not blocked on anything specific either.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- #74 (TASK-015)'s out-of-band closure remains unverified.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.
- `.mcp.json` (lis-platform, repo root) — resolved in session 6 (committed, no secrets found,
  PR #214). No longer an open item; noted here only so this line can be deleted next refresh.

## Notes / gotchas for the next session

- **This session's biggest lesson, stated once here and left in full in the Skill:** when
  iterating live against a real droplet and CI logs stop being informative (e.g. `curl -sf`
  silencing the actual error, or a smoke test's pass/fail not distinguishing "crash-looping"
  from "just slow"), stop guessing from the CI log alone and get the human to check
  `docker compose logs`/`ps` directly. At least 4 of #188's 10 real failures were only
  correctly diagnosed that way — CI evidence alone would have kept producing plausible-sounding
  but wrong fixes.
- **A tailnet ACL scoped for one purpose (SSH-only CI deploy access, per ADR-0003) does not
  implicitly extend to new services added later on the same nodes** — Tailscale enforces ACLs
  per destination port, independent of what's actually listening. Check the ACL's port scope
  first if a new tailnet-facing service times out with zero response despite SSH working fine
  between the same two nodes.
- **A Keycloak config option's valid values can differ between the pinned image version and
  whatever documentation you just fetched** — verify against the running container's own error
  text (`docker compose logs`), not docs that may describe a newer/older version than what's
  actually pinned in `docker-compose.staging.yml`.
- **Cleanup/prune steps must run with `if: always()`, not just on success** — a string of failed
  attempts while iterating on anything accumulates exactly the cruft the step exists to prevent.
  Already fixed for the Docker-image-prune step this session; worth checking if any other
  "only runs on success" step in this pipeline has the same latent gap.
- Full session-close report for this session: see the close Skill's own `-pre.md`/`-final.md`
  files in `~/work/lis-engineering/session-close-reports/` for what was actually pending at
  session end, rather than assuming this breadcrumb alone is a complete account.
