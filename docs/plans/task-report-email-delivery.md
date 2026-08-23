# Implementation Proposal: email delivery for signed case reports (Gmail SMTP)
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-24    Backlog ID: n/a (pilot-readiness audit follow-up)

## 1. Goal

The pilot-readiness audit's only deliberately-deferred item (per decision
#698): "printed/downloadable PDF handoff is acceptable for phase one —
email delivery deliberately deferred past this pilot." Per the user's
explicit direction ("for email, we will use Gmail app password for now"),
this builds that first email-sending feature. Scoped, per the user's own
answers, to case reports only (not invoices — no PDF pipeline exists for
those yet, a materially larger, separate piece of work), sent to the
patient's on-file email by default with an always-editable override field.

## 2. What this adds

- `apps/api/src/email/email.client.ts` — the first email infrastructure in
  this repo. Gmail SMTP via `nodemailer`, an app password (not a
  transactional-email provider), read from `SMTP_USER`/`SMTP_APP_PASSWORD`
  env vars with the exact `requiredEnv`-style enforcement
  `object-storage.client.ts` already established (fails loudly, no silent
  fallback). `SMTP_SECURE=false` is a test-only escape hatch so a real
  local SMTP server can stand in for Gmail in the e2e suite — never used in
  production config.
- `apps/api/src/case/case.controller.ts` — new
  `POST /v1/cases/:id/report-versions/:versionId/send-email`. Renders the
  exact same PDF `getReportVersionPdf` already does (same immutable,
  already-signed content — no new fact recorded about the report) and
  emails it as an attachment. Gated by `manage_specimens` (not `verify` —
  distributing an already-signed report externally doesn't itself attest
  to anything new, unlike `finalize`/`amend`; same capability every other
  routine AP action on this controller uses). `to` is optional in the
  request body; when omitted, resolves the case's own order's patient's
  on-file email server-side. No email at all (neither an explicit `to` nor
  one on file) is a real 400, not a silent no-op.
- `packages/domain/src/anatomic-pathology.ts` —
  `caseReportSendEmailRequestSchema` (`{ to: z.email().optional() }`).
- `apps/web/app/(app)/cases/[caseId]/` — `sendReportEmail()` server action
  (raw `fetch`, same shape every other case action on this page already
  uses), `SendReportEmailForm` (one per report version, prefilled from the
  patient's own on-file email, always editable, stays usable after a
  successful send rather than unmounting), and `page.tsx`'s own two-hop
  fetch (case → order → patient) purely to populate that prefill.
- `apps/api/test/case-report-email.e2e-spec.ts` — proves the whole path
  through a **real SMTP conversation**: a real local `smtp-server` instance
  this test spins up itself (not a mocked `sendEmail()`/`nodemailer` call),
  asserting the actual received message's recipient, subject, and a real
  PDF attachment (`%PDF-` magic-number check on the decoded bytes, not
  just a content-type label). No real Gmail credentials anywhere in the
  suite.
- `.env.example` — documented `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/
  `SMTP_APP_PASSWORD`/`SMTP_FROM`, left unset by default (nothing calls
  this eagerly at startup).

## 3. Architecture consulted

`apps/api/src/storage/object-storage.client.ts` (the exact
`requiredEnv`-per-call, memoized-client convention this file's own
`email.client.ts` mirrors); `case.controller.ts`'s own `getReportVersionPdf`
(reused verbatim for PDF generation) and `screen()` (the `manage_specimens`
capability-choice precedent — a routine workflow action, not a diagnostic
release requiring `verify`+step-up); `case-sign-out.e2e-spec.ts` (the
`createFinalizableCase()` minimal-fixture shape and real-Keycloak-token
testing culture, both reused directly for the new spec).

## 4. Assumptions & autonomous decisions

- Scoped to case reports only, per the user's own explicit choice between
  "case reports only" and "case reports + invoices" — invoices have no PDF
  generator at all today (receipts are a `window.print()` page), and
  building one was judged out of scope for this specific follow-up.
- `manage_specimens`, not `verify` — a genuine judgment call, not a stated
  design-partner requirement: sending an already-signed, already-readable
  (via the same-gated `getReportVersionPdf`) report externally is a
  distribution action, not a new attestation, so it doesn't need the
  higher bar `finalize`/`amend` require. No `@RequireStepUp()` for the same
  reason.
- One form per report version (not just the latest) — a lab may
  legitimately want to re-send an older, still-valid version to a
  different recipient.
- Real Gmail credentials are never solicited from or entered by the
  assistant — `.env.example` documents where to put them; the user
  configures `SMTP_USER`/`SMTP_APP_PASSWORD` locally themselves.

## 5. Risks

Low-medium. New external dependency (SMTP send) with a real, loud failure
mode (thrown error → 500) rather than a silent no-op if misconfigured.
Gmail's own app-password sending limits (500 recipients/day on a
consumer account) are a real constraint worth knowing about before this
is used for any volume beyond pilot-scale — not addressed here, since
nothing in this pilot's own scope needs it yet.

## 6. Testing plan

- `pnpm --filter @lis/domain build`, `pnpm --filter api build`,
  `pnpm --filter web typecheck` — all clean.
- `pnpm --filter api lint`, `pnpm --filter web lint` — both clean (checked
  for the known ESLint `--fix` stray-reformat gotcha on unrelated e2e
  files; none present in the final diff).
- **Live-verified, real Postgres/Keycloak, real SMTP conversation, not
  mocked:** ran the new `case-report-email.e2e-spec.ts` directly against
  the local dev stack — all 4 tests pass: explicit recipient with a real
  PDF attachment (magic-number verified), patient's on-file email resolved
  automatically when `to` is omitted, a real 400 when neither exists, and
  a real 403 for a caller without `manage_specimens`.
- Re-ran `case.e2e-spec.ts` and `case-sign-out.e2e-spec.ts` (27 tests) to
  confirm the `case.controller.ts` edit introduced no regression — both
  clean.

## 7. Rollback plan

Revert the files in §2. `SMTP_*` env vars are additive and optional — an
environment that never sets them behaves exactly as before (the new route
simply 500s if ever called without them configured, matching the "fails
loudly" convention `object-storage.client.ts` already established for the
same class of dependency).
