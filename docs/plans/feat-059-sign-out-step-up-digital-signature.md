# Implementation Proposal: FEAT-059 — Human sign-out, step-up authentication & digital signature
Status: IMPLEMENTED (PR #559, merge commit f6122df6715978826371fba4f87d1a2f14defb0f)
ADR: ADR-0051 (mandatory human verification + step-up-bound digital signature — accepted)
Date: 2026-08-12    Backlog ID: #544 (FEAT-059, depends on FEAT-057 #538, ADR-0051)

**Approved 2026-08-12** via the native options-prompt — all four §10 questions answered with the
Recommended option as drafted: (1) forced re-login only (`prompt=login`, no MFA infra exists), (2)
server-held HMAC-SHA256 signature, (3) new `caseReportVersion` table, (4) 300s freshness window
matching the realm's own `accessTokenLifespan`.

## 1. Goal

No auto-verify path exists for anatomic pathology reports (ADR-0051): every AP case sign-out
requires an explicit `finalize` action by a credentialed pathologist, gated by **step-up
authentication** (a fresh re-authentication, not just an active session), cryptographically bound
to a digital signature on the specific report-version's content hash. This is the first feature to
actually implement step-up auth in code — KB-09 already describes the intended mechanism, but no
`stepUp` implementation exists anywhere in `apps/api` yet (`engineering/authentication` Skill entry
#17's own "Not (yet) covered" list). Every later step-up-requiring action (amend, break-glass)
reuses what this feature builds.

Concretely, this replaces FEAT-057's own placeholder: `POST /v1/cases/:id/finalize` today is "a
schema-only status transition, not the real step-up-signed sign-out (FEAT-059)" (its own header
comment, `apps/api/src/case/case.controller.ts`). This feature makes it the real thing, and
introduces the actual signed, versioned report artifact FEAT-057 deferred ("`report.ts` most
naturally gains Case-awareness alongside the content it will actually be signing... FEAT-059",
`docs/plans/feat-057-case-specimen-block-slide-hierarchy.md` §5).

## 2. Affected files

**Step-up authentication (apps/web):**
- `apps/web/app/api/auth/login/route.ts` — accept an optional `?step_up=1` query param; when
  present, add `prompt: 'login'` to `client.buildAuthorizationUrl(...)`, forcing Keycloak to
  re-authenticate the user even though a valid SSO session already exists. No other change to the
  PKCE/callback machinery — `callback/route.ts` already re-signs the session with whatever fresh
  tokens come back, so a forced-reauth round trip through the *existing* login→callback flow is
  sufficient; no new route, no new cookie shape.
- `apps/web` sign-out confirmation UI (new page/Server Action under `apps/web/app/cases/[id]/`,
  exact path confirmed at implementation time against this repo's existing case-detail routing, if
  any exists yet) — presents the case lineage/synoptic summary, and on confirm, redirects through
  `/api/auth/login?step_up=1&rd=<return-to-this-page>` if the current token's `auth_time` is stale,
  then calls the new finalize route via `getValidAccessToken()`.

**Freshness plumbing (apps/api):**
- `apps/api/src/auth/jwt-auth.guard.ts` — parse `payload.auth_time` (already mapped onto the access
  token by the realm's existing `oidc-usersessionmodel-note-mapper`, confirmed directly in
  `infra/keycloak/lis-realm.json`: `"claim.name": "auth_time"`, `"access.token.claim": "true"` — no
  realm change needed) and carry it into `RequestContext` as `authTime: number` (epoch seconds).
- `apps/api/src/auth/request-context.ts` — add `authTime: number`.
- `apps/api/src/auth/step-up.guard.ts` (new) — `StepUpGuard` + `@RequireStepUp()` decorator (mirrors
  `CapabilityGuard`/`@RequireCapability`'s existing shape). Throws a `403` Problem Details response
  with a machine-readable `type`/`code` (`step_up_required`) when `now - authContext.authTime` exceeds
  `STEP_UP_MAX_AGE_SECONDS`, so `apps/web` can react to that specific code by redirecting into the
  `?step_up=1` login flow rather than treating it as an ordinary auth failure.
- `apps/api/src/auth/step-up-freshness.ts` (new) — `checkStepUpFreshness(authTime, now, maxAgeSeconds)`,
  a pure function (same "pure gate, DB-free, unit-testable" split `auto-verify-gates.ts` already
  established) — the actual boundary logic `StepUpGuard` calls.

**Digital signature + versioned AP report (packages/db, apps/api):**
- `packages/db/src/schema/anatomic-pathology.ts` — new `caseReportVersion` table (tenant-scoped,
  RLS): `id`, `tenantId`, `caseId` (FK → `case`), `versionNumber`, `contentHash` (sha256 hex, same
  `stableStringify` convention as `report.contentHash`), `includedContent` jsonb (case lineage
  snapshot + synoptic response ids, mirroring `report.includedObservations`'s own precedent),
  `signature` (bytea, HMAC-SHA256), `signedByUserId`, `signedByRole`, `authTimeUsed`
  (timestamptz — the actual `auth_time` claim value the signature is bound to), `reason` (nullable,
  required for amendments), `supersededBy` (nullable self-FK), `status` (`'final'` |
  `'superseded'`, CHECK-constrained).
- `db/migrations/00XX_case_report_version.sql` (new, generated) — the table above, plus a
  BEFORE UPDATE append-only trigger and an AFTER INSERT supersede trigger, adapting
  `fn_observation_append_only`/`fn_observation_supersede`'s existing pattern
  (`db/migrations/0007_observation_append_only_trigger.sql`) to this table: once a version is
  signed, its `contentHash`/`signature`/`includedContent` become immutable; inserting a new version
  for the same case auto-sets the prior `final` version's `supersededBy`.
- `packages/db/src/case-report-signature.ts` (new) — `computeCaseReportContentHash(content)` (reuses
  `stableStringify` from `packages/db/src/audit.ts`), `signCaseReportContent(canonicalContent,
  actorPrincipalId, authTimeUsed)` → HMAC-SHA256 via a new `SIGNING_SECRET` env var (`apps/api`-side,
  same `requiredSecret`-style ≥32-byte enforcement as `apps/web/auth/secret.ts`'s
  `getSessionSecret()`, read fresh per call not memoized at module scope — same lesson that file's
  own header comment already documents).
- `apps/api/src/case/case.controller.ts` — `finalize()` rewritten:
  - Gate changed from `@RequireCapability('manage_specimens')` to `@RequireCapability('verify')` +
    new `@RequireStepUp()` — `verify` already exists and is granted only to the `verifier` role
    (`apps/api/src/auth/capabilities.ts`), the same gate the existing chemistry `report.controller.ts`
    `generate()` route already uses for its own "final, clinically-signed artifact."
  - Keeps FEAT-057's existing lineage-completeness check (every part has ≥1 active block, every
    block has ≥1 active slide) and the existing `case.status → 'signed_out'` transition — unchanged.
  - Additionally: builds the case's `includedContent` (lineage + synoptic responses recorded for
    this case, via FEAT-058's schema), computes `contentHash`, computes `signature`, inserts the
    `caseReportVersion` row, writes one `writeAuditEvent` (`action: 'case.sign_out'`) in the same
    transaction with `context.step_up: { authTime, method: 'reauthentication' }` — matching KB-11's
    documented `context.step_up?` field, already reserved in `audit.ts`'s own schema comment.
- `apps/api/src/case/case.controller.ts` — new `POST v1/cases/:id/amend` route: same
  `@RequireCapability('verify')` + `@RequireStepUp()` gates (AC #3: "requires its own independent
  step-up + signature"), requires a body `reason`, requires the case to currently be `signed_out`,
  creates a new `caseReportVersion` (`versionNumber + 1`), the trigger auto-supersedes the prior
  version, sets `case.status = 'amended'` (an already-existing, currently-unused CHECK value from
  FEAT-057's own schema).
- `apps/api/src/case/case-report-signature.spec.ts` (new) — unit tests for hash determinism and the
  freshness boundary (`checkStepUpFreshness`).
- `apps/api/test/case-sign-out.e2e-spec.ts` (new) — covers all 4 issue ACs against a real Postgres +
  Keycloak.
- `packages/db/src/rls-isolation-check.ts` — fixture for `case_report_version` (the recurring
  #430/#534/#536 miss pattern — do not repeat it a fourth time).
- `packages/domain/src/anatomic-pathology.ts` — `caseReportVersionSchema`, `caseAmendRequestSchema`.
- `apps/api/.env.example`, `apps/api/.env` (local only, not committed with a real value) —
  `SIGNING_SECRET`.
- `engineering/authentication` Skill — new entry documenting the step-up mechanism actually built
  here (AGENTS.md's same-day Skill-extension rule).

## 3. Architecture consulted

- **ADR-0051** — the accepted decision this proposal implements (no auto-verify for AP; step-up
  required for finalize; signature bound to a fresh step-up assertion + the report-version's content
  hash; amendments are new versions via `superseded_by`).
- **KB-09 Authentication** — step-up section, the "pathologist sign-out" example.
- **KB-11 Audit Logging** — `audit_event.context.step_up?` (already a named, reserved field in this
  repo's own schema comment, `packages/db/src/schema/audit.ts`), hash-chain tamper-evidence model
  reused here for the signature's own security posture (see §5).
- **KB-17 Histology** — sign-out requirement.
- **`engineering/authentication` Skill** (17 entries, loaded in full) — entry #17 confirms MFA/step-up
  is "Not (yet) covered here"; this feature's own findings become its first real content.
- **`domain/result-verification` Skill** (8 entries, loaded in full) — FEAT-015's append-only/amendment
  trigger machinery (`fn_observation_append_only`/`fn_observation_supersede`), reused structurally
  for the new `case_report_version` table; confirms no public HTTP route today accepts an
  amendment-style input — this feature is the first.
- **`docs/plans/task-265-session-token-bridge.md` + `apps/web/auth/session.ts`/`access-token.ts`**
  (read in full this session) — the real session/token architecture: `apps/web` retains the actual
  Keycloak `access_token`/`refresh_token`, `getValidAccessToken()` silently refreshes via
  `refreshTokenGrant` before expiry. Critically, **a silent refresh does not re-authenticate the
  user** (no password/MFA re-entry, no `auth_time` change) — confirmed by reading the OIDC
  refresh-grant flow directly, not assumed. Step-up therefore cannot be satisfied by the existing
  refresh path; it needs a genuinely new interactive round trip (`prompt=login`).
- **`infra/keycloak/lis-realm.json`** — confirmed directly: an `auth_time` protocol mapper already
  exists (`oidc-usersessionmodel-note-mapper`, sourced from the `AUTH_TIME` user-session note,
  `access.token.claim: true`), so `apps/api`'s bearer JWT already carries `auth_time` today with
  zero realm changes required. Also confirmed: no MFA/OTP/WebAuthn required-action or authentication
  flow is configured in this realm (see §5).
- **`apps/api/src/auth/jwt-auth.guard.ts`** (read in full) — current stateless, per-request JWT
  verification (`jose` + remote JWKS), no session store, no existing `auth_time` check.
- **`apps/api/src/auth/capabilities.ts`** (read in full) — `verify` capability already exists,
  granted only to the `verifier` role; reused here rather than inventing a new capability, matching
  the existing chemistry `report.controller.ts generate()` precedent exactly (`@RequireCapability('verify')`
  gating "this feature's own final, clinically-signed artifact").
- **`packages/db/src/schema/report.ts` + `apps/api/src/report/report.controller.ts`** (read in full)
  — the existing content-hash/generate precedent for chemistry (`report.contentHash`,
  `includedObservations`, `TASK-058`'s `computeReportContentHash`/`stableStringify`). Deliberately
  **not** reused directly — FEAT-057 already named this table's Case-awareness as future work for
  FEAT-058/059, and AP's content (case lineage + synoptic responses) is structurally different from
  chemistry's per-`ordered_test` observation set. See §5.
- **`packages/db/src/audit.ts`** (read in full) — `stableStringify`/hash-chain pattern, reused for
  the new signature's canonicalization step so both mechanisms serialize identically.
- **`apps/api/src/auto-verify/*`** (read in full: `auto-verify-gates.ts`,
  `auto-verify-observation.command.ts`) — confirms auto-verify triggers only on `ObservationFinalized`
  and only ever mutates `observation.status`, unconditionally re-checking four gates
  (`critical`/`not_clean_normal`/`not_analyzer`/`qc_held`) against *live* DB state regardless of any
  rule's own `when`. It has no code path that reaches `case`/`caseReportVersion` at all — verified
  directly, not assumed (see §5 for how AC #4 is satisfied and additionally tested).
- **`apps/web/auth/secret.ts`** (read in full) — the exact secret-handling convention
  (`requiredSecret`, ≥32-byte enforcement, read-fresh-per-call not module-scope-memoized, given that
  file's own documented build-time-vs-runtime `process.env` bundling bug) mirrored for the new
  `SIGNING_SECRET`.

## 4. Skills loaded

`engineering/authentication` (full, 17 entries), `engineering/authz` (full), `domain/result-verification`
(full, 8 entries).

## 5. Assumptions & autonomous decisions

- **Step-up = forced re-authentication (`prompt=login`), not a second MFA factor.** This realm has
  no MFA/OTP/WebAuthn configured at all (confirmed directly in `infra/keycloak/lis-realm.json` — no
  matching required-action or flow entries — and independently corroborated by
  `engineering/authentication` Skill entry #17's own "not yet covered" list). KB-09's own phrasing
  covers "a fresh re-authentication/stronger-factor assertion" as alternatives, not a mandate for a
  second factor specifically. Standing up real Keycloak MFA (enrollment UI, OTP/WebAuthn flows,
  recovery) is a separate, materially larger infra project this issue's ~6-day estimate does not
  scope. Freshness is enforced via the `auth_time` claim, rejecting any call where
  `now - auth_time > STEP_UP_MAX_AGE_SECONDS`.
- **`STEP_UP_MAX_AGE_SECONDS = 300`** (5 minutes) — anchored to the realm's own
  `accessTokenLifespan: 300`, rather than an arbitrary separate number, mirroring `access-token.ts`'s
  own reasoning for reusing real realm values instead of inventing new ones. See §10 Q4.
- **Digital signature = server-held HMAC-SHA256**, not per-user asymmetric PKI. No user-held
  keypairs exist anywhere in this system, and building real PKI issuance/storage/rotation/revocation
  is a separate, larger project this issue does not scope. This mirrors the audit trail's own
  already-accepted security model (KB-11: hash-chaining, not PKI, is treated as sufficient
  tamper-evidence) rather than inventing a heavier, inconsistent crypto posture for this one
  feature alone. The signature still provides genuine non-repudiation *of the record* — proof that
  this specific content, actor, and fresh step-up assertion were bound together and have not been
  altered since — even though it is not a personally-held cryptographic identity. Flagged explicitly
  in §10, not silently assumed.
- **A new `caseReportVersion` table, not an extension of the existing `report` table.** Per FEAT-057's
  own explicit deferral note (§5 of its proposal): "`report.ts` most naturally gains Case-awareness
  alongside the content it will actually be signing... FEAT-058/059." The existing `report` table
  stays chemistry/`ordered_test`-shaped and untouched by this feature.
- **`case.status` and `caseReportVersion` are updated together, in the same transaction, but remain
  two distinct signals**: `case.status` (`signed_out`/`amended`, both already-existing CHECK values
  from FEAT-057) stays the coarse, already-established lineage-level signal; `caseReportVersion`
  carries the actual versioned, hashed, signed content. Nothing about FEAT-057's existing lineage-
  completeness check changes.
- **Amendment reuses the same finalize code path**, parameterized by an optional `{ reason,
  amendsVersionId }`, rather than a near-duplicate handler — this repo's now-repeated preference
  (FEAT-058's dual-emission reuse, `evaluateCondition` reuse) for one well-parameterized function.
  AC #3's "requires its own independent step-up + signature" is satisfied because `@RequireStepUp()`
  re-checks freshness unconditionally on every call, amend or not — there is no cached or
  carried-forward step-up state anywhere.
- **AC #4 ("no code path allows the auto-verify engine to finalize an AP report") is satisfied
  structurally, not by a new runtime check invented for this feature**: `auto-verify-observation.command.ts`
  only ever handles `ObservationFinalized` events and only ever mutates `observation.status` from
  `'preliminary'`; it has no reference to `case`/`caseReportVersion` anywhere, and the new
  `finalize`/`amend` routes are the *only* writers of `caseReportVersion` (no workflow rule, no
  outbox handler, nothing else touches this table). This is verified directly (read both files in
  full, confirmed no shared code path) and additionally locked in by a regression test (§8) rather
  than left as an implicit property.

## 6. Risks

- **First step-up implementation in this codebase** — no existing precedent beyond KB-09's design
  doc. Mitigated by keeping the freshness check to one small, pure, directly-testable function
  (`checkStepUpFreshness`), matching `auto-verify-gates.ts`'s own already-proven "pure gate, DB-free"
  split.
- **`auth_time` freshness depends on Keycloak actually refreshing the `AUTH_TIME` session note on
  `prompt=login`** — verified directly via a real local login round-trip during implementation (log
  in, wait, trigger step-up, confirm the new access token's `auth_time` claim actually advances),
  not assumed from the realm mapper's configuration alone.
- **HMAC signing-secret choice (§5) is a real, reviewable scope-narrowing versus true PKI** —
  documented here, not hidden. A future feature can upgrade to per-user asymmetric signing without
  changing this feature's versioning/audit shape (the `signature` column's meaning would change; the
  table shape would not).
- **New DB triggers (append-only + supersede) on `case_report_version`** are copy-adapted from
  `fn_observation_append_only`/`fn_observation_supersede` — verified directly against a real
  Postgres instance (an attempted mutation of a signed version's `contentHash`/`signature` must
  fail with a real trigger error), not assumed correct by analogy alone.
- **`apps/web` step-up UI is genuinely new frontend work** (Google Stitch prompt, per the issue,
  written once the API shape below is confirmed) — scoped narrowly to one confirmation
  screen/action, not a general redesign.

## 7. Acceptance criteria

Per issue #544's own 4 ACs:
- [ ] Calling `finalize`/`amend` on a case with only a normal active session (no fresh step-up) is
  rejected — `403` with `step_up_required`, proven by an e2e test using a real token whose
  `auth_time` is forced stale.
- [ ] A successfully finalized case has a recorded signature (`caseReportVersion.signature`) bound
  to that version's `contentHash`, plus exactly one `audit_event` row (`case.sign_out`) written in
  the same transaction.
- [ ] An amendment to an already-signed case creates a new `caseReportVersion` (old one's
  `supersededBy` set, content immutable thereafter) and independently requires its own fresh
  step-up + signature (proven by: sign out, let `auth_time` go stale again, confirm amend is
  rejected until a fresh step-up round-trip happens).
- [ ] No code path allows the auto-verify engine (FEAT-031) to finalize/amend a case — proven by a
  regression test asserting `auto-verify-observation.command.ts` never references `caseReportVersion`
  and that `caseReportVersion` has exactly one application-level writer path.

## 8. Testing plan

1. `pnpm --filter @lis/db generate` + review the migration diff (new table, both triggers,
   `-- RLS-exempt` markers absent since this table is tenant-scoped, matching FEAT-057's real-RLS
   precedent, not FEAT-058's global-table one).
2. Fresh `scripts/db-reset.sh`, then `packages/db/src/rls-isolation-check.ts` including the new
   `case_report_version` fixture.
3. `apps/api/src/case/case-report-signature.spec.ts` — hash determinism, `checkStepUpFreshness`
   boundary cases (`now - authTime` exactly at, just under, just over the threshold).
4. `apps/api/test/case-sign-out.e2e-spec.ts` — all 4 ACs against real Postgres + real Keycloak,
   including a real forced-`prompt=login` token round-trip (not a mocked JWT) to prove `auth_time`
   genuinely advances.
5. A real, manual browser check: log in as the `verifier` role, attempt sign-out with a stale
   session (rejected with a clear prompt), complete the forced re-login, confirm sign-out succeeds
   and the confirmation UI reflects it.
6. Full local verification suite: fresh db-reset → single new file in isolation → one final
   fresh-reset + full-suite run, per this session's own established pollution-diagnosis discipline
   (AGENTS.md's documented order-dependency finding).
7. `pnpm --filter @lis/sdk generate` alongside `apps/api openapi.json` together, in the same commit
   (PR #557's own lesson — do not repeat the drift-check failure).
8. Direct local simulation of the Constitution Gate's Law #1 regex against the new migration diff
   before pushing (FEAT-058's own verified technique), given `case_report_version` introduces new
   text/jsonb columns.

## 9. Rollback plan

Additive except for one existing-behavior change: `finalize()`'s capability gate changes from
`manage_specimens` to `verify` + a new `@RequireStepUp()`. Reverting the PR restores FEAT-057's
placeholder schema-only transition exactly as it stands today. The new `caseReportVersion` table,
its triggers, `SIGNING_SECRET`, `StepUpGuard`, and the `apps/web` step-up route param are all newly
introduced and independently removable; no existing table or route is altered in a way that isn't a
straightforward revert.

## 10. Questions requiring human approval

All four resolved 2026-08-12, Recommended option selected in every case:
1. **RESOLVED — forced re-authentication only** via `prompt=login` (no MFA exists in this realm
   yet), not blocked on standing up real Keycloak MFA/OTP/WebAuthn first.
2. **RESOLVED — server-held HMAC-SHA256** signature, matching the audit trail's own accepted
   hash-chain security model, not real per-user asymmetric PKI.
3. **RESOLVED — new `caseReportVersion` table**, per FEAT-057's own explicit deferral, not a
   retrofit of the existing chemistry-shaped `report` table.
4. **RESOLVED — 300 second freshness window**, anchored to the realm's own `accessTokenLifespan`.

**No further questions — implementation begins now.**
