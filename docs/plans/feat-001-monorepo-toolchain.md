# Implementation Proposal: FEAT-001 Monorepo & toolchain — closing TASK-005
Status: IMPLEMENTED (merged 128d9ac via PR #139)
ADR: adr-0001, adr-0002 (referenced, not superseded)    Date: 2026-07-29    Backlog ID: FEAT-001 / TASK-005 (#10 / #64)

## 1. Goal

FEAT-001 (#10) has four of five tasks done; the last is TASK-005 (#64) — "Docker
Compose: Postgres 16 + Valkey; db:reset." `docker-compose.yml` and
`scripts/db-reset.sh` already exist in the repo. This proposal covers **verifying
both stated acceptance criteria with real command output**, per the discipline
that closed TASK-010/#69 (code merged ≠ criterion proven), and then either
closing #64 + #10, or documenting precisely why not.

A pre-check already surfaced a real gap (see §5): `scripts/db-reset.sh` drops
and recreates the Postgres container but does not migrate or seed — the script
itself says "Migrations will run here once Drizzle is configured (FEAT-004)."
FEAT-004 (#13, Catalog metadata model) is milestoned M1 and not started. This
proposal does not attempt to build migrations/seeding early to force AC2 green;
that would pull M1 scope into M0 without a decision to do so. §10 asks you to
choose how to resolve this instead.

## 2. Affected files

- None in `apps/*` or `packages/*` expected — this is verification, not new
  build, for AC1.
- `scripts/db-reset.sh` — touched only if you choose Option A in §10 (add an
  explicit "not yet implemented" guard/log line so the gap is visible instead
  of silent).
- `docs/scope/current.md` — breadcrumb update at the end, per existing repo
  convention (see PR #137 and prior).
- GitHub issues #64 and #10 — closed with "Closes #NN" references, or updated
  with findings, depending on §10's answer.

## 3. Architecture consulted

- ADR-0001 (pnpm monorepo layout) — confirms `docker-compose.yml` at repo root
  is the correct location.
- ADR-0002 (DigitalOcean staging) — explicitly states staging "mirror[s] the
  local dev setup exactly" using the same Postgres 16 + Valkey Docker Compose
  configuration, so this verification also has a bearing on staging fidelity.
- Knowledge base: no KB document specifies Docker Compose or `db:reset`
  behavior directly (checked KB-05 System Architecture, KB-06 Database
  Architecture, KB-47 Deployment — no mentions). AGENTS.md names Drizzle ORM
  as the chosen migration tool for the stack, consistent with the script's
  own comment; no conflicting or missing load-bearing decision found there.

## 4. Skills loaded

- `engineering/docker-pnpm-monorepo-deploy` — Docker/pnpm gotchas (CI=true,
  injectWorkspacePackages, lockfile regeneration). Relevant if `docker compose
  up` surfaces any pnpm-adjacent issue, though this stack doesn't build the
  app images, only pulls `postgres:16` and `valkey/valkey:8`.
- `workflow/plan` (this proposal) and `workflow/develop` (for the implementation
  step once approved).
- `domain` and `meta` Skill classes: none exist yet — nothing applicable.

## 5. Assumptions & autonomous decisions

- Assuming "reachable" in AC1 means: containers report healthy/running via
  `docker compose ps`, and a direct connection succeeds (`pg_isready` for
  Postgres, `PING` via `redis-cli`/`valkey-cli` for Valkey on port 6379).
- Assuming AC1 (`docker compose up` reachability) can be verified today,
  independently of AC2, since Postgres/Valkey startup has no dependency on
  Drizzle being wired up.
- Assuming AC2 as literally written ("drops, migrates, and seeds cleanly")
  cannot be fully verified today because no migration or seed mechanism exists
  in this repo yet — this is a factual gap found by reading `scripts/db-reset.sh`
  and confirming FEAT-004/#13 (which owns bringing in Drizzle) is M1, open,
  not started. Not treating this as something to route around silently.
- No autonomous decision made on how to resolve the AC2 gap — routed to §10.

## 6. Risks

- Low risk on the verification itself — read-only against local Docker
  containers, nothing touches staging or CI.
- Risk of a false "closed" state if AC2 is marked done without real
  migrate/seed behavior — this is exactly the TASK-010 pattern the last
  session flagged as costly; this proposal exists specifically to avoid
  repeating it.
- If Option A (§10) is chosen and `scripts/db-reset.sh` is edited, minimal
  risk — additive logging only, no behavior change to the drop/recreate path
  that's already working.

## 7. Acceptance criteria

Restating #64's original two, plus how each will be judged:

- [ ] `docker compose up` gives a reachable Postgres 16 and Valkey instance —
      judged by `docker compose ps` showing both healthy/running, plus a
      successful `pg_isready -h localhost -p 5432` and a successful PING
      against Valkey on 6379.
- [ ] `pnpm db:reset` drops, migrates, and seeds cleanly — judged as **not
      currently satisfiable** (migrate/seed steps don't exist); resolution
      depends on §10.

## 8. Testing plan

1. `docker compose up -d` from repo root; capture `docker compose ps` output.
2. `pg_isready -h localhost -p 5432 -U postgres` (or `docker compose exec
   postgres pg_isready -U postgres`) — capture pass/fail.
3. `docker compose exec valkey valkey-cli ping` — capture pass/fail (expect `PONG`).
4. Run `pnpm db:reset`; capture full output verbatim.
5. Compare captured output against the two AC line items above; do not infer
   success from absence of errors — confirm the specific claimed behavior.
6. `docker compose down -v` to leave a clean state afterward.

## 9. Rollback plan

Pure verification (steps 1-4 above) has nothing to roll back — no code changes.
If Option A in §10 is approved and `scripts/db-reset.sh` is edited, rollback is
`git revert` of that one commit; no schema or data changes are involved since
no migrations exist yet.

## 10. Questions requiring human approval

1. **How should the AC2 gap be resolved?**
   - **Option A (recommended):** Verify AC1 now, close #64's scope down to
     "Docker Compose reachability" with an explicit note that migrate/seed is
     tracked under FEAT-004/#13 (M1) rather than re-litigated here; add one
     log line to `db-reset.sh` making the gap visible to any future reader
     instead of silent. Close #64 and #10 on this basis.
   - **Option B:** Leave #64 (and therefore #10) open until FEAT-004 lands in
     M1 and migrate/seed are real, since the issue's literal AC2 text isn't
     met yet.
   - **Option C:** Pull minimal migration/seed scaffolding into scope now
     (would require its own ADR/proposal discussion — this is M1 work per the
     roadmap, not a small addition).
2. Should this proposal's file also cover re-checking #10's other four
   acceptance criteria (pnpm build, presets, apps scaffolded, packages exist),
   or are those considered already proven by earlier merged PRs (#122-#129)
   and out of scope for this pass?
