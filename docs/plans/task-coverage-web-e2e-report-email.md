# Implementation Proposal: e2e coverage for the send-report-email feature
Status: PROPOSED (never run in CI yet)
ADR: n/a    Date: 2026-08-24    Backlog ID: n/a (coverage-improvement follow-up)

## 1. Goal

Follow-up to `task-report-email-delivery.md` (PR #741) and its facility-
default extension (PR #742). Those shipped with real API-layer e2e
coverage (`apps/api/test/case-report-email.e2e-spec.ts`, verified against
a real local `smtp-server` instance) but no `apps/web` coverage — the
actual UI path (the "Send by email" button, the prefilled field, the
success message) was untested through a real browser, breaking the
pattern every other feature in this coverage-improvement pass got. Per
the user's explicit "yes" to closing that gap.

## 2. What this adds

- `apps/web/e2e/case-report-email.spec.ts` — signs a case out through the
  real UI (same minimal fixture shape `case-sign-out.spec.ts` already
  established), then sends its report by email by clicking the real
  "Send by email" button (not calling the API directly), asserting the
  field prefilled correctly from the patient's own on-file email and the
  real "Sent to {email}." success message. Verified against a **real
  MailHog instance** via its REST API — not a mock, and not the same
  `smtp-server` test double the API-layer spec uses (that one runs
  in-process inside the vitest/Node test; this one needs to be reachable
  from a separate, real running `apps/api` process the whole `web-e2e` job
  already spins up), checking the actual received message's recipient,
  subject, and a real PDF attachment (content-type + filename pattern in
  the raw MIME body).
- `.github/workflows/pr.yml` — `web-e2e` job now starts a MailHog
  container (`docker run`, alongside the existing Keycloak/MinIO
  containers) and points `apps/api`'s own `SMTP_*` env vars at it. A
  readiness poll (matching the existing Keycloak/apps/api poll pattern)
  gates the actual test run.

## 3. Architecture consulted

`case-report-email.e2e-spec.ts` (the API-layer precedent this UI-layer
spec doesn't duplicate — that suite already proves `sendEmail()`'s own
correctness; this one only proves the UI wiring); `case-sign-out.spec.ts`
(the exact accession → block → slide → sign-out fixture sequence, reused
verbatim); `clinical-workflow.spec.ts`'s own header comments (the
`getByLabel` exact:true pitfall, applied here too).

## 4. Assumptions & autonomous decisions

- Chose MailHog over reusing `smtp-server` (the API-layer spec's own test
  double) — confirmed live via a direct local probe that MailHog accepts
  an unauthenticated SMTP conversation with zero special config (no
  `onAuth` handler needed, unlike `smtp-server`), and its REST API is
  reachable from a separate process/container, which an in-process
  `smtp-server` instance inside a vitest run cannot offer to a
  Playwright-driven browser hitting a real, separately-running `apps/api`.
- `SMTP_SECURE=false` and dummy `SMTP_USER`/`SMTP_APP_PASSWORD` — no real
  Gmail credentials anywhere in this suite either, same as the API-layer
  spec's own convention.
- Not locally verified end-to-end (same pre-existing Windows `next build`/
  `next dev` environment issues documented in every prior `web-e2e`
  proposal doc this session) — the MailHog behavior itself *was* verified
  live locally via a direct nodemailer probe (confirmed accepting an
  unauthenticated send and the REST API returning the expected shape)
  before writing the spec against it.

## 5. Risks

Medium until the first real CI run — new container, new env wiring, new
selectors. Expect at least one iteration of CI-log-driven fixes,
consistent with every prior addition to this harness.

## 6. Testing plan

- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web lint` — clean.
- MailHog's own behavior (no-auth SMTP accept, REST API message shape)
  verified live via a direct local nodemailer probe before writing the
  spec.
- CI's `web-e2e` job is the real proof for the Playwright spec itself —
  watched via `gh pr checks`, iterated on with real CI logs/artifacts if
  it fails.

## 7. Rollback plan

Revert the two files in §2. No schema/migration change — new test
infrastructure and one additional CI container only.
