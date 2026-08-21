# Implementation Proposal: Minimal user management (create/list/deactivate/assign role)
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #703 (part of EPIC #697)

## 1. Goal

Per #703's own AC: close the original pilot-readiness audit's #2 finding
(no UI anywhere to create/list/deactivate/role-assign a second staff
account) now that #701/#702 ship a real role model and a working org-owner
grant. A fresh self-signup org owner (`lab_admin`) can now add a second
staff account without developer involvement — the whole point of #701/#702
being fixed was to make this screen possible.

## 2. Affected files

**Domain:**
- `packages/domain/src/user-management.ts` (new) — `ASSIGNABLE_STAFF_ROLES`
  (the 6 human staff roles this screen manages: reception, technologist,
  pathologist, qa, cashier, lab_admin — deliberately excludes `clinician`/
  `patient`, provisioned through their own distinct external flows, and
  every machine role), `userSummarySchema`, `createUserSchema`,
  `updateUserRoleSchema`, `updateUserEnabledSchema`.

**API (`apps/api/src/user-management/`, new module):**
- `user-management.service.ts` — the tenant-ownership check every mutation
  needs (`requireUserInTenant`), list/create/role-change/enable-disable,
  layered over `KeycloakUserService` (a thin, tenant-unaware Keycloak Admin
  API wrapper) the same way `OnboardingService` already is.
- `user-management.controller.ts` — `GET/POST /v1/users`,
  `PATCH /v1/users/:id/role`, `PATCH /v1/users/:id/enabled`. Every route
  `manage_users`-gated per-method (matches this codebase's own established
  convention of gating route-by-route, never at the class level). GET is
  gated too, unlike `OrgSettingsController`'s ungated GET — a user list is
  real identity data, not an informational preference.
- `user-management.module.ts` — imports `OnboardingModule` to reuse its
  Keycloak admin client rather than duplicating one.
- `apps/api/src/onboarding/keycloak-user.service.ts` — extended with
  `listUsersByTenant`, `getUser`, `listRealmRoles`, `removeRealmRoles`,
  `setEnabled`; `assignRealmRole` already made public in #701/#702's own
  PR specifically so this module could reuse it.
- `apps/api/src/onboarding/onboarding.module.ts` — exports
  `KeycloakAdminAuthService`/`KeycloakUserService` so `UserManagementModule`
  can inject them.
- `apps/api/src/app.module.ts` — registers `UserManagementModule`.

**Frontend (`apps/web/app/(app)/admin/users/`, new):**
- `page.tsx` — Server Component, list + create form, gated by the new
  `hasLabAdminRole` helper (UI-visibility convenience only; `manage_users`
  on the API route is the real enforcement point).
- `users-table.tsx` — `DataTable` client wrapper (same Server→Client
  function-prop reasoning as `referring-facilities-table.tsx`'s own header
  comment) with two real inline mutations per row (role `<select>`,
  activate/deactivate button), each using `useTransition` +
  `router.refresh()` — the same simple pattern `ThemeToggle`/`LocaleSelect`
  already establish for "a small control mutates server state, reflect it
  immediately."
- `create-user-form.tsx`, `actions.ts`, `types.ts` — mirrors
  `admin/referring-facilities`'s own create-form shape exactly.
- `apps/web/auth/roles.ts` — added `hasLabAdminRole`; also fixed
  `hasPatientManagementRole`/`hasBillingRole` to include `reception`/
  `cashier` respectively (both now genuinely carry those capabilities per
  #701 but the helpers hadn't been updated yet — a real, if minor,
  inconsistency introduced by #701 that this PR closes since it's directly
  touching the same file).
