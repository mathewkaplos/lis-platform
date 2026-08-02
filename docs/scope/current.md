# Status — 2026-08-02 (session 10)

Last commit on main: 6407ead — "fix: correct redirect_uri sent at token exchange, not just at authorization (#254)".

## What's actually done (per real evidence)

This session closed out both of M2's remaining features by actually completing a real staging
login/logout round trip and a real capability-check/audit round trip — not by re-reading old
evidence. Getting there surfaced and fixed four separate, real infrastructure bugs, none of which
were visible from CI's own green checks.

**#18 (FEAT-009: Authorization & audit) closed.** Live-verified against the real staging API:
verifier role attempting `:verify` → `HTTP 201` with `actorRole: "verifier"`; technologist-only
role attempting the same → `HTTP 403`, `"No role grants the 'verify' capability"`; the audit hash
chain re-derived and confirmed `{"valid":true}` after being exercised through this real traffic.
Getting a valid token at all required discovering that Keycloak's declarative User Profile
silently drops the `tenant_id` custom attribute on any live write unless
`unmanagedAttributePolicy: "ENABLED"` is set on the realm (this realm's built-in `test-user*`
accounts only work because they were loaded via bulk import, which bypasses that validation).
Constitution-invariant review for #18 done by direct human review of `capability.guard.ts`/
`audit.interceptor.ts` against all five invariants.

**#19 (FEAT-010: Design system v1) closed.** App shell (sidebar, top bar, theme toggle, dark
mode) live-verified on `https://lis-staging.taila0fbf9.ts.net/`. The six primitives themselves
have no real page to appear on yet at this milestone (`sidebar.tsx`'s own comment: "One real
destination exists today ('/'). Nav grows as later features add routes — not invented ahead of
them") — already verified where they're actually reachable, Storybook, per #232's prior
human confirmation. Constitution review: `packages/ui` is pure presentation, none of the five
invariants apply by scope.

**Getting a real staging login working at all took four independent fixes, three shipped as
merged PRs, one as an accepted ADR:**
1. **ADR-0012** (`lis-engineering`, accepted) — the tailnet's own ACL never granted human
   members access to staging's web/Keycloak ports, only `tag:ci-runner`. A human's own device
   couldn't even resolve the hostname; Tailscale hides a peer a device has zero ACL permission
   to reach. Fixed by adding a scoped `autogroup:member -> tag:lis-staging:443,8443` rule.
2. **PR #252** — `lis-web`'s `redirectUris` only ever listed `localhost:3000`; staging logins
   failed Keycloak's `redirect_uri` validation outright.
3. **PR #253** — two bugs found live, both fixed together: (a) self-hosted Next.js's standalone
   output can't trust the incoming `Host` header in this exact version (`trustHostHeader` looked
   valid from Next's own source but is confirmed non-functional here — checked the real built
   manifest, not the warning), so `request.nextUrl.origin` resolved to the container's own
   Docker-assigned hostname; fixed with a `PUBLIC_APP_URL` env var + `getPublicOrigin()` helper.
   (b) Keycloak has no persisted volume on staging, so a redeploy that doesn't force-recreate its
   container silently never re-imports `lis-realm.json` — PR #252's own `redirectUris` fix sat
   correctly in the file through a fully green deploy and still didn't work until this was fixed
   (`docker compose rm -f -s keycloak` before every redeploy now).
4. **PR #254** — the same Host-header gap broke a *second*, independent code path: `openid-client`'s
   `authorizationCodeGrant()` derives its own `redirect_uri` for the token-exchange request from
   the request's own URL, separate from the authorization request PR #253 already fixed. Fixed
   with a `customFetch` override correcting `redirect_uri` in the token-endpoint POST body,
   per `openid-client`'s own documented pattern for exactly this situation.

