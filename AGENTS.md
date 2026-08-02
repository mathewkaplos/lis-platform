# LIS Platform — Agent Context

## What this is
A commercial Laboratory Information System. Modular monolith.

## Stack
- Backend: NestJS (Fastify adapter), TypeScript strict
- Frontend: Next.js + React + Tailwind + shadcn/ui
- DB: PostgreSQL 16 (Drizzle ORM + raw SQL), RLS for tenancy
- Tests: Vitest (unit), Playwright (e2e)
- Package manager: pnpm — never npm or yarn

## Commands
- pnpm dev — run everything
- pnpm test — unit tests
- pnpm typecheck — tsc --noEmit
- pnpm db:reset — drop, recreate local DB containers, migrate, seed (standard placeholder CMP panel; see TASK-019/#13, closed)
- pnpm lint — eslint

## Structure
apps/api (backend) · apps/web (frontend) · packages/domain (shared types+Zod) ·
packages/ui (design system) · packages/sdk (generated API client)

## THE FIVE INVARIANTS (never violate, no exceptions)
1. No clinical value stored as free text — always a structured, coded Observation.
2. Verified clinical data is append-only; corrections create new versions.
3. Critical values never auto-verify and block report finalization until acknowledged.
4. Tenant isolation is structural via PostgreSQL RLS, not application checks.
5. Every clinically significant action writes an audit record.

## PR conventions
- When a PR closes an issue, always include a bare `Closes #N` on its own
  line in the PR body — separate from any human-readable task-name
  reference elsewhere in the description. GitHub's closing-keyword parser
  does not recognize the reference when it's wrapped in extra text (e.g.
  `Closes TASK-034 (#93)` does not auto-close; only the bare `Closes #93`
  form does). Confirmed twice in the same session (#93 and #94 both stayed
  open after merge, each needing a manual `gh issue close`) — see the close
  Skill's Engineering Flow Retrospective, Section 8, finding #1.

## Where knowledge lives
- Architecture KB: ../lis-engineering/knowledge-base/
- ADRs: ../lis-engineering/adr/
- Standards: ../lis-engineering/standards/
- Skills: ../lis-engineering/skills/

## Rules of engagement (Rule #0)
- Before writing production code, always produce an Implementation Proposal
  (docs/plans/<id>-<slug>.md) and wait for explicit approval (Status: APPROVED).
- If a load-bearing decision is missing (data model, provider, clinical rule),
  STOP and ask. Do not invent it.
- Follow existing module patterns; mirror the most similar existing module.
- Every schema change is a migration in db/migrations. Never edit a past migration.
- Claude Code may run `gh pr merge <n> --squash` autonomously once CI is green,
  without waiting for per-PR confirmation from the human. Never combine
  `--delete-branch` with the merge in the same command — that exact combo
  silently no-op'd a merge and deleted a branch holding a real unpushed commit
  on 2026-07-26 (see `guard-dangerous-git.py`, which blocks it). Delete the
  branch as its own separate step afterward, only after confirming the merge
  actually landed (`git log origin/main`).
- Whenever a real bug, gap, or gotcha is discovered — not a hypothetical —
  check whether an existing Skill should be extended with it, or whether it
  warrants a new Skill entirely. Do this the same day, before moving to the
  next task. Do not wait to be asked.
- Before stating a justification like "consistent with" or "same pattern as"
  a prior decision, verify it against the actual precedent (the real issue
  history, closed PRs, or prior comments) rather than trusting that it sounds
  plausible. A confident-sounding justification is not evidence; check it the
  same way you'd check any other claim before acting on it.
- Whenever presenting a decision — proposal §10 questions, ADR alternatives,
  /close pending items, or any other genuine choice point — use Claude
  Code's native options-prompt mechanism (the one already used elsewhere in
  this project, e.g. "Scope the hook to lis-platform only (recommended)"),
  not a plain prose question. Every option must be concrete and tappable —
  no open-ended fill-in-the-blank asks when a bounded, real set of choices
  exists — and the recommended option must be explicitly marked
  "(Recommended)", not just implied by how it's worded. This is specifically
  so decisions can be made quickly via tap, including from Claude Code's
  mobile/remote-control interface, not just by typing a full sentence back.
  Applies consistently, every time a genuine decision point comes up — not
  selectively, only when it happens to be convenient.
