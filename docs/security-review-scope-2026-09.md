# Independent Security Review — Scope & Existing Evidence

**Date:** 2026-09-24. **Prepared as part of:** Phase 1, Workstream 4 of
`docs/world-class-execution-plan-8-2026-09.md`. **Purpose:** organize existing internal evidence and
identify exactly what an external, independent reviewer would still need to establish — not to
claim an independent review has occurred. No independent review has occurred. This document exists
to make commissioning one fast and well-scoped when Mathew decides to pursue it (§11 of the
execution plan lists this as requiring Mathew's action — procurement of an external party).

---

## How to read this document

For each area: **what already exists** (with the concrete evidence, dated), **what internal
verification has already occurred**, and **what an external reviewer would still need to check
independently** — because internal verification, however careful, is not the same as independent
assurance, and this document does not conflate the two.

---

## 1. Authentication

**Exists:** Keycloak 26.0, OIDC authorization-code flow with PKCE (`pkce.code.challenge.method:
S256`), real password-grant tokens for machine clients, `httpOnly`/session cookies signed
server-side (`apps/web/auth/session.ts`, HS256, a >=32-byte secret enforced at boot).

**Internally verified:** `access-token.spec.ts`/`session.spec.ts` (real Keycloak token exchange, not
mocked); brute-force protection and a minimal password policy added and verified live
2026-09-24 (Phase 0); `auth.e2e-spec.ts` covers unauthenticated-request rejection.

**External reviewer should check:** session-fixation resistance, PKCE downgrade attacks, token
replay window (`accessTokenLifespan: 300`s — is this appropriate for the threat model), whether
`ssoSessionMaxLifespan: 36000`s (10h) is an intentional choice for a clinical shift-based system,
CSRF posture on any state-changing GET (if any exist), and the real Keycloak admin console's own
access controls in production (not covered by this codebase's own tests at all).

## 2. Authorization / RBAC

**Exists:** an 11-role capability model (`technologist`, `pathologist`, `qa`, `reception`,
`cashier`, `lab_admin`, `clinician`, `patient`, plus 3 machine roles), enforced via
`CapabilityGuard`/`@RequireCapability()` decorators, fail-closed for unrecognized roles (ADR-0011).

**Internally verified:** `capability-check.e2e-spec.ts` (10 real scenarios including the fail-closed
case), `rbac-matrix.e2e-spec.ts`, `clinician-scope.e2e-spec.2` (external clinician scoping to only
patients with a `care_relationship` row).

**External reviewer should check:** privilege-escalation paths through any capability combination
not covered by the existing matrix test, IDOR on every `:id`-parameterized route (a systematic
sweep, not spot-checks), and whether the capability model is complete against every real mutation
route in `apps/api/src` (an external reviewer should independently enumerate routes and cross-check
guards, not trust the existing test suite's own coverage claim).

## 3. Tenant isolation

**Exists:** PostgreSQL RLS on every tenant-scoped table (56 of 74 total tables — the 18 without RLS
are all either non-tenant-scoped reference/catalog tables or the `tenant` table itself, per
`db/migrations`' own `ENABLE ROW LEVEL SECURITY` statements), a `lis_app` role with `NOBYPASSRLS`.

**Internally verified:** a dual structural-sweep + live cross-tenant-write leak check
(`packages/db/src/rls-isolation-check.ts`), run as its own dedicated CI job against a fresh Postgres
specifically to avoid the false-negative risk of a shared, e2e-polluted database.

**External reviewer should check:** whether `current_setting('app.tenant_id')` can be spoofed or
left unset under any real connection-pooling misconfiguration (this codebase's own AGENTS.md
documents having already tested and closed one such gap — TASK-030 — an external reviewer should
independently attempt to reproduce that class of issue against the current code, not assume it
stays closed), and whether any raw SQL (`db.execute(sql\`...\`)`) call anywhere in `apps/api/src`
bypasses the ORM's own RLS-respecting query builder.

## 4. PostgreSQL RLS (detail beyond §3)

**Exists:** `CREATE POLICY "tenant_isolation" ... USING (tenant_id = current_setting('app.tenant_id')::uuid)`
on every tenant-scoped table, no `FORCE ROW LEVEL SECURITY` (meaning the table owner itself could
bypass RLS — but `lis_app`, the application's own connection role, is never the table owner and has
`NOBYPASSRLS`, so this is not believed to be a real gap, but should be independently confirmed).

**External reviewer should check:** the table owner's own actual role (superuser/migration role vs.
`lis_app`) in the real production database, since `FORCE ROW LEVEL SECURITY`'s absence only matters
if the owner role itself is ever used for application traffic.

## 5. API exposure

**Exists:** Fastify with `@fastify/helmet` (baseline security headers, `contentSecurityPolicy:
false` deliberately — API returns only JSON), Swagger docs gated to non-production
(`NODE_ENV !== 'production'`), the capability-check proof controller now similarly gated (issue
#827/PR #828).

**External reviewer should check:** rate limiting (none currently exists — not flagged as a Phase 0/1
finding because no evidence of abuse exists yet, but a reviewer should assess whether this is
acceptable for a pilot), request-size limits beyond Fastify's own defaults, and a full route
enumeration cross-checked against intended public/private/internal-only exposure.

## 6. Patient-data handling

**Exists:** Constitution Law #1 (no clinical value as free text — structured, coded Observations)
and Law #2 (verified data append-only) are both enforced at the database layer via triggers
(`fn_observation_append_only`), not just application code.

**External reviewer should check:** whether any log line, error message, or Sentry event (once
Sentry verification is unblocked — see Workstream 3) could leak PHI; whether `problem-details.filter.ts`
(the global exception filter) ever serializes a raw exception message containing patient data back
to a client.

## 7. Audit trail

**Exists:** a SHA-256 hash chain per tenant (`packages/db/src/audit.ts`), `REVOKE UPDATE, DELETE` on
`audit_event` from the app role, a concurrency-tested chain-integrity verifier
(`audit-chain-concurrency-check.ts`).

**Internally verified:** real interleaved-write concurrency test; `capability-check.e2e-spec.ts`'s
own hash-chain-validity assertions.

**External reviewer should check:** whether the hash chain's own `prevHash` lookup
(`ORDER BY sequence DESC LIMIT 1`) is provably race-free under the actual production connection pool
size (the internal test uses a controlled concurrency count — an external reviewer should attempt a
higher-concurrency adversarial test), and whether an attacker with direct database access (not
`lis_app`, but a compromised superuser/migration credential) could rewrite the chain undetected
(this is a real, inherent limitation of an application-level hash chain vs. a write-once storage
medium — worth an explicit risk acceptance, not a silent gap).

## 8. Report integrity / signatures

**Exists:** HMAC-SHA256 signed `case_report_version` rows, database-enforced append-only + a
dedicated case-status transition-guard trigger, content-hash pinning that excludes incidental PDF
metadata.

**External reviewer should check:** the `SIGNING_SECRET`'s own rotation story (none currently
exists — a fixed secret for the life of the deployment) and blast radius if it ever leaks (every
past signature becomes unverifiable-vs-forgeable, a real, currently-unaddressed risk worth an
explicit decision, not silence).

## 9. File/document handling

**Exists:** self-hosted MinIO (S3-API-compatible) for image attachments and WSI tiles, via the real
`@aws-sdk/client-s3`.

**External reviewer should check:** bucket policy/ACL configuration on the real MinIO instance
(not covered by any test in this repo — tests exercise the application's own upload/download logic
against a local MinIO, not the actual access-control configuration a production MinIO instance
would need), and whether any upload path allows path traversal in object keys (a real, previously
found and fixed class of bug in this exact codebase — the WSI zip-unzip backslash-path fix,
`docs/plans/task-wsi-backslash-path-fix.md` — worth an independent re-check that the fix's scope was
complete, not just its own reported test case).

## 10. Dependency security

**Exists:** `pnpm audit` run and acted on twice this session (Phase 0: 53→41; Phase 1 Workstream 1:
41→28, 0 critical throughout both). No CI-enforced dependency-scanning gate exists yet (both audits
were manual, ad hoc runs this session, not a recurring check).

**External reviewer should check:** independently re-run `pnpm audit` (and ideally a second tool,
e.g. `osv-scanner` or GitHub's own Dependabot, for cross-validation against `pnpm audit`'s own
advisory database) against whatever commit is live at review time — this document's own numbers are
already stale the moment new advisories are published.

## 11. Keycloak

**Exists:** `start-dev --import-realm` locally, `start --import-realm` in production (confirmed via
`infra/docker-compose.staging.yml`), brute-force protection and a password policy added 2026-09-24.
Committed dev-only client secrets (`dev-only-lis-*-secret`) are stripped from the realm export
before it reaches staging (`deploy-staging.yml`'s own `jq 'del(.users)'` step, plus separate
deploy-time secret rotation for the machine clients).

**External reviewer should check:** the real production Keycloak's own admin-console access
controls (who can reach `/admin`, over what network path), and whether `unmanagedAttributePolicy:
ENABLED` (needed for the `tenant_id` custom attribute) has any broader unintended effect on which
attributes a user can self-edit.

## 12. Deployment / network exposure

**Exists:** a single DigitalOcean droplet, Tailscale-mesh-only reachability (no public-internet
exposure for the API/Keycloak-admin/Postgres/MinIO ports — confirmed via the firewall rules in
`infra/main.tf` and the `ports: ["127.0.0.1:8080:8080"]` binding in the staging compose file),
HTTPS via `tailscale serve`.

**External reviewer should check:** the actual current firewall state on the live droplet (Terraform
describes intent — an external reviewer should independently confirm the applied state matches),
and Tailscale ACL configuration (who/what can join the tailnet and reach the droplet).

## 13. Secrets / configuration

**Exists:** secrets injected at deploy time via GitHub Actions secrets, never baked into images
(`docker-build-placeholder-not-a-real-secret` is the deliberate build-time placeholder, confirmed in
`deploy-staging.yml`); per-tenant SMTP app passwords encrypted at rest (AES-256-GCM,
`packages/db/src/secret-encryption.ts`).

**External reviewer should check:** GitHub Actions secrets' own access-control (who on the GitHub
org can view/rotate them), and whether `SETTINGS_ENCRYPTION_KEY`'s own rotation story exists (same
class of gap as `SIGNING_SECRET`, §8).

## 14. Backup / restore

**Exists:** a `pg_dump` cron script and a real automated restore-drill script
(`infra/scripts/{backup-staging-db.sh,restore-drill.sh}`), both documented as **manual runbook
installs** (a human must SSH in and run `crontab`), not deploy-automated.

**Status as of this session:** genuinely unverified whether either cron job has ever actually run on
the real production droplet — see Phase 1 Workstream 2's own blocker report (droplet SSH access not
available to this session). **This is the single largest open item for an external reviewer to
prioritize**, since it is currently unproven in either direction.

