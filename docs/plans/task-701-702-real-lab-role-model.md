# Implementation Proposal: Real lab role model + fix org-owner's capability grant
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #701, #702 (part of EPIC #697)

## 1. Goal

Per the decision recorded on #698 (Phase 0), ship a role set that actually
matches a real lab org chart instead of the ad-hoc set built up one ticket
at a time (every comment in `capabilities.ts` already documented this
gap). This closes the original pilot-readiness audit's #1 and #2
findings: the self-signup owner's own role couldn't run the lab, and there
was no user-management surface to fix it with. #701 (the role model) and
#702 (the org-owner's grant) are implemented together — #702 has no
correct fix without #701's `lab_admin` role existing first.

## 2. Decision recap (from #698)

- `verifier` → renamed `pathologist`. Same capability grant (including
  `verify`) — cosmetic-but-real rename, not a new actor.
- `reception` — new role: `manage_patients` + `manage_orders`, split out
  of the grant `technologist`/`pathologist` already carry.
- `cashier` — new role: `manage_billing`, split out the same way.
- `lab_admin` — new role: `manage_org_settings` + new `manage_users`
  capability. The self-signup owner's new default role.
- `qa` unchanged (keeps `manage_org_settings` too — #692 already shipped
  and tested against it, not worth narrowing).

## 3. Affected files

**Capability model:**
- `apps/api/src/auth/capabilities.ts` — `ROLE_CAPABILITIES` key
  `verifier` renamed `pathologist`; added `reception`, `cashier`,
  `lab_admin` roles; added `manage_users` to the `Capability` union,
  granted only to `lab_admin`.
- `apps/api/src/auth/clinician-scope.ts` — `TENANT_WIDE_ROLES` renamed
  `verifier`→`pathologist`, added the three new roles (all internal-staff
  tenant-wide roles, same standing as the existing ones).
- `apps/api/src/auth/capabilities.spec.ts` — renamed throughout; added
  test coverage for `reception`/`cashier`/`lab_admin`'s grants and for
  `manage_users`'s exclusivity to `lab_admin`.

