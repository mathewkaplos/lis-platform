# Implementation Proposal: FEAT-045 Tenancy tiers (schema/DB isolation)
Status: APPROVED
ADR: adr-0039 (accepted), adr-0038 (accepted, prerequisite)    Date: 2026-08-11    Backlog ID: FEAT-045 (#54)

**Approved 2026-08-11** via the native options-prompt (all three §10 questions accepted as
drafted: tier-3 deferred, ADR-0038 and ADR-0039 both accepted).

## 1. Goal
M9 (EPIC-008) is fully code-complete; its epic issue stays open only on a human staging demo, not
further code. M10 (EPIC-009, Commercial Readiness) has not started — 0 of 7 issues closed. FEAT-045
is Critical priority and, per the Execution Plan, the structural prerequisite M10's other Critical
deliverables build on: FEAT-046 (billing) needs to know what a tenant *is* as a first-class entity
to bill it, and FEAT-049 (self-service onboarding) needs somewhere to write a new tenant's tier
assignment when it provisions one. This feature builds that foundation, not the billing or
onboarding UX itself.

Literal acceptance criterion (issue #54): "A tenant can be provisioned onto dedicated schema or
database isolation without application code changes."

This proposal scopes the **dedicated-schema** half of that criterion (KB-38's tier 2) as the real,
tested deliverable, and explicitly proposes deferring the **dedicated-database** half (tier 3) —
see ADR-0039 and Assumptions §5 for why, mirroring how FEAT-041 shipped only a stub AI provider
rather than a live vendor integration.

## 2. Affected files
- `~/work/lis-engineering/adr/adr-0039-tenant-registry-table-plus-schema-scoped-connection-resolver-for-isolation-tiers.md` (new, drafted, Status: proposed) — the tenant table + resolver decision.
- `~/work/lis-engineering/adr/adr-0038-rls-exempt-tables-marked-with-a-required-sql-comment-citing-the-justifying-adr.md` (new, drafted, Status: proposed) — prerequisite; the `tenant` table is itself a new RLS-exempt table and needs this convention to pass the Constitution gate with a citable justification, per issue #145.
- `packages/db/src/schema/tenant.ts` (new) — the `tenant` table: `id`, `name`, `isolation_tier` (enum), `schema_name` (nullable), `connection_ref` (nullable), `region`, `created_at`.
- `db/migrations/00XX_tenant_registry.sql` (new, drizzle-generated) — creates `tenant` with the `-- rls-exempt: ADR-0039` marker; retrofits the same marker (citing ADR-0004) onto `analyte`, `unit`, `code_system_value` in the same migration, per ADR-0038's acceptance criteria.
- `packages/db/src/rls-isolation-check.ts` — extended to recognize the `-- rls-exempt: ADR-NNNN` marker and stop flagging a marked, `tenant_id`-less table as missing RLS.
- `.github/workflows/constitution-gate.yml` — the "Require RLS alongside any new tenant table" step gains the same marker recognition.
- `packages/db/src/tenant-resolver.ts` (new) — `TenantResolverService.resolve(tenantId): Promise<{ tier, schemaName?, connectionRef? }>`, queried against the existing control-plane pool.
- `packages/db/src/client.ts` — `createDb()` gains an optional `searchPath` bind so a transaction can be pointed at a dedicated schema without a second physical pool.
- `apps/api/src/auth/tenant-context.interceptor.ts` — calls the resolver once per request; `shared` tenants bind exactly as today (no behavior change); `dedicated_schema` tenants additionally set `search_path` on the same transaction.
- `packages/db/src/tenant-isolation-check.ts` (new, sibling to `rls-isolation-check.ts`, same structural-sweep-plus-live-leak methodology per `rls-multi-tenancy` entry #4) — proves cross-schema isolation for a real `dedicated_schema` tenant.
- `apps/api/test/tenant-tier-routing.e2e-spec.ts` (new) — real-Postgres integration test: a `shared` tenant's request lands in `public` (regression), a `dedicated_schema` tenant's request lands in its own schema and cannot see `public`-schema rows or another dedicated schema's rows.
- `~/work/lis-engineering/skills/engineering/rls-multi-tenancy/SKILL.md` — new entry recording this feature's real findings (the schema-routing mechanism, and the `dedicated_db` deferral), and its "not (yet) covered" §6 note on tiers 2/3 updated now that tier 2 is real.

## 3. Architecture consulted
- KB-38 (Multi-Tenancy) — the three-tier model this feature implements tier 2 of; explicitly states tenants move between tiers "without code changes," which is why routing lives in a real, updatable table rather than an encoded convention (ADR-0039's rejected-alternatives).
- KB-06 (Database Architecture) — RLS mechanics tier 1 already relies on; unchanged by this feature.
- ADR-0004 — the existing precedent for global, RLS-exempt tables; this feature's `tenant` table is the second one and the direct trigger for finally building ADR-0038's marker mechanism.
- ADR-0009 (single Keycloak realm, `tenant_id` claim) — unchanged; this feature adds no new identity-side mechanism, only DB-side routing keyed on the same `tenant_id`.
- ADR-0010 (transaction-scoped `SET LOCAL` tenant binding) — the exact pattern `TenantContextInterceptor` already uses for `app.tenant_id`; this feature extends the same interceptor and the same "bind once, per-transaction, never session-scoped-on-a-pooled-connection" discipline to `search_path`.
- ADR-0037/FEAT-041's own proposal — the direct precedent for scoping a new capability to the nearest provable tier and deferring the rest until a real forcing function exists (there: real AI provider vendor; here: a real dedicated-DB tenant).
- `rls-multi-tenancy` Skill entry #4 (structural sweep + live leak check, both required) and entry #6 ("not yet covered: dedicated-schema/dedicated-database tiers... no table in this repo has escalated tiers yet," and issue #145) — this feature is the direct resolution of both open notes in that entry.

## 4. Skills loaded
- `engineering/rls-multi-tenancy` (required by the feature's own GitHub issue) — entries #1 (test as `lis_app`, never `postgres`), #4 (structural + live-leak proof), #6 (the exact gap this feature closes).
- `engineering/database-design` — migration conventions, enum usage precedent (`observation.dataType`'s native Postgres enum, ADR-0006).
- `engineering/testing` — entry #1 (real-Postgres checks are `tsx` scripts / e2e specs against a real DB, not mocked).
- `engineering/api-design` — `TenantContextInterceptor` is a cross-cutting interceptor already covered by this Skill's ordering guidance (must still run after `JwtAuthGuard`).

## 5. Assumptions & autonomous decisions
- **Dedicated-database (tier 3) routing is explicitly deferred**, not built. The `tenant` table
  and resolver interface both support it (`isolation_tier = 'dedicated_db'`, `connection_ref`
  column exist), but no second physical `pg.Pool` is wired up, and no tenant is assigned this tier
  during this feature's own testing. Full rationale in ADR-0039. This is the single biggest scope
  cut in this proposal — flagged as §10 question 1.
- **The `tenant` table lives in the primary/control-plane database on every tier**, including for
  `dedicated_db` tenants — the routing record has to be found before the resolver knows where to
  route the rest of the request. This mirrors how a DNS record lives outside the network it points
  into.
- **No admin UI or self-service tier-assignment flow.** Assigning a tenant's tier is a manual
  seed/migration row in this feature — FEAT-049 (Self-service onboarding) owns building real
  tooling on top of this table. Matches FEAT-045's own issue, which lists no Stitch/UI requirement.
- **`search_path`-based schema routing, not a second connection pool, for tier 2.** A dedicated
  schema on the *same* physical Postgres server needs only a `search_path` change per transaction —
  opening a second `pg.Pool` per dedicated-schema tenant would be real added complexity for no
  isolation benefit tier 2 doesn't already get from separate schemas plus the existing RLS
  discipline layered on top (a `dedicated_schema` tenant's tables still carry `tenant_id` + RLS,
  same as today — the schema boundary is additional defense-in-depth, not a replacement for RLS).
- **ADR-0038 (RLS-exemption marker) is bundled into this proposal's own approval** rather than
  requiring a separate round-trip, because FEAT-045's own migration cannot cleanly pass the
  Constitution gate without it — same pattern task-459/ADR-0036 and FEAT-041/ADR-0037 already
  established (a feature's own necessitated ADR approved alongside it, not as a prerequisite PR).

## 6. Risks
- `TenantResolverService` adds one extra query to every request's critical path (control-plane
  lookup before the main transaction opens). Acceptable given the table's tiny size and read
  pattern; an in-process cache is a deliberate future optimization, not built speculatively now
  (ADR-0039 Consequences).
- `dedicated_db`'s enum value existing with no working runtime path is a real footgun if a future
  session assigns a tenant to it assuming it works — mitigated by an explicit doc comment on the
  enum and the resolver, plus this proposal's own acceptance criteria requiring that state to be
  unreachable/no-op, not silently broken.
- Extending `rls-isolation-check.ts` and the Constitution gate's regex-based RLS check is exactly
  the kind of change `rls-multi-tenancy` entry #3 warns about (the gate's regex has had real
  false-negative classes before) — the new marker-recognition logic needs its own deliberately
  broken test case (a table with no `tenant_id` and no marker should still fail), not just a happy
  path.
- Retrofitting the exemption marker onto `analyte`/`unit`/`code_system_value` touches
  already-shipped migrations' *comments* only (no schema change), but any migration-file edit
  warrants care — confirm the golden-dataset/seed pipeline (TASK-019) is unaffected before merging.

## 7. Acceptance criteria
- [ ] Every existing tenant continues to resolve to the `shared` tier with unchanged behavior —
      full existing e2e suite passes unmodified.
- [ ] A `dedicated_schema` tenant's requests are routed (via `search_path`) into that tenant's own
      schema; a live cross-schema leak check (structural sweep + real-data leak check, per
      `rls-multi-tenancy` entry #4) confirms isolation from `public` and from any other tenant's
      dedicated schema.
- [ ] The `tenant` table carries the `-- rls-exempt: ADR-0039` marker; `analyte`/`unit`/
      `code_system_value` are retrofitted with `-- rls-exempt: ADR-0004`; `rls-isolation-check.ts`
      and the Constitution gate both recognize the marker and still fail a table with neither
      `tenant_id` nor a marker.
- [ ] `isolation_tier = 'dedicated_db'` is a valid, storable enum value with no working routing
      path — documented as a deliberate no-op in code comments and this proposal, not silently
      incomplete.
- [ ] No application code outside `tenant-resolver.ts`/`tenant-context.interceptor.ts` needs to
      change to move a tenant between `shared` and `dedicated_schema` (the literal "without
      application code changes" bar from issue #54, scoped to the tiers this feature implements).

## 8. Testing plan
- Unit: `tenant-resolver.spec.ts` — tier lookup, `dedicated_db` no-op path returns a clearly-typed
  "not yet routable" result rather than throwing or silently defaulting to `shared`.
- Integration (real Postgres, per `engineering/testing` entry #1): `tenant-isolation-check.ts`
  (`tsx` script, mirroring `rls-isolation-check.ts`'s own invocation convention) — structural sweep
  confirming every `dedicated_schema` tenant's schema exists and is distinct, plus a live leak
  check with real seeded data in two different dedicated schemas.
- e2e: `tenant-tier-routing.e2e-spec.ts` — a `shared`-tier request and a `dedicated_schema`-tier
  request against the same route, asserting each lands in the correct schema.
- Regression: full existing e2e suite (currently 41 files/370+ tests) must pass unmodified —
  proves zero behavior change for every existing (all currently `shared`-tier) tenant.
- Constitution gate: confirm it passes on this feature's migration citing ADR-0038/ADR-0039, and
  confirm (via a deliberately-broken test case, not just reading the regex) that it still fails a
  table with neither RLS nor the marker.

## 9. Rollback plan
The `tenant` table and resolver are additive — no existing table's shape changes, no existing
tenant's data moves. Rollback is: revert the new migration (drops `tenant`), revert the
interceptor/client changes (falls back to today's single-pool-only behavior), revert the gate/check
marker recognition. Every tenant today is `shared`-tier by construction (the only tier that exists
before this feature ships), so no live tenant depends on the new routing path — a full revert is a
clean, low-risk operation regardless of when it happens.

## 10. Questions requiring human approval
1. **Approve deferring dedicated-database (tier 3) routing** to a future feature/session, shipping
   only the `tenant` registry table + dedicated-**schema** (tier 2) routing in this proposal, with
   the `dedicated_db` enum value present but non-functional (per ADR-0039)?
2. **Approve ADR-0038** (RLS-exempt tables marked with a `-- rls-exempt: ADR-NNNN` SQL comment,
   recognized by `rls-isolation-check.ts` and the Constitution gate) as this proposal's
   prerequisite, retrofitting the marker onto the three existing ADR-0004 tables in the same PR?
3. **Approve ADR-0039** (global `tenant` registry table + schema-scoped connection resolver,
   `search_path`-based routing for tier 2, no second physical database in this slice) as this
   feature's own architectural decision?