## 15. Logging / observability

**Exists:** Sentry wired via `SENTRY_DSN` (staging compose), structured JSON logging (Fastify's
built-in `pino` logger, confirmed live this session).

**Status as of this session:** Sentry production-event receipt is genuinely unverified — see Phase 1
Workstream 3's own blocker report (no credentials/access to the real Sentry project from this
session).

**External reviewer should check:** whether any log line anywhere (API request logs, Sentry
breadcrumbs) could leak PHI — Fastify's request logging includes the full request object by default
in some configurations; this codebase's own logging configuration should be independently audited
for exactly what fields are actually serialized.

---

## What already exists vs. what an external reviewer still needs (summary)

| Area | Internal evidence exists | External verification still needed |
|---|---|---|
| Authentication | Strong (E2-E3) | Session/PKCE edge cases, admin-console access controls |
| Authorization/RBAC | Strong (E2-E3) | Independent route-by-route IDOR sweep |
| Tenant isolation | Strong (E2-E3, dual CI check) | Connection-pool spoofing re-test, raw-SQL bypass sweep |
| RLS | Strong | Real production table-owner role confirmation |
| API exposure | Moderate (E1-E2) | Rate limiting assessment, full route inventory |
| Patient-data handling | Strong at the schema layer | Log/error/Sentry PHI-leakage audit |
| Audit trail | Strong (E2-E3) | Adversarial concurrency test, DB-superuser threat model |
| Report integrity | Strong (E2-E3) | Signing-secret rotation/blast-radius decision |
| File handling | Moderate (E1-E2) | Real MinIO ACL audit, path-traversal re-check |
| Dependency security | Actively managed this session | Independent re-scan, second tool cross-check |
| Keycloak | Hardened this session | Real admin-console access-control check |
| Deployment/network | Strong by design (E4) | Live firewall/Tailscale ACL confirmation |
| Secrets | Sound design | Rotation story for signing/encryption keys |
| **Backup/restore** | **Unverified in production** | **Highest-priority item — currently unproven** |
| **Observability** | **Unverified in production** | **Sentry receipt confirmation** |

The two bolded rows are not security *design* gaps — they are **proof** gaps, identical in kind to
this whole execution plan's own central finding (§2 of the main document): this system has more
engineering than it has evidence. An external security reviewer should be told this plainly rather
than discovering it independently and wondering why internal review missed it — it didn't miss it;
it's already the plan's own headline finding.