- `apps/web/app/(app)/_components/sidebar.tsx` — "Users" nav entry added,
  same not-role-filtered-at-nav-level convention as every other admin
  entry (`GET /v1/users`'s own capability guard is the real gate).
- `apps/web/messages/{en,fr}.json` — `users` label added.

## 3. Architecture consulted

`apps/api/src/org-settings/org-settings.controller.ts` (the
`TenantContextInterceptor`/`AuditInterceptor`/`@Audit()` wiring pattern for
a mutation that needs an audit row but whose actual state doesn't live in
a queryable-through-`tx` shape); `apps/api/src/onboarding/*` (the existing,
working Keycloak Admin API client, reused rather than duplicated);
`admin/referring-facilities/*` (the closest existing list+create screen
shape); `ThemeToggle`/`LocaleSelect` (the inline-mutation pattern for
`users-table.tsx`'s row actions).

## 4. Skills loaded

`engineering/api-design` (new controller/service/module, capability-gated
mutating routes); `engineering/frontend-design` (new `apps/web` admin
screen, Server→Client function-prop discipline for `DataTable`).

## 5. Assumptions & autonomous decisions

- **No local `user` table exists in this codebase** — Keycloak is the sole
  source of truth for user records (confirmed: no `user`/`users` table in
  `packages/db/src/schema`). Every mutation in this feature is a live
  Keycloak Admin API call, not a Postgres write; the `TenantContextInterceptor`/
  `AuditInterceptor` machinery is used purely so `AuditInterceptor` has a
  transaction to write the `audit_event` row through, exactly mirroring
  `OnboardingService`'s own accepted ordering risk (Keycloak call first; a
  failure in the follow-up audit write leaves a real, correct Keycloak
  change with no matching audit row — harmless and discoverable, never the
  reverse).
- **Genuine bug found and fixed during live verification, not just code
  review:** `GET /v1/users`'s tenant-attribute search
  (`q=tenant_id:<id>`) also matched Keycloak service-account users
  (`service-account-lis-gateway`, etc.), which carry no `email`/
  `firstName`/`lastName` in this realm — would have broken
  `UserSummary`'s required fields and rendered "undefined undefined" rows.
  Filtered to records with a real `email` before mapping to
  `UserSummary`, confirmed live afterward (9 real staff accounts, 0
  service accounts, in the list response).
- **Tenant-ownership check on every id-scoped mutation** (`requireUserInTenant`)
  — a `PATCH /v1/users/:id/...` id has no other tenant scoping mechanism
  (Keycloak isn't Postgres; no RLS). Verified live, not just reasoned
  about: a real tenant-A `lab_admin` token against a real tenant-B user's
  id returned 404 (never leaking that the id exists in another tenant),
  while the same call against its own tenant's user succeeded.
- **Role change replaces, doesn't additively grant** — `changeRole` first
  removes any currently-held role from within `ASSIGNABLE_STAFF_ROLES`
  before assigning the new one, so a user always holds exactly one of the
  6 managed staff roles (never accumulates `reception` + `cashier` + ...
  from repeated changes), while never touching any role outside that set
  a user might independently hold (defensive, though nothing in this
  codebase currently grants a human user both a staff role and something
  else).
- **Deactivate, not delete** — matches #703's own AC and the platform's
  append-only/audit posture elsewhere; `setEnabled(false)` via Keycloak's
  partial-body `PUT`, confirmed live to only change `enabled` and leave
  role assignments untouched.
- **Fixed two stale role-check helpers while already in `roles.ts`**
  (`hasPatientManagementRole`, `hasBillingRole`) to include the new
  `reception`/`cashier` roles from #701 that genuinely carry those
  capabilities — a real, if minor, inconsistency #701 introduced;
  reasonable to close now rather than leave a known-stale helper behind.

## 6. Risks

Medium — a new mutating admin surface with real tenant-isolation
implications. Mitigated by full live verification against a real
Keycloak/Postgres (see §7), not just unit/type coverage, specifically
including the cross-tenant-id and wrong-capability negative cases.

## 7. Testing plan

- `pnpm --filter @lis/domain build`, `pnpm --filter api build` clean.
- `pnpm --filter web typecheck`/`lint` clean; `pnpm --filter api lint`
  clean (reverted the two unrelated files ESLint's `--fix` reformats as a
  known side effect).
- OpenAPI → SDK regen chain run end-to-end (`generate-openapi` →
  `packages/sdk` `generate`+`build`) so `apps/web` has real, typed routes
  for `/v1/users` and its sub-paths.
- **Live verification, real API + Keycloak + Postgres, no mocks:**
  - `GET /v1/users` as `lab_admin` (test-user-11): 9 real staff accounts
    returned, 0 service accounts (after the filter fix above).
  - `POST /v1/users` (role: reception): real Keycloak user created; real
    `audit_event` row written (`user.create`, `actorRole: lab_admin`).
  - `PATCH /v1/users/:id/role` (reception → cashier): role correctly
    swapped (verified via a follow-up `listRealmRoles` call inside the
    same response's `before`/`after`); real `audit_event` row
    (`user.role_change`).
  - `PATCH /v1/users/:id/enabled` (true → false): correctly flips only
    `enabled`, role list unchanged; real `audit_event` row
    (`user.set_enabled`).
  - Negative cases: `GET /v1/users` with no token → 401; as `technologist`
    (no `manage_users`) → 403; `PATCH .../enabled` on a real tenant-B
    user's id, called with a tenant-A `lab_admin` token → 404 (tenant
    isolation, not just "not found for a made-up id" — confirmed against
    `test-user-2`'s real Keycloak id).
  - `apps/web`'s `/admin/users` page: real SSR HTML fetched via a signed
    session cookie (real Keycloak-issued token pair inside it, per
    `web-verify` Skill's documented recipe) — confirmed the list, the
    just-created test user, and the create form all render for `lab_admin`;
    confirmed the "you do not have permission" fallback renders for
    `technologist` instead of the list/form.
  - Test fixture user deleted from Keycloak after verification, not left
    behind.

## 8. Rollback plan

Revert all files listed in §2. No schema/migration to roll back (no new
Postgres tables — this feature's state lives entirely in Keycloak).
