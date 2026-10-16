# Screen Inventory — LIS UI/UX Upgrade

Static code-level inventory of every `page.tsx` under `apps/web/app/`. **39 pages**, not 37 as
estimated in the original brief — `admin/report-templates` has both a list and a per-test
designer sub-page, and `cases/[caseId]` has 2 further nested routes (synoptic, slide viewer) not
separately counted in the original estimate.

States/screenshots per viewport are **not captured** — no live app was available this session
(Docker/WSL2 blocked by disabled BIOS virtualization on this machine; see `01-audit.md`'s "What
could not be verified"). "Purpose" and role columns are derived from actual imports/role-check
helpers/API calls read in each file, not guessed; where a page is too thin to say more, that's
stated rather than padded.

**Role column key:** role-check helpers live in `apps/web/auth/roles.ts`; "ungated" means the page
itself renders for any authenticated session (the real enforcement, if any, is server-side in
`apps/api`'s `CapabilityGuard` — every page-level check found is explicitly commented as
"UI-visibility convenience only").

## Admin (8 pages)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `admin/instrument-mappings` | qa/lab_admin (`hasCatalogManagementRole`) | Lists `instrument_analyte_mapping` rows, add-only form mapping an instrument channel to an analyte/unit | List + add-form, no edit/archive | None |
| `admin/org-settings` | ungated view; `manage_org_settings` server-side for save | View/edit org identity, contact, currency, reporting defaults | Single settings form | None |
| `admin/reference-ranges` | qa/lab_admin | Lists versioned `reference_range` rows by effective date, add-only form | Filterable table + add-form | None |
| `admin/referring-facilities` | technologist/pathologist/reception/lab_admin (`hasPatientManagementRole`) | Lists referring facilities (used at order entry/invoice payer), create-only | List + create-form | None |
| `admin/report-templates/[testDefinitionId]` | qa (`hasQaRole`) | Visual report-template designer; seeds from latest version or blank; Save always creates a new version | Custom designer/canvas + live preview — closest thing to a wizard in admin | None |
| `admin/report-templates` | ungated, read-only | One row per test, published/draft badges, links to designer | Simple link-list | None |
| `admin/tests` | qa/lab_admin | Binds existing analytes into a new orderable test; no edit of existing tests | Create-form only | None |
| `admin/users` | lab_admin (`hasLabAdminRole`) | Lists staff accounts, create-only form; inline "no permission" message if role missing | List + create-form | None |

## Billing (3 pages)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `billing/facility-statement` | ungated at page level (server enforces) | Date-ranged, printable statement of invoices for one referring facility | Filter form + printable table, `PrintButton` | error only |
| `billing/invoices/[invoiceId]` | ungated | Invoice detail + payment + receipt + email-send, all on one route | Detail view + email form | error only |
| `billing/invoices` | **deliberately** ungated (documented divergence from its own original proposal, citing no other list screen is gated either) | Invoice list, status tabs (unpaid/partial/paid/all) | Status-tab list pattern (shared with cases/orders) | error only |

## Cases — anatomic pathology (5 pages)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `cases/[caseId]` | technologist/pathologist (`hasSpecimenManagementRole`); pathologist-only for sign-out/amend/return-to-screening | AP case workbench: parts→blocks→slides tree, synoptic links, narrative, screen/sign-out/amend forms, report versions w/ PDF+email, audit trail | Nested tree + ~8 conditional role-gated forms on one page (densest screen in the app) | error only. **403 thrown as a raw `Error()`, not the inline-message pattern every sibling page uses** |
| `cases/[caseId]/slides/[slideId]/viewer` | ungated | Resolves the ready WSI image for a slide, renders the tile viewer | Custom WSI tile viewer | Inherits parent `error.tsx` only; same raw-`Error()` 403 pattern |
| `cases/[caseId]/synoptic/[partId]` | technologist/pathologist (`hasSpecimenManagementRole`) | Records a CAP/ICCR synoptic protocol (20-40+ elements) per specimen part, with protocol disambiguation + linked biomarker panels | Dynamic protocol-chooser + large structured form | Inherits parent `error.tsx` only; same raw-`Error()` 403 pattern |
| `cases/new` | technologist/pathologist (`hasSpecimenManagementRole`) | Accessions a new AP case against an existing order; dynamic specimen-parts list (min. 1 required, client-validated) | Dynamic add/remove row list | Inherits `cases/error.tsx` |
| `cases` (list) | ungated | Global AP case list, status tabs + patient-name/MRN search | List + status tabs + search | error only |

## Other internal `(app)` screens (14 pages)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `collection-queue` | ungated | "Pending collection" worklist, derived client-side from `GET /v1/orders?status=ordered`, STAT-first then oldest-first | Derived/computed list, no dedicated endpoint | **None at all** |
| `control-lots/[id]/chart` | ungated | Levey-Jennings QC chart for one control lot/analyte/level | Chart component; reachable only by direct link (no list page links to it) | **Both** error AND loading — best-covered page in `(app)` besides the dashboard's siblings |
| `critical-notifications` | pathologist-only acknowledge (`hasPathologistRole`); list ungated | Pending+escalated critical-value queue, acknowledge requires a free-text read-back | "Unresolved-only queue" pattern (mirrors qc-violations) | None |
| `culture-reads` | ungated | "Cultures due for reading" worklist; recording growth auto-creates an organism-ID panel | Minimal list + action table | error only |
| `orders/[id]` | ungated | Order overview: tests/statuses, conditional CTAs (receive, enter results, cancel, new AP case, invoice) | Card with many conditional CTAs | error only; **no loading.tsx — deliberate**, see below |
| `orders/[id]/report/[orderedTestId]` | pathologist-only download (`hasPathologistRole`) | PRELIMINARY vs FINAL report viewer, status computed from verified-vs-total analyte count | Status badge + conditional download | **Both** error AND loading |
| `orders/[id]/results` | pathologist flag (`isVerifier`) passed to grid; entry ungated | Result-entry grid, one row per (orderedTest, analyte); shows priors; disabled rows for not-yet-received tests; inline "held" banner on QC/critical block | Dense editable `DataTable` grid | error only; **no loading.tsx — deliberate** |
| `orders/new` | ungated | Builds an order for a given patient: checkbox catalog/panel picker, client-filtered search | Checkbox picker + filter box | Inherits `orders/error.tsx` |
| `orders` (list) | ungated, 403 handled inline | Global cross-patient order list, status/priority/date/text filters | Filter form (no client JS) + table | error only; **no loading.tsx — deliberate** |
| `(app)` root (dashboard) | technologist flag for bulk actions; ungated for viewing | Home screen: 3 stat-card tabs (pending/in-progress/verified) driving a filtered worklist | StatCard-as-tab + `WorklistView` w/ optional bulk-select | **None at all, and none inherited — the `(app)` group root itself has neither.** First screen every role sees after login. |
| `patients/[id]/edit` | ungated | Pre-filled demographic-correction form | Single form | Inherits `patients/error.tsx`, no loading |
| `patients/[id]` | 403 handled inline | Patient profile: demographics + Edit/New-order actions | Detail card | error + `not-found.tsx`; **no loading.tsx — deliberate** (shared with `/edit`) |
| `patients/new` | ungated | Registration form (11 fields, 3 required) + duplicate-match review step ("register anyway?") | `useActionState` form + confirmation banner | Inherits `patients/error.tsx` |
| `patients` (list) | 403 handled inline | Free-text patient search, defaults to "recently registered" | Search form + table, result-limit notice | error only; **no loading.tsx — deliberate** |
| `qc-violations` | qa-only resolve (`hasQaRole`); list ungated | Unresolved Westgard QC-rule violation queue w/ Resolve; rejection-severity violation blocks result release | "Unresolved-only queue" pattern | None |
| `reception` | ungated | Lookup-by-order-id → accept/reject specimen, checklist of ordered tests, two-step reject confirm | Scanner-friendly lookup → two-step confirm | None |
| `specimen-processing-qc` | pathologist-only record (`hasPathologistRole`); list ungated | Batch-level tissue-processing/microtomy/H&E QC review | List + SlideOver form | None |
| `specimens/[id]/label` | ungated, reached only via internal link (`notFound()` not a friendly retry) | Printable specimen label (Code128 + DataMatrix barcodes), deliberately PHI-minimized (no name/MRN) | Print-only view, forced light background | None |

## Clinician portal (3 pages)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `clinician/orders/new` | clinician (enforced in `(clinician)/layout.tsx`) | Clinician-facing twin of `orders/new`, same `OrderBuilderForm` | Same catalog picker | Group-level error + loading |
| `clinician` (dashboard) | clinician | Unacknowledged criticals for own related patients (ack/read-back form) + patient list | Two-card dashboard | Group-level error + loading |
| `clinician/patients/[patientId]/results` | clinician, scoped to own related patients | Results/trend view; explicitly bypasses the patient-portal release-policy delay | StatCard grid + TrendChart per analyte | Own `loading.tsx`; group `error.tsx` |

## Patient portal (1 page)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `portal/results` | patient (enforced in `(portal)/layout.tsx`) | Self-service verified-results/trend view, entirely server-side release-policy-gated | StatCard grid + TrendChart, explicit "No results are available yet" empty state | **Both** error AND loading — one of the best-covered screens in the app |

## Public (1 page)

| Route | Role(s) | Purpose | UI pattern | Loading/error boundary |
|---|---|---|---|---|
| `signup` | unauthenticated, self-service org creation | Single-page tenant signup (org name + admin name/email/password), hands off to existing OIDC login on success | Single `useActionState` form | **None at all — not even at the `(public)` group level** |

---

## Role-gating mechanism (VERIFIED)

`apps/web/proxy.ts` (Next.js middleware) enforces **authentication only** — valid-session check,
redirect to `/api/auth/login` if absent. It does not check role/capability. There is no route-level
role middleware; once authenticated, a session can reach any `(app)` URL by direct navigation —
what renders is purely each page's own choice. Real enforcement is server-side
(`apps/api`'s `CapabilityGuard`); every page-level helper in `auth/roles.ts` says so in its own
comment.

**Consistent pattern** (used by ~20 files): named boolean helpers in `auth/roles.ts`
(`hasPathologistRole`, `hasQaRole`, `hasTechnologistRole`, `hasPatientManagementRole`,
`hasSpecimenManagementRole`, `hasBillingRole`, `hasCatalogManagementRole`, `hasLabAdminRole`),
each documented against the `apps/api` capability it mirrors.

**One inconsistency:** `(clinician)/layout.tsx` and `(portal)/layout.tsx` inline
`session.roles.includes('clinician'|'patient')` directly rather than using a named helper — a
second, parallel convention for a coarse "which portal" gate.

**Observed convention:** list/browse screens are generally left ungated at the page level (the
API 403s the underlying fetch); write/destructive actions (add, acknowledge, resolve, sign-out,
verify) are what actually gets an explicit `hasXRole()` check deciding whether to render the
control.
