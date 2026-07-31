# Implementation Proposal: FEAT-009 Authorization & audit
Status: IMPLEMENTED
ADR: adr-0011 (roles as Keycloak realm roles, not a new Postgres table — accepted)
Date: 2026-07-31
Backlog ID: FEAT-009 (#18) / TASK-032 (#91, closed), TASK-033 (#92, closed)
Merge commits: TASK-032 PR #185 (`7fc487c`), TASK-033 PR #186 (`829f0bf`)

## 1. Goal

FEAT-009 is M2's next feature now that FEAT-008 (Authentication) is fully closed at the
task level: "enforce the entry-vs-verification safety boundary and audit every clinical
write." Its only dependency, FEAT-008, is closed — the JWT guard (TASK-029) already
resolves a verified `sub`/`tenant_id` per request, and `RequestContext.roles` already
exists and is already parsed from `realm_access.roles` in the token
(`apps/api/src/auth/jwt-auth.guard.ts`), currently always empty only because no realm
role is defined yet (`infra/keycloak/README.md`, TASK-028, deliberately deferred this
exact decision to FEAT-009). This proposal is that deferred decision being made.

Two tasks, covered together by this one proposal per FEAT-009's own issue (which names
this exact file) and the FEAT-004–008 precedent of one proposal per feature:
TASK-032 (role model + capability checks: enter != verify) and TASK-033 (audit
interceptor on every clinical mutation). TASK-033 depends on TASK-032 in practice (the
audit interceptor records `actor_role` — the specific role that authorized the action —
which only exists once TASK-032's capability guard resolves it), so TASK-032 is
implemented and merged first within this one approved proposal, then TASK-033.

Neither task has a real business mutation route to attach to yet (result entry, order
creation, etc. are M3/M4 features) — same situation TASK-030 was in. Both tasks prove
their structural guarantee through a demo/proof route extending the existing
`tenant-check.controller.ts` pattern, not by inventing a business feature ahead of its
own milestone.

## 2. Affected files

- `infra/keycloak/lis-realm.json` — add two realm roles (`technologist`, `verifier` —
  the minimum needed to prove TASK-032's literal AC; the rest of KB-10's role list is
  intentionally *not* provisioned yet, added when a future task first needs it, same
  discipline TASK-028 already used to defer this exact decision); add a `roles` client
  scope (`oidc-usermodel-realm-role-mapper`) defined in full per this realm's
  established "define built-ins in full, never reference by name only" rule; grant it
  as a default scope on `lis-web`; assign `technologist` to `test-user` and `verifier`
  to `test-user-2` (reusing the two existing seeded users rather than adding new ones,
  since FEAT-008 already gave them distinct identities for exactly this kind of
  two-principal proof).
- `apps/api/src/auth/capabilities.ts` (new) — the static, centralized role→capability
  map per KB-10 (`{ technologist: ['enter_result'], verifier: ['enter_result',
  'verify'], ... }`), and a `hasCapability(roles, capability)` helper.
- `apps/api/src/auth/capability.guard.ts` (new) + `apps/api/src/auth/require-
  capability.decorator.ts` (new) — a `@RequireCapability('verify')` route decorator
  and matching `CanActivate` guard that reads `RequestContext.roles`, resolves the
  granting role via the capability map, throws `ForbiddenException` (403) if none
  grants it, and otherwise attaches the resolved granting role onto the request (for
  TASK-033's audit interceptor to read as `actor_role`) — mirrors `JwtAuthGuard`'s
  existing fail-closed shape (deny, don't guess).
- `apps/api/src/auth/audit.interceptor.ts` (new) — wraps a route already inside
  `TenantContextInterceptor`'s transaction (reads the same `tx` via `DbTx`), calls the
  existing `writeAuditEvent` (`packages/db/src/audit.ts`, TASK-025) with `actorPrincipalId`
  = `sub`, `actorRole` = the capability-resolved granting role, `actorType: 'human'`,
  and `action`/`resourceType`/`resourceId`/`before`/`after` supplied by a small
  per-route `@Audit({ action, resourceType })` decorator + the handler's own
  before/after values — so the write commits in the same transaction as the mutation
  it records (Constitution Law #5: "written in the same transaction as the change"),
  never a separate one.
- `apps/api/src/auth/tenant-check.controller.ts` — extended (or a sibling
  `capability-check.controller.ts`, TBD at implementation time) with guarded demo
  routes: one requiring `enter_result`, one requiring `verify`, each wrapped in
  `TenantContextInterceptor` + `AuditInterceptor`, performing a synthetic tenant-scoped
  write (exact target table decided at implementation time — an existing tenant-scoped
  table already migrated by FEAT-005/006, not a new one) so both TASK-032's and
  TASK-033's AC are provable end-to-end through the live API, same standard TASK-030
  already established.
- `~/work/lis-engineering/adr/adr-0011-...md` (new, this proposal) — role-storage
  decision, Status: proposed until this proposal is approved and its AC verified.
- `~/work/lis-engineering/skills/engineering/authentication/SKILL.md` — extended (not
  a new Skill) with whatever real findings TASK-032/033 surface, per AGENTS.md's
  same-day Skill-writing rule; a genuinely new `authz` Skill is created instead only if
  the findings turn out not to fit the existing one's scope.
- `docs/scope/current.md` — breadcrumb update once the feature closes.

## 3. Architecture consulted

- **KB-10 Authorization** — the RBAC+ABAC hybrid model this proposal implements a first
  slice of: roles bundle capabilities, `enter_result`/`verify` deliberately split,
  enforcement at capability-guard + row-filter layers. This proposal implements the
  RBAC half only (role → capability); ABAC (facility/discipline/data_scope attributes)
  is explicitly out of scope — see §5.
- **KB-11 Audit Logging** — record structure (`audit.event`'s `actor`, `action`,
  `resource`, `before`/`after`, hash chain) already implemented by TASK-025
  (`packages/db/src/audit.ts`, `db/migrations/0010_audit_event.sql`); this proposal
  wires automatic *emission* on every clinical mutation via an interceptor, reusing
  that existing writer rather than building a new one.
- **Constitution Law #5** — "every clinically significant action is audited... written
  in the same transaction as the change" — the literal requirement `AuditInterceptor`
  must satisfy by writing through the same `tx` `TenantContextInterceptor` opened, not
  a follow-up write.
- **ADR-0009 / ADR-0010** — the identity/tenant substrate this proposal builds on
  directly: `RequestContext.roles` (populated, unused until now) and the
  transaction-per-request pattern `AuditInterceptor` reuses rather than opening its own.
- **`infra/keycloak/README.md`** — the explicit, on-the-record deferral of role
  modeling to this feature; consulted to confirm this proposal is resolving a
  deliberately-parked decision, not inventing new scope.
- **`authentication` Skill** — §6 "Not (yet) covered here" lists "Authorization / RBAC+
  ABAC (KB-10) — deliberately not modeled... FEAT-009's job. Don't invent role/
  capability names in this realm ahead of that design" — the exact boundary this
  proposal now crosses deliberately, per its own instruction.
- **`rls-multi-tenancy` Skill** — entry #4's "prove structurally *and* live, two
  independent checks" standard applied here too: TASK-033's AC needs both "the audit
  row exists with correct content" and "the hash chain verifies" (`verifyAuditChain`,
  already built), not just a happy-path insert.

## 4. Skills loaded

- `workflow/plan` (this proposal), `workflow/develop` (implementation step once
  approved).
- `authentication` — the existing FEAT-008 conventions (JWKS/`jwtVerify`, fail-closed
  guard shape, `FastifyRequest` typing) this proposal's new guards/interceptors must
  match, and the explicit "don't invent roles ahead of FEAT-009" boundary this proposal
  resolves.
- `rls-multi-tenancy` — read this session specifically for this proposal (flagged as
  relevant but unread in the prior orientation pass). Its structural-plus-live proof
  standard (entry #4) and its "not yet covered" section on exempt/global tables (entry
  #5, tracked separately as #145) are both consulted; no tenant-scoped table changes
  are introduced by this proposal itself (the demo route reuses an existing table), so
  no new RLS policy is required, but the demo route's write must still be proven to
  land under the correct tenant via the existing pattern, not assumed.
- `docker-pnpm-monorepo-deploy` — not directly applicable (no new workspace package,
  no Dockerfile change expected), noted as checked, not loaded in full.

## 5. Assumptions & autonomous decisions

- **Role storage is Keycloak realm roles, not a new Postgres table** — the load-bearing
  part of this decision, **routed to ADR-0011 (accepted, §10)**, not decided silently
  here. ADR-0011's acceptance also added an explicit AC: a token with an empty `roles`
  array (today's actual state, before realm-role provisioning) must be denied every
  capability check, not silently granted one through an empty-array matching edge
  case — carried into this proposal's own testing plan as item 10 below.
- **Capability→role mapping is a static, centralized in-code map**, not stored in
  Keycloak or Postgres. Reversible implementation detail (same category as FEAT-008's
  JWT-library choice) — not routed to an ADR. Matches KB-10's own "Centralised,
  testable policy (toward policy-as-code)" decision; today's static map is the cheap
  version of that future state, not a competing design.
- **ABAC attributes (`facility_id(s)`, `discipline(s)`, `verification_authority`,
  `signing_authority`, `data_scope`) are out of scope for this proposal.** No
  facility/discipline concept exists anywhere in this codebase yet — no table, no
  claim, no seeded data. TASK-032's own literal AC ("a bench-role user is refused when
  attempting to verify a result") only requires the RBAC half. Flagged explicitly as a
  real scope boundary, not an unambiguous reading — same move FEAT-008 §5 made for
  org/branch selection, and FEAT-006 §5 made for KB-02's fuller `Order` aggregate.
- **Only two realm roles provisioned now (`technologist`, `verifier`)**, not KB-10's
  full role list (`collector`, `accessioner`, `pathologist`, `microbiologist`,
  `lab_director`/`qa`, `admin`, `clinician`, `patient`, `integration`, `ai_agent`).
  Provisioning all of them now, unexercised, would be scope beyond what TASK-032's AC
  requires; each is added when a real feature first needs it, consistent with
  `infra/keycloak/README.md`'s own stated reason for not inventing roles early.
- **The audit interceptor writes directly to `audit_event` inside the request's
  existing transaction — no transactional outbox.** KB-11 describes an outbox as the
  ideal emission mechanism (durable propagation to downstream consumers), but no
  downstream consumer of audit events exists yet at this milestone; a direct
  same-transaction write already satisfies Constitution Law #5's literal wording
  ("written in the same transaction as the change") and TASK-025's existing writer.
  Revisit if/when a real downstream consumer (e.g. a SIEM export, KB-11's "Optional WORM
  sink") needs reliable propagation — a bigger, separate decision, not pre-built here.
- **`actor_role` on the audit row is the single capability-granting role for that
  specific action**, not the full `roles` array joined into a string. `audit_event
  .actor_role` is a singular `text NOT NULL` column (TASK-025); KB-11's own example
  ("the audit records... the actor + role") reads as *the role under whose authority
  this action was taken*, which is exactly what `CapabilityGuard` already resolves to
  grant the request — reusing it is more correct than re-deriving or concatenating.
- **The demo/proof route's target table is decided at implementation time**, not
  pinned in this proposal — any already-migrated tenant-scoped table with no required
  FK setup is sufficient to prove the mechanism (same reasoning TASK-030's
  `tenant-check.controller.ts` used for choosing `audit_event` itself as its read
  target). Not treated as a design decision worth blocking approval on.

## 6. Risks

- **`actor_role` mapping ambiguity if a user ever holds multiple roles that each grant
  the same capability.** `CapabilityGuard` must deterministically resolve one granting
  role (e.g. first match in a fixed role-priority order), not silently pick
  arbitrarily — otherwise two audit rows for logically identical actions could report
  different `actor_role` values for the same user, undermining the "who did what under
  which authority" guarantee KB-10/KB-11 both rest on. Needs an explicit test with a
  user holding two capability-granting roles, not just the single-role happy path.
- **Audit-write failure must fail the mutation, not silently drop the audit row.**
  Because `AuditInterceptor` writes inside the same transaction as the mutation, a
  failed audit write already rolls back the mutation by construction (transaction
  atomicity) — but this must be proven with a real forced-failure test (e.g. a
  `before`/`after` payload that can't serialize), not assumed from the transaction
  boundary alone, matching this repo's "prove it, don't just reason about it"
  standard (rls-multi-tenancy Skill entry #4, authentication Skill entry #3).
- **No Constitution Gate regex currently targets audit-interceptor coverage** (same gap
  class FEAT-008 §6 already flagged for auth-guard coverage) — a future route that
  forgets `@UseInterceptors(AuditInterceptor)` would pass CI without being caught
  structurally. The testing plan's negative case (§8) is the real proof here, not the
  Gate; flagged as a possible future Gate rule, not built in this proposal.
- **Capability-guard bypass risk mirrors TASK-029's fail-closed shape**: any route
  performing a clinical mutation without `@RequireCapability(...)` applied is
  unprotected by construction (NestJS guards are opt-in per route, not global-by-
  default here) — same shape of risk `JwtAuthGuard`/`TenantContextInterceptor` already
  carry, mitigated the same way (explicit per-route application, code review, and a
  deliberately-unguarded negative-test route proving what "unguarded" looks like, same
  pattern as `tenant-check.controller.ts`'s unbound route).
- **Empty-roles fail-closed case (ADR-0011)**: every token issued today has an empty
  `roles` array (no realm role provisioned yet) — the capability map's matching logic
  must resolve that to "deny every capability," not accidentally treat an empty array
  as an unrestricted match. Added as an explicit AC on ADR-0011 (now accepted) and
  carried into this proposal's testing plan as item 10 (§8).

## 7. Acceptance criteria

FEAT-009's feature-level AC, plus how each will be judged:
- [ ] A bench-role user is refused when attempting to verify a result — TASK-032.
      Judged by a real guarded route: a `technologist`-role token gets 403 on a
      `@RequireCapability('verify')` route; the same token succeeds on a
      `@RequireCapability('enter_result')` route; a `verifier`-role token succeeds on
      both.
- [ ] Every clinical mutation produces exactly one audit_event row with correct actor,
      tenant, and timestamp — TASK-033. Judged by calling a guarded, audited demo
      route and confirming exactly one new `audit_event` row exists afterward, with
      `actor_principal_id` = the caller's `sub`, `actor_role` = the capability-granting
      role, `tenant_id` = the caller's tenant, and `hash`/`prev_hash` correctly chained
      (`verifyAuditChain` returns `valid: true` afterward).

TASK-level AC:
- [ ] TASK-032 (#91): "A bench-role user is refused when attempting to verify a
      result" — as above.
- [ ] TASK-033 (#92): "Every clinical write produces exactly one correctly attributed
      audit_event row" — as above, plus the forced-failure negative case (§6, §8).

## 8. Testing plan

1. Realm: import the updated `lis-realm.json` locally; confirm `test-user` (role
   `technologist`) and `test-user-2` (role `verifier`) each obtain a token whose
   decoded `realm_access.roles` contains the expected role and nothing else.
2. `technologist` token → guarded `enter_result` demo route → 200, one `audit_event`
   row written with `actor_role: 'technologist'`.
3. `technologist` token → guarded `verify` demo route → 403, **no** `audit_event` row
   written (the capability check must reject before the interceptor's mutation runs —
   confirmed by row count unchanged, not just by the response code).
4. `verifier` token → guarded `verify` demo route → 200, one `audit_event` row written
   with `actor_role: 'verifier'`.
5. **Multi-role resolution case:** a token with both `technologist` and `verifier`
   roles → `enter_result` route → confirm `actor_role` resolves deterministically (not
   arbitrarily) per §6.
6. **Forced audit-write failure case:** trigger a payload that fails inside
   `writeAuditEvent` (or a forced DB error) and confirm the wrapped mutation is rolled
   back too — no partial state where the mutation committed but no audit row exists.
7. **Unguarded-route negative case**, mirroring `tenant-check.controller.ts`'s existing
   unbound-route pattern: a demo route with `TenantContextInterceptor` but no
   `AuditInterceptor`/`@Audit(...)` performs a write with no audit row — proves the
   opt-in nature of the mechanism is understood and documented, not that it's
   acceptable in real routes (real routes must always pair the two).
8. `verifyAuditChain` re-run after the above, confirming the hash chain still validates
   end-to-end (TASK-025's existing function, exercised through real interceptor-written
   rows for the first time, not just its own unit tests).
9. CI: confirm no new CI wiring is needed (no new workspace package, no new service) —
   verify this assumption rather than asserting it, since FEAT-008 found real CI gaps
   from an assumption exactly like this one (§5 of the FEAT-008 proposal, entry 5 of
   the `authentication` Skill).
10. **Empty-roles fail-closed case (ADR-0011 AC):** a token issued for a user with no
    realm role assigned at all (`realm_access.roles: []` — today's actual state, before
    this proposal's realm-role provisioning) → both the `enter_result` and `verify`
    demo routes → 403 on each, confirmed against a real token with a genuinely empty
    roles array, not inferred from the capability map's logic by inspection alone.

## 9. Rollback plan

Purely additive — no new migration (audit_event and its schema already exist from
TASK-025), no change to existing tenant-scoped tables beyond the demo route's synthetic
write. Rollback is reverting the PR(s): the new realm roles/client scope are additive
to `lis-realm.json`, the new guard/interceptor/decorator files are new code paths with
no prior callers to break, and removing them returns `apps/api` to its current
(FEAT-008-only) authorization state rather than a broken one. No production data exists
at this milestone.

## 10. Questions requiring human approval

1. **RESOLVED 2026-07-31 — Keycloak realm roles, not a new Postgres table.** Recorded
   as **ADR-0011** (Status: accepted). Rationale: consistent with ADR-0009's "IdP as
   single authority" precedent already established for `tenant_id`; `RequestContext
   .roles` already exists and is already parsed from the token, currently unused;
   avoids a second identity-adjacent data source that would need to stay reconciled
   with Keycloak. Accepted with one addition to ADR-0011's own acceptance criteria: an
   explicit fail-closed test for a token with an empty `roles` array (today's actual
   state, before this proposal's realm-role provisioning lands) — carried into this
   proposal's testing plan as §8 item 10. Full reasoning, consequences, and rejected
   alternatives (a Postgres `role` table; capabilities-as-realm-roles instead of
   role-bundles-capabilities) are in the ADR itself.
2. **RESOLVED 2026-07-31 — ABAC attributes (facility/discipline/signing
   authority/data_scope) deferred entirely, not modeled even partially in this
   proposal.** Confirmed: TASK-032/033 deliver RBAC + audit-emission only, matching
   their literal task-level AC; the fuller KB-10 model is picked up by whichever
   future task first needs facility- or discipline-scoped authorization.
3. **RESOLVED 2026-07-31 — Audit emission is a direct same-transaction write, not a
   transactional outbox.** Confirmed as an acceptable near-term simplification given
   no downstream consumer exists yet, not a silent narrowing of KB-11's fuller design.

**Approved 2026-07-31** — full FEAT-009 scope (TASK-032, TASK-033), all three open
questions resolved with the recommended option in each case, ADR-0011 accepted with
the added empty-roles fail-closed AC. TASK-032 may proceed; TASK-033 follows under
this same approval once TASK-032 merges, per §1's stated sequencing.

**Implemented 2026-07-31** — both tasks merged and both feature-level AC items (§7)
verified for real against a live Keycloak + Postgres stack, not assumed from passing
unit tests alone. TASK-032: PR #185, merge commit `7fc487c` — a real, previously-latent
`Reflector`/DI-under-esbuild bug was found and fixed along the way (documented as a new
`authentication` Skill entry). TASK-033: PR #186, merge commit `829f0bf` — the
forced-audit-failure rollback guarantee (§6/§8 item 6) was proven with a real Postgres
constraint violation and an order-row-count assertion, not reasoned about from the
transaction boundary alone. Issues #91 and #92 both closed with evidence-citing
comments, matching the TASK-023–026/#82-85 precedent (AC checkboxes in the issue bodies
themselves left unedited).
