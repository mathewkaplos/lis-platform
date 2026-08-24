# Implementation Proposal: per-tenant SMTP settings on org-settings
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-24    Backlog ID: n/a (email-delivery follow-up)

## 1. Goal

Follow-up to `task-report-email-delivery.md` (PR #741): that feature sent
every tenant's signed case reports from one shared, platform-wide Gmail
account (`SMTP_USER`/`SMTP_APP_PASSWORD` env vars). Per the user's request
("can we have an option of defaulting to referral facility email?" led
into "now can we make the settings on the organization setup?"), and the
explicit choice between a per-tenant credential vs. just a display-name
change: each organization can now configure its own Gmail account on its
own org-settings screen, with a real, new piece of security
infrastructure (encryption at rest) backing it — this repo had none
before.

## 2. What this adds

- `packages/db/src/secret-encryption.ts` — the first encryption-at-rest
  infrastructure in this repo. AES-256-GCM (authenticated — a tampered
  ciphertext fails to decrypt, not silently produces garbage), keyed by a
  new `SETTINGS_ENCRYPTION_KEY` env var (32 bytes, hex-encoded), read
  fresh per call (`requiredEnv`-style, same convention every other secret
  in this repo already uses).
- `packages/db/src/schema/tenant.ts` — three new nullable columns:
  `smtp_user`, `smtp_app_password_encrypted` (ciphertext, never
  plaintext), `smtp_from`. Migration `0065_tenant_smtp_settings.sql`
  (drizzle-kit generated).
- `packages/domain/src/org-settings.ts` — `orgSettingsSchema` gains
  `smtpUser`/`smtpFrom` (plain, safe to read back) and `smtpConfigured`
  (a boolean — the app password itself is **never** returned, encrypted
  or otherwise). `orgSettingsUpdateSchema` gains a write-only
  `smtpAppPassword` (plaintext in the request only; the server encrypts
  before storage) with the same three-way `omitted/null/value` resolution
  every other field on this endpoint already uses.
- `apps/api/src/org-settings/org-settings.controller.ts` — `update()`
  encrypts a new app password before it ever reaches the DB; `get()`/
  `toOrgSettings()` collapse the encrypted column down to `smtpConfigured`
  and never expose the ciphertext. New exported `getTenantSmtpConfig()` —
  the one function outside this module allowed to see a decrypted
  password, called only by `case.controller.ts`.
- `apps/api/src/email/email.client.ts` — `sendEmail()` gains an optional
  `from` override (tenant user/app password/display-from). Host/port/
  secure stay the fixed platform config either way (Gmail only, matching
  the "for now" scope) — only the account being sent *from* is ever
  tenant-specific. The default (platform-wide) transporter stays memoized;
  a tenant-specific one is built fresh per call (cheap, and avoids one
  tenant's credentials ever leaking into another's request through a
  shared module-scope variable).
- `apps/api/src/case/case.controller.ts` — `sendReportVersionEmail` looks
  up the case's own tenant's SMTP config; if configured, sends from it;
  if not, falls back to the platform-wide env config exactly as before
  (no behavior change for a tenant that never touches this new setting).
- `apps/web/app/(app)/admin/org-settings/` — a new "Report email (Gmail)"
  section on the existing org-settings form: Gmail address, app password
  (never prefilled — blank means "leave unchanged"; a "Remove the saved
  app password" checkbox, shown only once one exists, is the one explicit
  way to clear it), and an optional "From" override.
- `.env.example`, CI (`pr.yml`, both jobs), and staging
  (`deploy-staging.yml`/`docker-compose.staging.yml`) all wired with
  `SETTINGS_ENCRYPTION_KEY`, matching `SIGNING_SECRET`'s own convention
  exactly.

## 3. Architecture consulted

`packages/db/src/case-report-signature.ts` (the `getSigningSecret()`
`requiredEnv`-per-call convention, mirrored exactly for the new
encryption key); `apps/api/src/storage/object-storage.client.ts` (the
"fails loudly, no silent fallback" convention for a missing/misconfigured
external-dependency secret); `org-settings.controller.ts`'s own existing
three-way `!== undefined` field-resolution convention (extended to the
new SMTP fields, not reinvented); `email.client.ts`'s own pre-existing
`SMTP_SECURE=false` test-only escape hatch (reused, not duplicated, for
the new per-tenant transport path's own tests).

## 4. Assumptions & autonomous decisions

- Host/port/secure (`smtp.gmail.com:465`, implicit TLS) stay fixed
  platform-wide config, not per-tenant columns — this feature's own scope
  is still "Gmail app password, for now" (the original decision); nothing
  here blocks adding those columns later if a tenant ever needs a
  different provider.
- AES-256-GCM, not a KMS/HSM-backed scheme — a real, standard choice for
  this repo's current infrastructure (no cloud KMS integration exists
  anywhere else in this codebase either), consistent with the "symmetric,
  server-held secret" posture `case-report-signature.ts`'s own HMAC
  approach already established for a different secret.
- The clear-checkbox UX (not just "blank the field to clear") — a
  once-set app password has no visible current value to compare a blank
  submission against, so "leave unchanged" and "clear it" need to be two
  deliberately different actions, the same way any real password-change
  form works.

## 5. Risks

Medium. New security-relevant infrastructure (encryption at rest) always
carries real stakes if implemented wrong — mitigated by using a
well-established, authenticated construction (AES-256-GCM) rather than
inventing one, and by live-verifying the actual ciphertext in the
database directly (not just trusting the API's own round-trip). A lost or
rotated `SETTINGS_ENCRYPTION_KEY` makes every already-stored app password
permanently undecryptable (by design — there is no recovery path other
than re-entering it) — worth documenting operationally before this ships
to a real multi-tenant deployment, not addressed further here.

## 6. Testing plan

- `pnpm --filter @lis/db build`, `pnpm --filter @lis/domain build`,
  `pnpm --filter api build`/`typecheck`, `pnpm --filter web typecheck` —
  all clean. `pnpm --filter api lint`/`pnpm --filter web lint` — both
  clean (checked for the known ESLint `--fix` stray-reformat gotcha; none
  in the final diff).
- **Live-verified migration:** ran it against the real local Postgres,
  confirmed the three new columns exist.
- **Live-verified, real Postgres/Keycloak, no mocks:** `org-settings.
  e2e-spec.ts`'s new "Per-tenant SMTP" suite (3 tests) — setting an app
  password never echoes it back in either the PUT response or a
  subsequent GET (checked the raw JSON body, not just a typed accessor);
  omitting the field on an unrelated later update leaves it unchanged;
  an explicit `null` clears it. `case-report-email.e2e-spec.ts` gained one
  more test: a **second, independent local SMTP server** that only
  accepts the tenant's own configured username — proving the send
  genuinely routed through the tenant-specific account (auth succeeded
  against a server that rejects anything else) and never touched the
  suite's own shared default server. 28 tests total across the three
  affected spec files, all passing; re-ran `case-sign-out.e2e-spec.ts`
  (17 tests) to confirm no regression.
- **Live-verified directly against the running API, outside the test
  suite:** a real `PUT`/`GET` round trip confirmed the app password never
  appears in either response, then a direct `SELECT` against the real
  Postgres `tenant` row confirmed the stored value is genuine AES-256-GCM
  ciphertext (`iv:authTag:ciphertext`, not the plaintext), then cleared
  it back to `null` to leave the local dev tenant clean.

## 7. Rollback plan

Revert the files above; the migration is additive-only (three nullable
columns, no data migration, no existing column touched) — reverting the
migration file without a down-migration script is safe by inspection, but
a real rollback would need a manual `ALTER TABLE tenant DROP COLUMN
smtp_user, DROP COLUMN smtp_app_password_encrypted, DROP COLUMN
smtp_from` if the columns themselves need to go too. A tenant that never
configured this feature is entirely unaffected either way (`smtpConfigured:
false`, platform-wide fallback unchanged).
