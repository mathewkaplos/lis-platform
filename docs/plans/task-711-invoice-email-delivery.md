# Implementation Proposal: invoice email delivery (send-to-patient / send-to-facility)
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-28    Backlog ID: n/a (issue #711, EPIC #697 pilot-readiness)

## 1. Goal

Issue #711 is titled "Email/send-to-facility and send-to-patient for reports and invoices,"
but its report half is already done: `task-report-email-delivery.md` (Status: IMPLEMENTED,
session 44) shipped `POST /v1/cases/:id/report-versions/:versionId/send-email`, confirmed
working again in this morning's #719 exit-gate audit. That proposal's own §4 explicitly
scoped invoices out: *"invoices have no PDF generator at all today (receipts are a
`window.print()` page), and building one was judged out of scope for this specific
follow-up."* That gap is what's left of #711, and is this proposal's entire scope: a "send
by email" action on the invoice detail screen, mirroring the report-email pattern already
proven in production.

## 2. Affected files

- `packages/domain/src/billing.ts` — new `invoiceSendEmailRequestSchema`
  (`{ to: z.email().optional() }`), matching `caseReportSendEmailRequestSchema`'s exact
  shape in `anatomic-pathology.ts`.
- `apps/api/src/billing/billing.controller.ts` — new
  `POST /v1/invoices/:id/send-email`. `manage_billing`-gated (this controller's existing
  capability for every other invoice route — not a new one). `to` optional; when omitted,
  resolves the invoice's own patient's on-file email server-side (same resolution-order
  convention `case.controller.ts`'s `sendReportVersionEmail` already established). No `to`
  and no on-file email is a real 400, not a silent no-op. Emails a plain-text summary of the
  invoice (line items, total, status) via the existing `sendEmail()` — **no PDF attachment**,
  see §5's open question.
- `apps/api/src/billing/billing.service.ts` — a small `buildInvoiceEmailBody()` (or
  equivalent) formatting the plain-text summary from the invoice's already-loaded line
  items, mirroring how `case.controller.ts` already assembles its own email subject/body
  inline rather than via a template engine (this repo has no email-template system; the
  report-email feature didn't add one either).
- `apps/web/app/(app)/billing/invoices/[invoiceId]/actions.ts` — new `sendInvoiceEmail()`
  server action (raw `fetch`, same shape as every other action on this page and as
  `sendReportEmail()`).
- `apps/web/app/(app)/billing/invoices/[invoiceId]/types.ts` — `SendInvoiceEmailState` +
  `sendInvoiceEmailInitialState`, mirroring `SendReportEmailState`'s shape exactly (a plain
  object export from a non-`'use server'` file — `frontend-design` Skill entry #8's own
  documented gotcha).
- `apps/web/app/(app)/billing/invoices/[invoiceId]/send-invoice-email-form.tsx` — new
  component, adapted from `send-report-email-form.tsx`: one form, prefilled from the
  invoice's own patient email, a second quick-fill button for the referring facility's email
  when `invoice.payerType === 'corporate'` and that facility has one on file.
- `apps/web/app/(app)/billing/invoices/[invoiceId]/page.tsx` — extend the existing
  patient/facility lookups (this page already fetches the invoice; add the same two-hop
  patient/facility email fetch `cases/[caseId]/page.tsx` already does) and pass
  `defaultTo`/`facilityEmail` into `InvoiceView`.
- `apps/web/app/(app)/billing/invoices/[invoiceId]/invoice-view.tsx` — render
  `SendInvoiceEmailForm` inside the existing "Receipt" card, next to the "Print receipt"
  button.
- `apps/api/test/invoice-email.e2e-spec.ts` — new, mirroring
  `case-report-email.e2e-spec.ts`'s real-SMTP-conversation approach (a real local
  `smtp-server` instance, asserting the actual received message's recipient/subject/body —
  no PDF attachment to verify, since there is none).
- `openapi.json` / `@lis/sdk` regeneration for the new route.

## 3. Architecture consulted

`task-report-email-delivery.md` (the direct precedent — same capability-gating reasoning,
same resolve-on-omit convention, same one-form-per-record UI shape); `email.client.ts`
(`sendEmail()`'s `attachments` field is already optional, so a no-PDF text email needs zero
changes there); ADR-0041 / `billing` Skill entry #3 (no ledger-like concept beyond
`invoice.status` — this feature adds none); `billing.controller.ts`'s existing
`toInvoiceDto` (billing Skill entry #1 — every `Date` field must go through this mapper
before landing in an `@Audit()` payload; the new route's own audited response must reuse
it, not construct a fresh object).

## 4. Skills loaded