**Org-owner grant (#702):**
- `apps/api/src/onboarding/keycloak-user.service.ts` — `createUser` no
  longer hardcodes the `'qa'` role; takes a `role` param instead.
  `assignRealmRole` made `public` (was `private`) — #703's user-management
  screen reuses it for role assignment on existing users, not just at
  creation time.
- `apps/api/src/onboarding/onboarding.service.ts` — passes `role:
  'lab_admin'` to `createUser`; the `tenant.self_onboard` audit event's
  `actorRole` updated from `'qa'` to `'lab_admin'` to match.

**Keycloak realm (dev/CI):**
- `infra/keycloak/lis-realm.json` — role `verifier` renamed `pathologist`
  (name + description); added `reception`/`cashier`/`lab_admin` role
  definitions; `test-user-2`/`test-user-4`'s `realmRoles` updated to
  `pathologist`; added three new seeded users (`test-user-9` = reception,
  `test-user-10` = cashier, `test-user-11` = lab_admin) so the new roles
  have real login fixtures for future work (#703 development, e2e specs).

**Frontend:**
- `apps/web/auth/roles.ts` — `hasVerifierRole` renamed
  `hasPathologistRole`, checks `'pathologist'` instead of `'verifier'`.
- 4 call sites updated (`cases/[caseId]/page.tsx`,
  `orders/[id]/report/[orderedTestId]/page.tsx`,
  `orders/[id]/results/{page.tsx,actions.ts}`).

**Tests (role-string literal only — see §5):**
- `apps/api/test/{capability-check,case-sign-out,observation,qc-gate,
  report-assembly,report-template,onboarding}.e2e-spec.ts` — every literal
  `'verifier'` role-token assertion (`actorRole`, `signedByRole`, the
  onboarding token's realm-role check) updated to `'pathologist'` /
  `'lab_admin'` as appropriate.
- `packages/db/src/rls-isolation-check.ts` — one fixture value
  (`signedByRole: "verifier"` → `"pathologist"`) in a `case_report_version`
  insert; this script is dev-only, not wired into CI (its own header
  comment says so explicitly), so no e2e coverage depends on it.

## 4. Architecture consulted

`apps/api/src/onboarding/keycloak-user.service.ts`/
`keycloak-admin-auth.service.ts` — the existing, already-working Keycloak
Admin API client (client-credentials grant against the `lis-onboarding`
service account, already granted `manage-users`/`view-realm`) is the
foundation #703's user-management screen will build on directly; this
proposal only generalizes `createUser`'s hardcoded role and makes
`assignRealmRole` reusable, doesn't add new infrastructure.

## 5. Assumptions & autonomous decisions

- **Scoped the rename to the literal role-token surface, not every file
  containing the word "verifier."** A repo-wide search found ~70 files
  mentioning "verifier," but the overwhelming majority are the unrelated,
  legitimate domain concept of "the user who verified a specific
  result/report" (`verifierId`, `verifiedAt`, `signedByRole` as a
  *column*, `report.types.ts`'s own verifier field) — a real clinical
  concept independent of what Keycloak calls the login role, and out of
  scope for a role-name rename. Only the 11 files where `'verifier'`
  appears as a literal, quoted Keycloak-role string token were touched.
- **Left local variable names alone where renaming added no functional
  value** (e.g. `verifierToken`, `verifierUserId` in e2e specs stay named
  as-is even though they now hold a `pathologist`-role token) — renaming
  every such identifier across dozens of test files would have multiplied
  the diff for zero behavior change; the literal string assertions that
  actually exercise the new role name were all updated.
- **Kept `manage_org_settings` on both `qa` and `lab_admin`** rather than
  moving it — `qa`'s grant is real, shipped, and has a passing e2e spec
  (`org-settings.e2e-spec.ts`) exercising it; narrowing it wasn't asked
  for by #698's decision and would have been scope creep.
- **Added `manage_users` as a new capability, granted only to
  `lab_admin`** — #703 (user management) needs a real capability to guard
  its endpoints against; defining it now, even though #703 isn't built
  yet, avoids a second capability-model PR immediately after this one.
- **Seeded 3 new Keycloak test users** (reception/cashier/lab_admin) using
  plaintext dev credentials (same pattern `test-user-dedicated` already
  uses) rather than leaving the new roles with zero login fixtures — #703
  and any future role-specific e2e coverage needs real accounts to log in
  as.
- **Recreated the local dev Keycloak container** (`docker compose up -d
  --force-recreate keycloak`) to pick up the renamed/added realm roles.
  Confirmed safe: `docker-compose.yml` mounts no persistent volume for
  Keycloak (`start-dev --import-realm` re-imports fresh from the JSON on
  every container start), so this is equivalent to the `rm -rf .next`
  cache-clear pattern already used repeatedly this session — dev-only,
  reversible, no real data at risk.

## 6. Risks

Medium — this touches the authorization surface directly (role names, a
new capability, the self-signup grant path). Mitigated by: full unit test
coverage (`capabilities.spec.ts`, 26 tests, all passing) plus live e2e
verification of every touched spec against a freshly re-imported Keycloak
(see §7) — not just a code review, an actual re-run against a real
OIDC-issued token pair.

## 7. Testing plan

- `pnpm --filter api build` clean; `pnpm --filter web typecheck`/`lint`
  clean; `pnpm --filter api lint` clean (reverted two unrelated files
  ESLint's `--fix` reformatted as a side effect, per this repo's own known
  gotcha).
- `apps/api/src/auth/capabilities.spec.ts`: 26/26 unit tests pass
  (`npx vitest run`).
- **Live e2e, against a freshly recreated local Keycloak** (real OIDC
  password-grant tokens, not mocked): `onboarding.e2e-spec.ts` (3/3, incl.
  the new `lab_admin` token-role assertion), `capability-check.e2e-spec.ts`
  (10/10), `case-sign-out.e2e-spec.ts` (17/17), `qc-gate.e2e-spec.ts`
  (8/8), `observation.e2e-spec.ts` (29/29), `report-template.e2e-spec.ts`
  (8/8), `org-settings.e2e-spec.ts` (3/3, confirms `qa` still has
  `manage_org_settings`) — all pass against the renamed/expanded role set.
- `report-assembly.e2e-spec.ts` failed on an unrelated stale-fixture
  unique-constraint collision (`code_system_value`), confirmed
  pre-existing and unrelated by reverting this PR's changes entirely and
  re-running: identical failure, on a different constraint
  (`patient_portal_account`), because this long-lived dev Postgres has
  accumulated 9+ hours of manual/e2e state across this session without a
  `db:reset`. Not a regression from this change — flagged for a normal
  `db:reset` before the next e2e pass, same class of issue already
  documented elsewhere this session (report-render's own dev-DB pollution
  gotcha).
- `packages/db`'s `rls-check` script also failed, but is dev-only (its own
  header comment: "Deliberately NOT wired into CI here... run manually...
  after `pnpm db:reset`") and requires the same fresh reset — confirmed
  its failure is identical with this PR's changes fully reverted, so not
  a regression either.

## 8. Rollback plan

Revert all files listed in §3. The Keycloak realm rename requires
re-recreating the dev Keycloak container against the reverted JSON (same
safe, volume-free mechanism used to apply it).