All four gaps, plus the honest diagnostic trail that found each one, are now written into the
`authentication` Skill (`lis-engineering`, entries #7-#10) — not just fixed in code, so the next
session doesn't rediscover them from scratch.

**`scripts/feat009-staging-verify.sh` was replaced with `scripts/feat009-staging-verify.md`**
(PR #251) — the `.sh` had gone stale relative to what actually worked (missing required user
profile fields, missing the `unmanagedAttributePolicy` step, `curl -d` instead of
`--data-urlencode`). The `.md` is the fully proven runbook, every command in it actually run for
real either locally (`docker compose down -v && up -d && pnpm db:reset`) or against staging
directly.

**One AGENTS.md addition** — after a `git branch <name> <sha> && git reset --hard origin/main`
was denied atomically by the PreToolUse guard, the next turn briefly proceeded as if the `git
branch` half had already run (it hadn't; caught when a later `git push` failed with "unknown
revision," recovered via `git reflog`, no data lost). New standing rule: after any PreToolUse
denial — a chained command or a sequence of separate tool calls — verify with a read-only check
whether any earlier step actually completed, don't assume partial execution either direction.

**Session-close Pre-Close Report** written and pushed to `lis-engineering`
(`session-close-reports/2026-08-02-1040-pre.md`) — one Engineering Flow Retrospective finding
(the PreToolUse item above, approved and applied to AGENTS.md), one flagged-but-unresolved manual
check (ADR-0012's "port 22 still SSH-restricted" claim was reasoned to hold by construction, never
independently tested — still open as of this writing).

## M2 exit criteria — status

M2's own exit criteria (`/mnt/d/LIS/research/LIS-Execution-Plan.md:97-99`): *"a bench user logs
in, sees only their tenant's data (proven by test), cannot verify a result, and every write is
audited; Storybook renders all six primitives in light and dark."*

**All five clauses met, each with real evidence:**
| Clause | Evidence |
|---|---|
| Bench user logs in | This session's real staging login/logout round trip |
| Sees only their tenant's data, proven by test | TASK-030's e2e cross-tenant isolation test (interleaved two-tenant requests), CI green |
| Cannot verify a result | #18: technologist-only role → `403` on `:verify`, live on staging |
| Every write is audited | #18: `audit-chain-valid` → `{"valid":true}` after real writes, live on staging |
| Storybook renders all six primitives, light and dark | #232 (prior session): human-confirmed at `localhost:6006` |

**M2's own exit criteria are fully satisfied.** This does not by itself close EPIC-002 — see below.

## EPIC-002 (#2) — current state: open, pending a design-partner demo

Checked directly against #2's own acceptance criteria, not inferred from M2's exit criteria being
met or from all three child features (#17/#18/#19) now being closed — same discipline this
project's standing rule already required, applied here to the parent epic itself:

- "All features listed above are merged and individually demoed" — **met** (#17/#18/#19 all closed).
- "No violation of the five Constitution invariants was introduced" — **met** (each feature's own
  review found nothing; ADRs 0009/0010/0011 already accepted).
- "Relevant ADRs are ratified and the knowledge base updated where authorized" — **met**
  (ADR-0009/0010/0011/0012 all accepted; `authentication` and `frontend-design` Skills both
  updated with real findings from this epic's work).
- **"The milestone(s) this epic spans have been demoed to the design-partner lab" — NOT met. No
  design partner is engaged at this project's current stage.** This is a business/scheduling
  decision, not an engineering task — nothing in a future session should attempt to "fix" this by
  writing code. #2 stays open until that demo actually happens, by explicit human decision
  (2026-08-02): leave it open for now.

**Do not close #2 on any future session's own initiative without this specific criterion being
addressed** — every other box is checked; this is the one and only remaining blocker.

## Currently active milestone

**M2 — Identity, Tenancy, AuthZ + Design System**: 14 closed / 1 open (was 12/3 at session start;
#18 and #19 closing this session moved the count). The one remaining open item is #2 (EPIC-002)
itself, per above — not blocked on any further engineering work.

**Unrelated open issues, not M2-milestoned (carried forward, still genuinely unresolved):**
- **#192** — GCP billing/Stitch MCP decision. Still open, still not resolved.
- **#193, #194** — still open, still genuinely unreproduced (last checked 2026-08-01; unchanged
  across multiple sessions now, from session 4).
- **#240** — sidebar nav fully hidden below `sm` breakpoint, no replacement trigger. Still needs a
  triage decision (fast-follow vs. a later dedicated mobile pass), not decided yet.
- Design-system work beyond FEAT-010 v1 (further primitives, app-shell polish, real org/branch
  switcher once that data model exists) not yet scoped as a next feature.
- **New, this session:** ADR-0012's own acceptance criterion that port 22 remains SSH-restricted
  to `tag:ci-runner` was never independently re-tested after the ACL widening — reasoned to hold
  by construction (the new rule is scoped to `:443,8443` only) but not confirmed. A quick manual
  SSH attempt from a human device would close this loop for real.
- **New, this session:** `unmanagedAttributePolicy: "ENABLED"` (needed for any custom Keycloak
  user attribute to survive a live write) is currently a live-only setting on staging's realm, not
  committed to `lis-realm.json` — it will be silently wiped by the next Keycloak container
  recreate and need reapplying. Worth promoting into a `userProfile` block in the realm file
  before the next time this bites someone.

**Unresolved findings, carried forward unchanged from earlier sessions:**
- #74 (TASK-015)'s out-of-band closure remains unverified.
- #145 (ADR-based RLS-exemption mechanism for the Constitution gate) — still open, not touched.
- #171 (TASK-027 follow-up: design-partner lab sign-off of chemistry golden dataset) — still
  open, needs-clinical-review, not touched.

## Notes / gotchas for the next session

- **"Staging is reachable" and "a human can log in" are not the same claim.** #188 made Keycloak
  itself correctly configured and reachable over real HTTPS; that alone still left four separate,
  independent gaps (Tailscale ACL, Keycloak's no-persisted-volume redeploy trap, the Next.js
  Host-header gap in two distinct code paths, the User Profile attribute gap) that only surfaced
  from actually driving the interactive OIDC flow end-to-end, not from any CI-level HTTP smoke
  check. Full detail and diagnostics now in `authentication` Skill entries #7-#10 — read those
  before touching Keycloak/staging-auth again, don't rediscover this from scratch.
- **A realm-file change can deploy successfully and still never take effect.** Keycloak has no
  persisted volume on staging; a redeploy that doesn't explicitly force-recreate its container
  leaves `--import-realm` silently skipping the re-import. If a `lis-realm.json` change
  demonstrably deployed but Keycloak's live behavior doesn't match it, suspect a stale container
  (`docker compose ps` showing an old uptime for `keycloak` specifically) before anything else.
  (Should no longer recur — `deploy-staging.yml` now force-recreates Keycloak every deploy — but
  worth knowing why, if it ever does.)
- **A PreToolUse denial doesn't tell you which earlier steps already ran.** New AGENTS.md standing
  rule this session, from a real near-miss (see above) — verify with a read-only check before
  assuming a prior chained command or tool call succeeded (or didn't).
- **A cleared blocker for one child doesn't prove a parent epic's own DoD is met** — generalized
  again this session, this time to EPIC-002 itself: even with M2's exit criteria fully satisfied
  and all three child features closed, #2's own acceptance criteria had one further, unrelated
  condition (design-partner demo) that nothing about the children being done resolves. Checked
  #2's actual body text directly rather than assuming; same discipline as session 9's own
  EPIC-002 correction, applied one level further this time.
- Earlier sessions' notes/gotchas (checking child tasks/comment threads not just headline
  Project-status fields; `gh issue`/`gh pr` write denials falling back to `mcp__github__*`;
  closing convention is a comment, not a body edit) are unchanged and still apply — not repeated
  here, see git history for earlier breadcrumbs if needed.
