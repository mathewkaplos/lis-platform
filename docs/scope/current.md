# Status — 2026-08-11 (session 34)

Last commit on main: `e339f7f` (`lis-platform`) / `75afe45` (`lis-engineering`) — this breadcrumb
refresh itself lands as a further `lis-platform` commit on top of that, so this line will already
be one commit behind by construction — check `git log origin/main -5` for the real current tip.

**Earlier sessions' breadcrumb entries are not carried in this file — see git history on this
exact file (`git log -- docs/scope/current.md`) for full detail back through session 12.**

## M10 (EPIC-009, Commercial Readiness) completed this session — all 6 features shipped

Session 33 left M10 3/6 complete (FEAT-045/049/046) with FEAT-047 planned-and-approved but not
built. This session picked up cold via `/develop`, shipped FEAT-047, then planned and shipped
FEAT-048 and FEAT-050 — **M10 is now 6/6 features complete.** Only issue #9 (EPIC-009 itself,
closes when the milestone is formally closed) and #489 (FEAT-046's own deferred follow-up screens)
remain open in the milestone, both by design.

### FEAT-047 (Visual report designer v1) — merged PR #493, issue #56 closed, ADR-0042 (already accepted session 33)

Picked up cold from session 33's approved-but-unbuilt proposal, no re-planning needed. Sections/
fields canvas over FEAT-032's existing API: all 5 field types, a scoped analyte-binding picker
(never lists an analyte outside the target test's own set), a JSON-mode `visibilityCondition`
editor validated client-side against the same schema the server enforces, a client-side mock
preview, keyboard-only up/down reordering (no drag-and-drop library, ADR-0042's own scope).
`packages/domain/src/report-template.ts` + `conditions.ts` (new): schemas moved out of `apps/api`
so the designer's client-side validation reuses the exact server schema — `ConditionNode`/
`conditionNodeSchema` hoisted out of the workflow engine alongside it (the evaluator itself stays
server-only). **Real bug found and fixed during manual browser verification:** the visibility-
condition textarea used an uncontrolled `defaultValue` keyed only by field position — reordering
fields via the up/down buttons correctly swapped the underlying data, but the textarea's on-screen
text could go stale (still showing the previous occupant's condition), since React reuses the DOM
node at that index. Fixed by including the field's own committed condition in the element's `key`,
forcing a fresh mount whenever the occupant at that position actually changes.

### FEAT-048 (Internationalization) — merged PR #494, issue #57 closed, ADR-0043 (drafted + accepted this session)

KB-51/§20.15 describe a much larger system (full-app translation, a locale-settings admin page
with timezone/currency/RTL, SI-vs-conventional clinical unit conversion) than the literal AC needs
("renders in at least one additional language with proper date/number/unit locale formatting").
ADR-0043 scopes v1 to real, working `next-intl` infrastructure — cookie-based locale, **no URL
prefix** (mirrors `lib/theme.ts`'s own dark-mode-cookie precedent exactly, avoiding any change to
`proxy.ts`'s matcher) — proven on the `(app)` shell chrome plus two representative screens chosen
specifically to prove both AC halves on real data: Dashboard (number formatting, its `StatCard`
counts) and Orders list (date formatting, its pre-existing `toLocaleString()` call replaced with
`useFormatter().dateTime()`). French shipped as the second language. `report-render.ts` (PDF
generation) deliberately untouched — stays pinned to `'en-US'`/`'UTC'` for TASK-058's own
byte-identical-PDF determinism. Context7 was fully unreachable during planning (a real transport-
level outage, confirmed via 3 retries) — worked around live via `WebFetch` against `next-intl.dev`
directly; a fallback note for this is now in the user's own global `context7.md` rule.

### FEAT-050 (DR, backup rehearsal & scale hardening) — merged PR #495 (+ #496/#497/#498 follow-ups), issue #59 closed, ADR-0044 (drafted + accepted this session)

**Central finding, from an actual SSH session to the real live staging droplet before designing
anything:** a daily backup already ran successfully (8+ consecutive real `.dump` files), but its
restore path had never once been exercised — and there was **no way to roll back a deploy at all**
(every image pushed to a single mutable `:latest` tag, pruned locally on every deploy; no
addressable prior version existed anywhere). ADR-0044 scopes v1 to exactly the two pieces the
literal AC needs, against the real single-droplet environment — not KB-49's PITR/multi-region/
automated-failover vision. `infra/scripts/restore-drill.sh` (new): restores the latest backup into
a disposable scratch Postgres project, never the live database, torn down after its check
regardless of outcome; cron installed (03:30 UTC). `deploy-staging.yml`: api/web images now also
tagged `:<git-sha>`, alongside `:latest`. `rollback-staging.yml` (new): `workflow_dispatch`-only,
pulls a specific SHA-tagged image and restarts only api/web — deliberately never touches the
database or Keycloak realm.

**Both ACs proven live, not just implemented** — the human explicitly approved performing the
rehearsal for real against staging:
- Restore drill: failed twice on its first real run (two genuine bugs — the sanity-check table set
  assumed `tenant`/`patient` would be nonzero, but this pre-launch staging environment genuinely
  has zero of both; and the scratch container was missing the `lis_app`/`lis_scheduler` roles those
  tables' RLS policies reference, since roles are cluster-level and never captured by a
  per-database `pg_dump`) — fixed both, passed clean on the third run, live DB confirmed untouched.
- Rollback: triggered for real via `workflow_dispatch`, completed in **~60 seconds** (well under
  the 5-minute AC), verified via changed `docker inspect` image content-hashes on the droplet — not
  a same-version no-op.
- **A third real bug found along the way:** `rollback-staging.yml` itself silently registered with
  0 runnable jobs because a doc comment literally quoted the empty GitHub Actions expression
  `` ${{ }} `` as documentation text — GitHub Actions scans an entire `run:` block for that pattern
  regardless of bash `#` comments. Found only by actually trying to trigger the workflow; fixed and
  confirmed with `actionlint` (PR #497), now `engineering/docker-pnpm-monorepo-deploy` entry #28.

### `/close` cycle

Per `~/work/lis-engineering/session-close-reports/2026-08-11-1416-pre.md`'s five pending items, all
addressed this round:
1. **Breadcrumb refresh** — this file.
2. **Retro entry #28 landed** — `engineering/docker-pnpm-monorepo-deploy`, the `${{ }}`-in-a-comment
   workflow bug (see FEAT-050 above).
3. **Context7-outage fallback note** — added to the user's own global `~/.claude/rules/context7.md`
   (outside both repos, not committed here).
4. **Issues #145 and #292 actually closed** — both were fully resolved weeks/sessions ago but never
   auto-closed (`#145`: a prior PR used invalid cross-repo close syntax, `Closes
   lis-engineering#145`; `#292`: simply never revisited after its own fix shipped). Closed with an
   explanatory comment on each, not silently.
5. **FEAT-047/FEAT-048 manual-verification items** — carried forward below, genuinely need a human
   (a live lab-admin pass on the JSON-mode condition editor; a native-French-speaker review of the
   shipped translations).

## Carried into next session

- **M10 (EPIC-009) is fully complete, 6/6 features.** The milestone itself can likely be formally
  closed on GitHub (issue #9) — worth a real check next session that nothing else is expected of
  it first, not assumed.
- Issue #489 (FEAT-046's own deferred Invoice List/Outstanding Balances/Refunds) remains open,
  unstarted, unchanged — the next real work if M10-adjacent scope continues.
- Issues #145 and #292 are now **closed** — remove from any future "still open" carry-forward list.
- Issue #430 (rls-isolation-check.ts fixture-coverage gap) — unchanged this session; no new
  tenant-scoped tables were added by FEAT-047/048/050 (report-template's own tables predate this
  session; FEAT-050 is infra-only).
- M6's own remaining item (FEAT-027) is still blocked on the design partner naming their actual
  instrument, unchanged.
- Issue #440 (specimen exhaustion/expiry tracking) remains open, unstarted, unchanged.
- Issue #427 (backfill missing M1-M5 retrospectives), #267 (pnpm-workspace config ignored in CI)
  both remain open, untouched since filed.
- The real Tailscale/OpenTofu edge-node provisioning for `apps/gateway` still needs a human's
  `tofu apply`.
- **New this session:** the staging droplet's `restore-drill.sh` cron job (03:30 UTC daily) has no
  active alerting on failure beyond its own log file (`/var/log/lis-restore-drill.log`) — worth a
  human spot-check periodically (e.g. weekly) until real alerting exists.
- Manual verification still owed by a human: FEAT-047's JSON-mode `visibilityCondition` editor —
  mechanically verified, but whether it's actually usable by a real lab admin (not just
  functional) needs a live pass; FEAT-048's shipped French translations (`messages/fr.json`) were
  written by the agent, not reviewed by a native speaker or the design partner — lab/order
  terminology choices deserve a real fluent-speaker pass before reaching actual users. Carried from
  prior sessions, still not done: FEAT-049's `/signup` UX + confirming `lis-onboarding`'s dev
  secret gets rotated before any real deploy; FEAT-046's take-payment UX + confirming the
  placeholder billing metadata reads unambiguously as placeholder; FEAT-045's Constitution-gate
  marker-recognition logic, worth a human read beyond its own automated deliberate-break test; a
  live technologist pass on FEAT-024's notes-textarea/grade-button spacing; a live pass confirming
  FEAT-022's SLA amber/red badges read clearly at a glance.
