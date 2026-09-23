# Implementation Proposal: Gate `auth/capability-check` proof controller out of production
Status: APPROVED
ADR: none (bug fix, mirrors an already-decided precedent in this same codebase)    Date: 2026-09-23    Backlog ID: #827

**Approved 2026-09-23** via the native options-prompt: "Approve as written."

## 1. Goal

`apps/api/src/auth/capability-check.controller.ts` (`CapabilityCheckController`) exists purely to
exercise the audit/capability-guard mechanism for `apps/api/test/capability-check.e2e-spec.ts`.
Four of its six routes (`enter-result`, `verify`, `enter-result-unaudited`,
`enter-result-forced-audit-failure`) insert real `patient`/`order` rows on every call. It is
registered unconditionally in `AuthModule` (`apps/api/src/auth/auth.module.ts`), with no
environment gate — unlike the Swagger docs route in `apps/api/src/main.ts`, already correctly
gated:

```ts
if (process.env.NODE_ENV !== 'production') {
  // ... SwaggerModule.setup('v1/docs', ...)
}
```

Real, currently-live impact: `deploy-staging.yml` runs the API with no `NODE_ENV=production` set
today (confirmed — grep of the workflow and `infra/docker-compose.staging.yml` finds no
`NODE_ENV` set on the `api` service), so this repo's staging deployment is not actually gated by
`NODE_ENV` today regardless of this fix; the exposure is real for any future/other deployment that
does set `NODE_ENV=production` (a production environment distinct from today's staging, or staging
itself once someone sets it), and the code should not rely on staging happening to leave it unset.
This proposal closes the gap the same way the Swagger precedent already established, rather than
leaving a second inconsistent pattern in the codebase.

## 2. Affected files

- `apps/api/src/auth/auth.module.ts` — register `CapabilityCheckController` conditionally
  (`NODE_ENV !== 'production'`), mirroring `main.ts`'s own Swagger gate. NestJS module
  `controllers` arrays are plain arrays evaluated at module-definition time, so the conditional is
  a plain `...(condition ? [CapabilityCheckController] : [])` spread, not a runtime guard.
- `apps/api/test/capability-check.e2e-spec.ts` — no change expected (CI's `build-and-test` job sets
  no `NODE_ENV`, so it defaults to non-production and the controller stays registered under test);
  add one new case asserting the controller's routes 404 when `NODE_ENV=production` is set, so a
  future regression is caught by the suite itself rather than relying only on code review.
- `apps/api/src/main.ts` — no change; cited only as the existing precedent.

## 3. Approach

Mirror the existing pattern exactly rather than inventing a second mechanism:

```ts
@Module({
  controllers: [
    AuthController,
    TenantCheckController,
    ...(process.env.NODE_ENV !== 'production' ? [CapabilityCheckController] : []),
  ],
  ...
})
```

The new e2e case boots a second `TestingModule` (or reuses the existing app-bootstrap helper) with
`NODE_ENV` forced to `'production'` for that one test, confirms `POST /auth/capability-check/verify`
returns 404, then restores the prior `NODE_ENV` value in an `afterAll`/`finally` so it cannot leak
into other specs in the same CI run (this is exactly the kind of env-mutation hazard AGENTS.md's
own shared-state warnings call out — restoring it explicitly avoids being the next entry in that
list).

## 4. Alternatives considered

- **Guard each route individually** (a `NODE_ENV` check inside each handler, returning 404/403).
  Rejected: more surface area to get wrong across six routes, and inconsistent with the one-line
  module-level precedent Swagger already set.
- **Delete the controller and rewrite its e2e spec against a different mechanism.** Rejected: out
  of scope — the controller has legitimate test value (`capability-check.e2e-spec.ts` proves the
  audit/capability interceptor chain), just not a legitimate production-reachability need.

## 5. Testing plan

- `pnpm --filter api test:e2e -- capability-check` — existing spec continues to pass unmodified.
- New case: `NODE_ENV=production` → the controller's routes are unreachable (404).
- `pnpm typecheck && pnpm lint` on `apps/api`.

## 6. Risk

Low. Single conditional in one module's `controllers` array; the existing e2e spec's own real
Postgres/Keycloak harness will catch any typo immediately (route disappearing when it shouldn't, or
vice versa).

## 7. Open questions

None — this is a direct application of an already-decided precedent in the same file (Swagger's own
gate), not a new design decision.