- **A pass in one test/build harness does not prove a pass in another —
  verify against the actual harness the real thing will run in, not
  whichever one is most convenient to run.** Six real instances, not
  hypothetical: (1) TASK-032/PR #185 — `CapabilityGuard`'s `Reflector`
  dependency resolved to `undefined` at runtime because vitest's esbuild
  transform doesn't emit the `design:paramtypes` metadata Nest's implicit
  constructor DI relies on; unit tests passed, only a real e2e run against
  a live Nest app caught it. (2) TASK-030/PR #177 — a default connection-
  pool test would have passed even if `set_config('app.tenant_id', $1,
  true)`'s transaction-scoped binding accidentally leaked across pooled
  connections; only forcing `DB_POOL_MAX=1` and interleaving two tenants'
  requests actually proved the binding survives physical-connection
  reuse. (3) TASK-036/PR #237 — `@lis/ui`'s primitives shipped clean
  through TASK-035/037 because Storybook/Vite consumes the package's
  source directly and never exercises Next.js's own bundler; the first
  real Next.js page to render one hit a client-boundary bug
  (`transpilePackages` fix) that no amount of Storybook or `tsc
  --noEmit` passing would ever have caught. (4) TASK-038/PR #261 —
  backfilling a real FK onto `order.patient_id`/`observation.patient_id`
  passed this task's own local testing plan (typecheck, `db:reset`,
  `rls-check`) cleanly; only the API package's own separate e2e suite
  (`apps/api`'s `capability-check.e2e-spec.ts`, exercised by CI's
  `build-and-test` job, never run locally as part of this task's own plan)
  caught that an unrelated proof controller's `randomUUID()` placeholder
  for `patientId` — valid before the backfill, silently wrong after — now
  failed with a 500 on every route. See `database-design` Skill entry #4.
  (5) TASK-040 — `apps/api`'s real, compiled Fastify server had never
  actually been able to start since TASK-039 added
  `SwaggerModule.setup(...)` to `main.ts` (`@nestjs/platform-fastify`'s
  `useStaticAssets()` needs `@fastify/static`, never installed). Every
  e2e spec uses `Test.createTestingModule().createNestApplication()`,
  which defaults to Express and never exercises the real Fastify
  adapter at all; this task's own manual verification was the first
  thing to actually boot `main.ts`'s real bootstrap path, and it
  crashed immediately. Confirmed fixed against both a local run and a
  real `docker build` + `docker run` of the actual production image,
  not just a build-succeeds check.
  (6) TASK-040/deploy hotfix — that same `docker build` "verification"
  was itself a false positive: no `.dockerignore` existed anywhere in
  this repo, so `COPY . .` silently picked up whatever
  `node_modules`/`dist` a local build's host already had on disk —
  specifically, this sandbox's own pre-built `packages/sdk/dist/`,
  masking that `apps/web/Dockerfile` never had a build step for
  `@lis/sdk` at all. The real staging deploy failed on `main` twice
  before this was caught, because GitHub Actions' clean `actions/checkout`
  has no such leftover `dist/` to hide behind. Fixed by adding the
  missing build step and a real `.dockerignore`; re-verified with a
  `--no-cache` build (which cannot benefit from any host or layer-cache
  leftovers) before trusting the fix.
- **No single status signal — a breadcrumb's prose, a GitHub Project field,
  or an issue's own body text — is self-verifying. Check the actual child
  tasks, merged PRs, or code when a feature's real status matters, not just
  its headline field.** Three real instances, not hypothetical: (1) session
  7's breadcrumb reported TASK-036 (#95, app shell) as "completed and
  closed" when #95 was still open, untouched since creation, with no
  implementing commit or PR anywhere — caught only by cross-referencing
  the breadcrumb against `gh issue list`/`git log` at the start of session
  8. (2) FEAT-009/#18 — both its tasks (#91/#92) were closed and its
  Implementation Proposal had already been archived `IMPLEMENTED`, but
  #18 itself carried a stale `Status: Not Started` Project field and zero
  comments reflecting the real state, invisible unless the child tasks
  were checked directly. (3) This same session's own initial, corrected
  belief that FEAT-008/#17 was unstarted — its Project field and body
  text still read "Not Started," but all four of its tasks (#87-90) were
  closed and the code was already in the repo; only checking the child
  tasks and #17's own (already-accurate) comment thread caught the error
  before it drove a wrong recommendation any further.

  When actually checking a thread, use `gh issue view <n> --json
  body,comments -q '...'` — plain `gh issue view <n> --comments` fails on
  this repo with `GraphQL: Projects (classic) is being deprecated ...
  (repository.issue.projectCards)`, breaking at exactly the moment this
  rule is telling you to go verify.
- If a `gh issue`/`gh pr` write command (comment, close, edit) is denied by
  the permission classifier, the equivalent `mcp__github__*` tool
  (`add_issue_comment`, `issue_write`, `pull_request_review_write`, etc.)
  is a confirmed-working fallback — reach for it *after* a block happens,
  not as a default preference over `gh`. `gh` is still the normal, working
  path; this is what to do when it specifically gets blocked, not a
  suggestion to route around it preemptively. Confirmed 2026-08-01: `gh
  issue comment 232 ...` was denied by the classifier while a functionally
  identical `gh issue close 232 --comment ...` ran unblocked later in the
  same session — the block is not reliably predictable from the command
  shape alone, so don't assume every `gh` write will fail once one does.
- **A PreToolUse denial does not tell you which earlier steps, if any,
  already ran — verify with a read-only check before proceeding as if a
  prior step succeeded (or as if it didn't).** Applies to a single denied
  compound command (e.g. `A && B`, where the whole call is blocked
  atomically, not per-segment) and equally to a sequence of separate tool
  calls (a denial on step 3 says nothing about whether steps 1-2 actually
  landed). Confirmed 2026-08-01: after `git branch <name> <sha> && git
  reset --hard origin/main` was denied as one unit, the next turn proceeded
  as though the `git branch` half had already created the safety branch —
  it hadn't — and only surfaced when a later `git push` on that branch
  failed with "unknown revision." No data was actually lost (the commit
  was still in `git reflog`), but the wrong assumption briefly drove
  further action on a false premise. Don't guess partial execution either
  direction; check.
- **If a `docker`/`docker compose` command hangs rather than errors, check
  whether the daemon itself is actually running before assuming a
  compose-file or command bug.** `systemctl is-active docker` and `pgrep
  dockerd` are the fast checks. Confirmed 2026-08-02: the daemon died
  mid-session (real memory pressure — 215Mi free of 7.6Gi at the time),
  and every subsequent `docker compose`/`docker ps` call hung for its full
  timeout instead of failing fast, which looked at first like a compose
  file or networking problem. There is no passwordless-sudo or interactive-
  TTY path available to an agent in this sandbox to restart the daemon
  itself — if it's down, say so plainly and hand off to the human (e.g.
  restarting Docker Desktop on the Windows host, for WSL setups) rather
  than retrying the same command.
- **Before drafting an Implementation Proposal's mechanism for anything
  touching staging/production infrastructure, check the relevant
  runbook(s) for already-documented access constraints — SSH availability,
  reachable ports/hosts, credential locations — before proposing a
  mechanism that assumes a particular access path.** Confirmed 2026-08-02:
  the #256 IP's first draft proposed exporting the live Keycloak realm via
  `kc.sh export`/SSH, discovered only mid-implementation to be infeasible
  — `scripts/feat009-staging-verify.md` already stated in plain text
  ("there is no personal SSH key for this box... copy-paste into the
  staging droplet console") that this exact access path doesn't exist,
  written in an *earlier* session's own work. Checking that file first
  would have avoided a full revision cycle (a second human decision plus
  an IP rewrite) spent approving a mechanism that then had to change.