`billing` (all 5 entries, especially #1 Date/audit-chain and #3 no-ledger-creep), `api-design`
(entry #8, `ZodValidationPipe`/DTO-class gotcha — the new `to` body must be a
`createZodDto` class per billing Skill entry #2's own OpenAPI-visibility lesson, not a bare
inline type), `frontend-design` (entry #8, the `'use server'`-file-plain-export gotcha),
`testing` (real-SMTP-conversation e2e convention).

## 5. Assumptions & autonomous decisions

- **No PDF attachment — a plain-text (or simple HTML) email body summarizing the invoice.**
  This is the one load-bearing call in this proposal, called out explicitly rather than
  silently decided either way — see §10, Q1.
- `manage_billing`, not a new capability — this controller's existing gate for every other
  invoice route (generate, view, record payment); distributing an already-visible invoice
  externally isn't a new attestation, same reasoning `task-report-email-delivery.md` used
  for `manage_specimens` on the report route.
- No `@RequireStepUp()` — same reasoning as the report-email route (a distribution action,
  not a new signature/attestation).
- One send-email form on the existing invoice detail page (not a separate screen) — mirrors
  the report page's own "email action lives next to the thing being emailed" placement, and
  ADR-0041 already scoped this page to cover Details+Payment+Receipt together.
- Facility quick-fill only shown when `payerType === 'corporate'` (this schema's actual
  "facility-billed" signal) — patient quick-fill always available, matching the report form's
  own "neither is exclusive, both are just prefill buttons on one plain input" design.

## 6. Risks

Low. Same external-dependency shape as the already-shipped report-email feature (real SMTP
send, loud failure on misconfiguration, no silent fallback). No new schema, no new
capability, no ledger-adjacent concept — nothing here is the kind of decision ADR-0041 itself
required stopping for. The one open design question (§10 Q1) is a UX/scope call, not an
architecture reversal.

## 7. Acceptance criteria

- A generated invoice can be emailed to an explicit address, or to the patient's on-file
  email when none is given.
- A facility-billed (`payerType: 'corporate'`) invoice's detail page offers a one-click
  quick-fill to the referring facility's on-file email, when it has one.
- Neither an explicit `to` nor a patient on-file email present → a real 400, not a silent
  no-op or a 500.
- A caller without `manage_billing` gets a real 403.
- The email is real — proven via a real SMTP conversation in the e2e suite (recipient,
  subject, and body content asserted from the actually-received message), not a mocked
  `sendEmail()` call.

## 8. Testing plan

- `pnpm --filter @lis/domain build`, `pnpm --filter api build`, `pnpm --filter web typecheck`
  — all clean.
- `pnpm --filter api lint`, `pnpm --filter web lint` — clean, checked for the known
  `eslint --fix` stray-reformat-of-unrelated-files gotcha (`develop` Skill step 4c).
- New `invoice-email.e2e-spec.ts`: explicit recipient (real received message asserted),
  patient-email-resolved-when-omitted, 400 when neither exists, 403 without
  `manage_billing`.
- Re-run `billing.service.spec.ts` and existing `apps/api` billing e2e coverage to confirm no
  regression on `toInvoiceDto`/audit-chain behavior (billing Skill entry #1's own risk).
- Live-verified manually against the local dev stack once merged (real Keycloak login, real
  invoice, real send) — not just CI-green, matching this repo's own "a pass in one harness
  doesn't prove a pass in the real one" rule (AGENTS.md).

## 9. Rollback plan

Revert the files in §2. No schema migration, no new env var, no change to any existing
route's behavior — an environment with nothing wrong today behaves identically after a
revert.

## 10. Questions requiring human approval

**Q1 — Plain-text/HTML email body only, or build a real invoice PDF first?**
The report-email feature's own proposal explicitly deferred this ("building one was judged
out of scope for this specific follow-up") because a PDF pipeline for invoices doesn't exist
at all today (the current "Receipt" is an on-screen `window.print()` view, not a generated
document). Two real options:
- **(Recommended) Ship a plain-text/simple-HTML email now** — line items, total, status,
  invoice number — reusing the existing receipt view's own content, no PDF at all. Fast,
  closes #711's real remaining gap, matches this repo's own incremental-slice discipline
  (ADR-0041 itself deliberately shipped a thin edge over a fuller suite). A follow-up issue
  would track "generate a real invoice PDF" as its own, separately-scoped feature if ever
  needed.
- Build a real invoice PDF generator first (a materially larger, separate piece of work —
  a new rendering pipeline, likely reusing `pdf-generation` Skill patterns from the report
  side), then attach it the same way `sendReportVersionEmail` attaches the report PDF.

**Q2 — Facility quick-fill only, or also a patient-portal delivery path?**
#711's own body mentions "the patient portal (if in scope)" as a maybe. No patient portal
exists anywhere in this repo yet (FEAT-039 is unbuilt) — recommend treating "send to
patient" as literally "email the patient's on-file address," identical to how the report-email
feature already resolved this same question, not a portal-delivery mechanism.

---

**Approved 2026-08-28**, both questions accepted at their recommended defaults: Q1 —
plain-text/HTML invoice email now, no PDF (a real invoice PDF pipeline is separate, future
work); Q2 — "send to patient" means emailing the patient's on-file address, not
patient-portal delivery (no portal exists yet).
