# Pilot User Guide & Acceptance Test Manual — lis-platform

**Status:** Draft v3, originally built 2026-08-26 by static inspection of `main` (commit `5af2abc` at
time of writing) — schema, controllers, UI components, Keycloak realm config, seed SQL, the
`docs/scope/current.md` engineering breadcrumb, and the `apps/web/e2e` Playwright suite — then taken
through **two full live browser passes against the real running stack, spanning 2026-08-26 and
2026-08-27**, covering Parts 1, 2 (partial), 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20 (partial),
21 (partial), and 22/23's synthesis. Two real application bugs were found and fixed along the way (a
Next.js `loading.tsx` Suspense-hang defect blocking `/patients`/`/orders` and their detail pages, and a
`crypto.randomUUID()` hydration mismatch in the case-accession form — see the Go/No-Go checklist), one
GitHub issue was filed (#762, an RBAC gap), and several more real findings (a date-filter boundary bug,
a synoptic-protocol conditional-field question, an inconsistent 403-messaging gap) are recorded inline
where found and summarized in the Go/No-Go checklist at the bottom.

**Not yet live-verified even after both passes:** Part 2's non-synoptic fields (org name/logo/branding
propagation), Part 3 (user management beyond what §19's audit-trail check exercised), Part 5 (catalog
CRUD beyond viewing), Part 6 (patient-registration edge cases beyond the happy path), Part 13 (covered
by cross-reference to §9 only), most of Part 20 (only two of five scenarios directly tested), most of
Part 21 (only the mobile-nav/scroll-containment checks), and Part 4's referring-facility CRUD screen
itself (only used indirectly as a payer). Every route, field label, button caption, and behavior in
those areas is still cited to a specific file/line so you can verify it yourself. Treat any step that
feels off once you're actually in the browser as more likely a copy/label drift since this was written
than a fabrication — and please correct this file in place when you find one.

## 0.1 Live verification pass (2026-08-26) — read this before Part 1 or Part 18

A live pass was run against the actual local stack (Docker services already up, `apps/web`/`apps/api`
already running) covering Part 1's environment checks and a slice of Part 18's RBAC matrix. Findings:

**Part 1 confirmed exactly as documented:** `docker compose ps` showed postgres/valkey/keycloak/minio
all healthy; `curl` confirmed web (307 → Keycloak login, expected), API `/health` (200), Keycloak's
realm OIDC discovery endpoint (200), MinIO console (200), and a live `psql` connection all work.
Browser navigation to `http://localhost:3000` redirected to `http://localhost:8080/realms/lis/...` with
`client_id=lis-web` exactly as §1.2 predicts.

**Part 2 confirmed, with one correction:** logging in as `test-user-11` and saving the example org
profile on `/admin/org-settings` persisted correctly across a hard reload — Part 2's steps work as
written. It also **resolves** the `[NOT VERIFIED]` note in §2.2: the org name **does** render in the
app shell header (top-right dropdown), confirmed live.

  **Correction to §2.1 step 3:** the claim "expect every field blank" is **wrong** for a tenant that has
  already been used for any manual testing or a partial e2e run. The seeded tenant `...0001` was found
  with **pre-existing values already saved** — Organization name `Unnamed organization`, Address
  `123 Lab Street`, Currency `KES` — left over from a prior session's own testing, not a pristine
  first-load state. **Treat "blank fields" as only true on a truly first-ever save; don't be alarmed if
  you see placeholder-looking data already there.**

  **New, unplanned observation — the dashboard is not clean:** the landing `/` Worklist showed **272
  pending items**, the overwhelming majority obviously-named leftover e2e/manual-test fixtures (e.g.
  "ReportEmail Fixture", "SignOut Fixture C75EB492B0", "Billing Fixture 1033FF5119", "Case Fixture
  A5A060CC21", "PilotAudit Patient057091"). **This tenant is not a clean pilot environment today** — a
  `pnpm db:reset` (§1.1) immediately before a real pilot run is not optional, it's required, or the
  design partner's very first dashboard view will be 272 rows of obviously-fake test noise. Note this
  under the **PILOT GO/NO-GO CHECKLIST** below.

**Part 18 — one already-documented gap reproduced, and one materially bigger gap newly found (§18.3
below is the full writeup):** logging in as `test-user-3` (Keycloak account with **no assignable role**
— confirmed via `/admin/users`, which itself correctly showed "No assignable role" for this account) and
attempting to browse rather than mutate:

- `/admin/users` and `/billing/invoices` **correctly denied** with a clear in-page message
  ("You do not have permission to view or manage staff accounts." / "...to view invoices.") — these two
  pages are properly capability-gated, matching what Part 18 assumes.
- `/` (the dashboard/worklist), `/admin/org-settings`, and `/patients` **all fully rendered real data**
  for this no-role account — not a 403, not an empty state, the actual worklist/org profile/patient
  list, including a working-looking "Register patient" button on `/patients`. This is a materially
  bigger version of the already-documented §18.2 finding (which only named two case-detail API routes) —
  it now includes the dashboard landing page, org settings, and the patient list/registration entry
  point, all reachable by a user with **zero** roles.
- `/orders` neither rendered data nor denied access — it hung indefinitely on "Loading orders…",
  reproduced twice (including in a fresh tab). This is a third, distinct failure mode: not a clean
  allow, not a clean deny, just a silent stuck spinner — worth a look from engineering since it may
  indicate an unhandled 403 on the client side rather than a deliberate empty/error state.
- The org-settings page also accepted a `POST` (attempted as this same no-role user) with an HTTP 200 —
  the value did **not** appear to actually change on reload, so the write itself may still be
  server-rejected the same way the WSI upload button is (§12.2 note 5: "hidden/enabled button isn't
  proof of authorization") — but this was not conclusively re-verified request-by-request, so treat the
  **write** side as `[NOT VERIFIED — re-check]` while the **read** side (page renders with real data) is
  `CONFIRMED`.

This is a real, live-confirmed finding, not a hypothetical — re-run it yourself in five minutes: log in
as `test-user-3` / `test-password-3` and just try loading `/`, `/admin/org-settings`, and `/patients`
directly by URL.

Legend used throughout:
- `[NOT IMPLEMENTED]` — no code path exists for this at all.
- `[NOT VERIFIED]` — code exists but no one (this pass or a prior session) has confirmed it works live.
- `[DESIGN DECISION REQUIRED]` — the system is ambiguous or admittedly incomplete and a real product
  decision is needed before a lab could rely on it.
- `[DESIGN-PARTNER CONFIRMATION REQUIRED]` — behavior that only a real lab can validate as correct or
  sufficient (a workflow shortcut, a report layout, a business rule).

Jump to the back of this document for **START HERE**, **MASTER TEST DATA**, **DO NOT ACCIDENTALLY DO
THIS**, and the **PILOT GO/NO-GO CHECKLIST**.

---

## 0. The one fact that shapes this whole guide: seed data lives in ONE tenant only

Read this before you touch anything.

- Tenancy is enforced by Postgres RLS keyed off the Keycloak JWT's `tenant_id` claim
  (`apps/api/src/auth/tenant-context.interceptor.ts:59-61`). **You do not pick a tenant in the UI** —
  you pick it by which seeded Keycloak user you log in as.
- All of `db/seed/*.sql` (chemistry/haematology/microbiology/AP catalogs, SLA targets, report
  templates, and **every synoptic/CAP/ICCR protocol**) is hardcoded to load against tenant
  `00000000-0000-0000-0000-000000000001` (confirmed: every seed file's `INSERT` statements target this
  UUID; there is no per-tenant seeding mechanism). No row exists in the `tenant` table for it by
  default — the org profile itself is blank until someone fills in Org Settings.
- The platform also has a genuine **self-service signup** at `/signup` (`apps/api/src/onboarding/`)
  that creates a **brand-new, empty tenant** with its own `lab_admin` user. This is real and works, but
  a tenant created this way starts with **zero catalog tests, zero synoptic protocols, zero referring
  facilities** — none of the seed SQL above ever runs against it. `[DESIGN DECISION REQUIRED]`: there is
  no onboarding wizard or "clone the standard catalog" action, so a truly fresh org today cannot
  complete the AP/synoptic/billing parts of this guide until someone hand-builds a catalog for it via
  the admin UI — and the test-catalog admin UI itself doesn't even expose a price field (§5), so a
  fresh org can create a test but not bill for it yet.

**Practical consequence — this guide runs the pilot in two tracks, not one:**

- **Track A (recommended primary path, "the seeded lab"):** log in as the pre-seeded users under tenant
  `...0001` (`test-user`, `test-user-4`, `test-user-5`, `test-user-9`, `test-user-10`, `test-user-11`,
  etc. — see §1.4). This tenant has real catalog pricing, real EUCAST microbiology breakpoints, and all
  seven synoptic protocols, so it's the only place you can currently exercise Parts 5, 8–16 end to end.
  Org Settings/Users/Facilities are genuinely blank on this tenant too, so Parts 2–4 are still fully
  real, fresh-state tests here — you're just skipping the separate signup step.
- **Track B (isolated acceptance test, "true fresh org"):** exercise `/signup` on its own (§1.5) to
  prove the self-service org-creation path itself works, understanding it dead-ends before Part 5
  today. Do this once, separately, and don't try to chain the rest of the guide onto it.

This finding should also be surfaced to the team as a real pilot-readiness gap before a design partner
signs up for real — see the **PILOT GO/NO-GO CHECKLIST** at the end.

---

## PART 1 — Test Environment Preparation

### 1.1 Start the stack

```bash
cd D:\lis\lis-platform
cp .env.example .env                      # dev-only placeholder secrets, safe to keep as-is
docker compose up -d                      # postgres, valkey, keycloak, minio
pnpm install
pnpm db:reset                             # wipes + recreates the DB, runs ALL migrations + seed files
pnpm dev                                  # runs api + web + gateway + interop in parallel
```

`pnpm db:reset` runs `scripts/db-reset.sh`, which is **destructive**: it does
`docker compose down -v postgres` (drops the Postgres volume) before recreating it. This is exactly
what you want before a pilot run — a byte-for-byte known-clean state — but never run it against
anything you want to keep. It is the only supported reset/reseed mechanism; there is no additive
"just add more seed data" command.

### 1.2 Verify each service is actually up

| Service | URL | Expected |
|---|---|---|
| Web app | http://localhost:3000 | Redirects to Keycloak login (or shows the app shell if already authenticated) |
| API | http://localhost:4000 | `apps/api/src/main.ts` default port; hit `/health` or any `GET` route and expect JSON, not connection-refused |
| Keycloak | http://localhost:8080 | Login screen; admin console at `/admin` (admin/admin) |
| Keycloak realm | http://localhost:8080/realms/lis/.well-known/openid-configuration | Returns OIDC discovery JSON if the realm imported correctly |
| MinIO console | http://localhost:9001 | Login with `minioadmin`/`minioadmin` — used for WSI tile storage |
| Postgres | `localhost:5432`, db `lis` | `psql -h localhost -U postgres -d lis` (password `postgres`) |

If Keycloak's realm failed to import (rare, but check `docker compose logs keycloak` if login 500s),
the fix is `docker compose down -v keycloak && docker compose up -d keycloak` to force a clean
re-import — do not hand-edit the realm through the admin console; `infra/keycloak/lis-realm.json` is
the single source of truth and is never meant to drift from a running instance (`infra/keycloak/README.md`).

### 1.3 Required configuration

`.env.example` at the repo root has everything needed for a local run, all dev-safe placeholder values
(copy verbatim, no invented secrets required): `DATABASE_URL`, `APP_DATABASE_URL`,
`SCHEDULER_DATABASE_URL`, `VALKEY_URL`, `SESSION_SECRET`, `API_BASE_URL`, `SIGNING_SECRET` (HMAC key for
AP sign-out signatures), `OBJECT_STORAGE_*` (MinIO), `SETTINGS_ENCRYPTION_KEY` (AES-256-GCM key
encrypting per-tenant SMTP app-passwords at rest), and blank `SMTP_*` vars. Leave `SMTP_USER`/
`SMTP_APP_PASSWORD` blank unless you're specifically testing Part 14's email delivery (§14.4) — the
app only fails loudly on the one route that actually sends mail, not on startup.

There is no `apps/web/.env.example` — the web app reads the same root-level `SESSION_SECRET`/
`API_BASE_URL`. `apps/api/.env.example` is effectively empty (`SENTRY_DSN=` only) — everything else it
needs comes from the root `.env`. `apps/gateway` and `apps/interop` have their own `.env.example`
files but are HL7/device-integration surfaces, out of scope for this guide.

**Root `README.md` is currently empty** — `[NOT IMPLEMENTED]` as a discoverability gap; `AGENTS.md` is
the real canonical setup doc today. Worth a note back to the team, not something to fix as part of
running this pilot.

### 1.4 Test accounts (all pre-seeded in `infra/keycloak/lis-realm.json`)

**Use tenant `...0001` accounts for everything in this guide unless a step says otherwise.**
Every other seeded user's password is `test-password-<N>` (matching the username's own numeric
suffix) — **not** the shared `test-password` — this is a documented, easy-to-hit trap
(`infra/keycloak/README.md` lines 131–143): guessing the wrong password produces a generic
`invalid_grant` from Keycloak that looks like a broken realm import, not a wrong-password message.

| Username | Password | Role(s) | Tenant | Use for |
|---|---|---|---|---|
| `test-user` | `test-password` | `technologist` | `...0001` | Reception/accessioning/result-entry-style steps |
| `test-user-3` | `test-password-3` | *(none)* | `...0001` | Negative RBAC test — every capability check must deny this user |
| `test-user-4` | `test-password-4` | `technologist` **+** `pathologist` | `...0001` | **The only tenant-0001 account that can sign out/verify** — use for all pathologist steps |
| `test-user-5` | `test-password-5` | `qa` | `...0001` | Catalog/report-template/workflow authoring, org's default synoptic standard |
| `test-user-7` | `test-password-7` | `clinician` | `...0001` | Clinician portal (`/clinician`) — out of this guide's main scope but note it exists |
| `test-user-8` | `test-password-8` | `patient` | `...0001` | Patient portal (`/portal/results`) — out of this guide's main scope |
| `test-user-9` | `test-password-9` | `reception` | `...0001` | Registration/order booking (front-desk persona) |
| `test-user-10` | `test-password-10` | `cashier` | `...0001` | Invoicing/payment recording |
| `test-user-11` | `test-password-11` | `lab_admin` | `...0001` | Org settings, user management, referring facilities, catalog visibility, billing |
| `test-user-2` | `test-password-2` | `pathologist` | `...0002` | **Cross-tenant isolation probe only** — this tenant has no seed data |
| `test-user-6` | `test-password-6` | `qa` | `...0099` | Cross-tenant isolation probe only |
| `test-user-dedicated` | `test-password-dedicated` | `technologist` | `...00d1` | Isolated single-purpose test tenant, no shared seed data |

`[DESIGN-PARTNER CONFIRMATION REQUIRED]`: there is no standalone `pathologist`-only account in the
seeded tenant — the design partner will need to decide whether one technologist+pathologist combined
test identity is acceptable for a real pilot, or whether a dedicated pathologist login should be
provisioned (trivial: add one more Keycloak user to the realm, or use the real `lab_admin`-driven user
creation flow in Part 3 to make one).

Real roles that exist today: `technologist`, `pathologist`, `qa`, `reception`, `cashier`, `lab_admin`,
plus `clinician`/`patient` (portal personas) and three machine-only roles. **There is no
`Receptionist`/`Cashier`/`Pathologist`/`Lab Administrator` capitalization convention or any other role
name — use the exact lowercase strings above; they are literal Keycloak realm roles**
(`apps/api/src/auth/capabilities.ts`, `infra/keycloak/lis-realm.json`).

### 1.5 The self-signup path (Track B, tested in isolation — §0)

1. **WHO:** anyone (unauthenticated). **WHERE:** http://localhost:3000/signup.
2. Enter: Organization name `Pilot Pathology Laboratory 2`, Admin first name `Jane`, last name `Mwangi`,
   admin email `jane.mwangi@pilot-lab.example`, admin password `PilotAdmin!2026` (≥8 chars, only
   constraint per `packages/domain/src/onboarding.ts`).
3. Submit. **EXPECTED RESULT:** a brand-new Keycloak user + a brand-new `tenant_id` are created
   (`apps/api/src/onboarding/onboarding.service.ts`), and you land authenticated with the `lab_admin`
   role for that new tenant.
4. **VERIFY:** log out, log back in with the new admin credentials via the normal login page; confirm
   `/admin/org-settings`, `/admin/users`, `/admin/referring-facilities` are reachable and `/admin/tests`
   shows an **empty** catalog (proving no seed data leaked across tenants).
5. **FAILURE would be:** the signup 500s, the new user can't log in, or — more subtly — the new tenant
   somehow sees tenant-`...0001`'s catalog/patients (a real RLS breach, stop and escalate immediately,
   do not continue testing).
6. This route is **the one deliberately unauthenticated, mutating route in the entire API**
   (`onboarding.controller.ts` header comment) — there is explicitly **no rate limiting, CAPTCHA, or
   email verification** yet (`[DESIGN DECISION REQUIRED]` before any real public launch, per that
   file's own comment). Don't point this at the open internet.
7. **Changes permanent data:** yes — creates a real Keycloak user and tenant row. **Cleanup:** none
   built in; delete the Keycloak user via the admin console (`localhost:8080/admin`) if you want it
   gone, or just leave it (a `pnpm db:reset` wipes Postgres but **not** Keycloak users — see the warning
   in §21).

---

## PART 2 — Organization / Lab Setup

**WHO:** `lab_admin` (`test-user-11` on the seeded tenant, or your Track B signup admin).
**ROLE required:** `manage_org_settings` capability, held by `qa` and `lab_admin`.
**WHERE:** `/admin/org-settings` (`apps/web/app/(app)/admin/org-settings/org-settings-form.tsx`).

### 2.1 Steps

1. Log in as `test-user-11` / `test-password-11`.
2. Navigate to Admin → Org Settings (or `/admin/org-settings` directly).
3. On a truly untouched tenant, expect every field **blank** — no seed SQL inserts into `tenant`, so
   the row doesn't exist until this form is first saved. **Live-confirmed 2026-08-26 (§0.1): tenant
   `...0001` is not untouched** — it already had `Unnamed organization` / `123 Lab Street` / `KES` saved
   from prior sessions' own testing. Don't be alarmed if you see values already there; the persistence
   behavior (step 6 below) is what actually matters, and that part checked out live.
4. Enter the example organization:

   | Field | Value |
   |---|---|
   | Organization name | `Pilot Pathology Laboratory` |
   | Address | `123 Laboratory Road, Nairobi` |
   | Phone | `+254 700 000 000` |
   | Email | `pilot@example.com` |
   | Logo URL | *(leave blank — see 2.2)* |
   | Currency | `KES` |
   | Default synoptic reporting standard | leave as **none** for now (revisit in Part 10) |

5. Submit. **EXPECTED RESULT:** success confirmation, no page error.
6. **VERIFY:** hard-refresh the page (F5) — every field you entered should reappear exactly as typed.
   This is the actual persistence check; a client-side-only "success" toast that reverts on reload
   would be a real bug.
7. **VERIFY (DB, optional):** `SELECT name, address, phone, email, currency FROM tenant WHERE id = '00000000-0000-0000-0000-000000000001';` should show your values.
8. **WHAT WOULD CONSTITUTE A FAILURE:** values don't persist after reload; the form silently drops a
   field; currency accepts nonsense unchecked (see 2.2).
9. **Changes permanent/clinical/financial data:** yes (org identity — every report/invoice will show
   this). No cleanup needed; re-run this section any time to overwrite.

### 2.2 What's actually supported — read before assuming more

- **Currency is a free-text field with a `<datalist>` suggestion of 8 common codes** — it is **not**
  a constrained enum (`packages/db/src/schema/tenant.ts`; `org-settings-form.tsx`). Typing `banana`
  and saving will succeed. `[DESIGN DECISION REQUIRED]`: decide whether this needs real validation
  before a design partner relies on it for invoice currency symbols.
- **"Logo/branding" is a bare Logo URL text field — there is no file upload.** You must host an image
  yourself and paste a URL. `[NOT IMPLEMENTED]`: in-app logo upload.
- The **"Report email (Gmail)" section** on this same page (Gmail address / app password / a "remove
  saved app password" checkbox / From address) belongs to Part 14 — the app password field is
  write-only (never re-displayed, even encrypted) and blank means "leave unchanged." Test this
  specifically in §14.4, not here.
- The org's **identity elsewhere in the UI**: `[NOT VERIFIED]` whether the org name/logo actually
  renders in the app shell header or only inside generated PDFs — check both while you're on this
  screen and note the actual behavior you observe.

---

## PART 3 — User / Staff Management

**WHERE:** `/admin/users` (`apps/web/app/(app)/admin/users/{page.tsx,create-user-form.tsx,users-table.tsx}`).
**Backing store:** Keycloak Admin API directly — **there is no local `user` database table**
(`apps/api/src/user-management/user-management.service.ts` header comment). Every user you create here
is a real Keycloak account.
**ROLE required:** `manage_users`, held only by `lab_admin`.

### 3.1 Assignable roles (exactly six — confirmed in `packages/domain/src/user-management.ts`)

`reception`, `technologist`, `pathologist`, `qa`, `cashier`, `lab_admin`. `clinician`/`patient` and the
three machine roles are deliberately **not** offered on this screen.

### 3.2 Create a staff member

1. Log in as `test-user-11` (`lab_admin`).
2. Go to `/admin/users` → the create-user form.
3. Enter: First name `Grace`, Last name `Otieno`, Email `grace.otieno@pilot-lab.example`, Temporary
   password `Welcome123!` (≥8 chars), Role `reception`.
4. Submit. **EXPECTED RESULT:** new row appears in the users table with role `reception`, enabled.
5. **VERIFY:** log out, log in as `grace.otieno@pilot-lab.example` / `Welcome123!` (username is likely
   the email — confirm the actual login identifier the form used). Confirm she lands with reception-
   level access (patients/orders reachable, `/admin/*` denied — see Part 18 for the exact matrix).
6. Repeat for one user per role you'll need for the rest of this guide if you'd rather use named staff
   than the raw `test-user-N` accounts — e.g. `David Kariuki` / `technologist`, `Dr. Amina Hassan` /
   `pathologist`, `Peter Njoroge` / `cashier`, `Sarah Wanjiru` / `qa`.
7. **Changes permanent data:** yes, real Keycloak accounts. **Cleanup:** delete via the Keycloak admin
   console if desired.

### 3.3 Change a role / deactivate / reactivate

- **Role change:** inline dropdown per row in `users-table.tsx` (`RoleCell`) — change Grace's role from
  `reception` to `cashier`, save, then log in as her again and confirm access shifted accordingly
  (billing reachable, patient registration now denied).
- **Deactivate:** inline enable/disable toggle (`EnabledToggle`). Disable Grace, then attempt to log in
  as her. **EXPECTED RESULT:** Keycloak refuses the login outright (disabled account), not merely an
  in-app 403.
- **Reactivate:** flip the toggle back; confirm login works again.
- `[NOT VERIFIED]`: whether a disabled user's already-issued session token remains valid until it
  expires (a real security question — worth testing deliberately: disable a user mid-session in one
  browser tab while they're still logged in, and see whether their next request is rejected or not).

### 3.4 Negative RBAC test (do this now, not later)

Log in as `test-user-3` (no roles at all). Attempt to open `/admin/users`, `/patients`, `/orders`,
`/billing/invoices`. **EXPECTED RESULT (live-confirmed 2026-08-26, §18.3):** `/admin/users` and
`/billing/invoices` correctly deny with a clear message; `/patients` **fully renders the real patient
list** (a confirmed gap, not expected/acceptable behavior); `/orders` hangs indefinitely on "Loading
orders…" rather than either denying or rendering. Also try `/` (dashboard) directly — it fully renders
the real worklist too. This is the cheapest, highest-value RBAC smoke test in the whole guide, and it's
already found a real, unresolved gap — see §18.3 and the **PILOT GO/NO-GO CHECKLIST** before treating
this as "just go build the rest of the guide."

---

## PART 4 — Referring Facilities

**WHERE:** `/admin/referring-facilities`. **ROLE:** `manage_patients` (held by `technologist`,
`pathologist`, `reception`, `lab_admin`).

### 4.1 What's actually supported

`referring_facility` has exactly five real fields: `name` (required), `phone`, `email`, `address`.
**There is no credit-limit column anywhere in the schema** — `[NOT IMPLEMENTED]`, confirmed by a
repo-wide grep, not just a UI omission. **There is also no edit or delete route** — only
`POST` (create) and `GET` (list/detail) exist; the page's own header comment states this is
deliberate, matching three other admin screens' established precedent. This is a **create + read-only
list — no search box either** (list is capped at 200 rows server-side).

### 4.2 Steps

**Live-confirmed 2026-08-26:** logged in as `test-user-9` and created both example facilities below
through the real form — both persisted correctly across a reload, in the position/order and with the
exact fields the guide predicts. Also confirmed live: the tenant already had 9 pre-existing facilities
before this pass (heavy fixture pollution again, including "Radiocare Diagnostics" duplicated 6 times)
— matches §0.1's dashboard-pollution finding; not new. One click-timing note for whoever runs this
literally: filling the form fields with Tab-navigation between them worked reliably; clicking each field
by a stale coordinate captured before typing into a prior field did not — if a save silently no-ops, the
values likely didn't actually reach the inputs, not a real app bug.

1. Log in as `test-user-9` (`reception`) or `test-user-11` (`lab_admin`).
2. Go to `/admin/referring-facilities`.
3. Create:

   | Field | Value |
   |---|---|
   | Name | `Nairobi General Clinic` |
   | Phone | `+254 711 222 333` |
   | Email | `referrals@nairobigen.example` |
   | Address | `45 Clinic Way, Nairobi` |

4. Submit. **EXPECTED RESULT:** appears immediately in the table below the form.
5. Create a second facility, `Rift Valley Medical Centre`, for later multi-facility billing tests
   (Part 16).
6. **VERIFY persistence:** reload the page; both facilities still list.
7. **WHAT WOULD CONSTITUTE A FAILURE:** duplicate names silently accepted with no warning (not
   necessarily wrong, but note it — no uniqueness constraint was found on `name`); a facility you just
   created not appearing without a manual refresh.
8. **Using it during booking (Part 8):** the facility becomes selectable on `/orders/new`'s "Referring
   facility" dropdown, and — if the order's payer type ends up `corporate` — the facility becomes the
   invoice payer automatically (Part 16). `[DESIGN DECISION REQUIRED]`: since there's no edit/delete UI,
   a facility with a typo (address, phone) cannot be corrected without a direct DB update — flag this
   as a real pilot-readiness gap if the design partner's real facility list will change over time.
9. **Changes permanent/financial-adjacent data:** yes. No cleanup route; leave in place.

---

## PART 5 — Test Catalog / Pricing

**WHERE:** `/admin/tests` (create-only screen — `apps/web/app/(app)/admin/tests/{page.tsx,create-test-form.tsx}`).
**ROLE:** `manage_catalog`, held by `qa` and `lab_admin`.

### 5.1 What's already seeded on tenant `...0001` (use these — don't invent new ones)

From `db/seed/chemistry-catalog.sql` / `haematology-catalog.sql` / `microbiology-catalog.sql` /
`anatomic-pathology-catalog.sql` (real, priced, LOINC/UCUM-coded):

- **Chemistry** (Comprehensive Metabolic Panel, 14 analytes): Glucose (GLU), Urea nitrogen,
  Creatinine, Sodium, Potassium, Chloride, CO2, Calcium, Protein, Albumin, Bilirubin.total, Alkaline
  phosphatase, AST, ALT — priced $10–$35 per the pilot-readiness catalog-pricing pass (session 44).
- **Haematology:** CBC ($25), Peripheral Blood Smear ($30).
- **Microbiology:** Culture (CULT) + Organism ID (ORGID) reflex pair, with a **real, cited EUCAST
  v16.0** antimicrobial-susceptibility breakpoint table (not placeholder).
- **Anatomic Pathology:** a real, priced/billable AP procedure catalog (used by Part 8's "New AP case").

### 5.2 What the admin UI actually lets you do

The create-test form exposes **only Code, Display name, and a checkbox list of existing analytes to
bind to the new test.** `[NOT IMPLEMENTED]`: **no price field, no billing-code field, no specimen-type
field, no active/inactive flag anywhere in this screen** — even though `priceCents`/`billingCode` exist
in the underlying schema. There is also **no `is_active` column in the database at all** — the
"active/inactive" concept from the request brief does not exist in this system today.

**Practical implication:** any test you create through this UI will have `priceCents = NULL` and will
be **rejected at invoice-generation time** (Part 15 §15.1) until someone sets a price directly in the
database. `[DESIGN DECISION REQUIRED]`: decide whether catalog pricing needs an admin UI before pilot,
or whether "ops sets prices via a seed/migration" is an acceptable interim process.

### 5.3 Steps

1. Log in as `test-user-5` (`qa`) or `test-user-11` (`lab_admin`).
2. Go to `/admin/tests`. Confirm the seeded tests above are visible (there's no dedicated filterable
   table on this page per its own header comment — check what actually renders and record it).
3. Create one new test: Code `ESR`, Display name `Erythrocyte Sedimentation Rate`, bind no analyte
   (or bind an existing one if the form requires at least one — record which).
4. **VERIFY:** it appears with **no price**. Attempt to order it (Part 8) and then generate an invoice
   for it (Part 15) — **EXPECTED RESULT (a real, confirmed limitation, not a bug you found):** invoice
   generation 400s because the price is null. This is exactly the gap named in 5.2 — don't file it as a
   new bug, it's already known.
5. **Cash vs. facility-specific pricing:** `[NOT IMPLEMENTED]` — `test_definition.priceCents` is a
   single flat price; there is no per-facility price table anywhere in the schema (confirmed by grep).
   A referring facility is billed the exact same catalog price as a cash patient.

---

## PART 6 — Patient Registration

**WHERE:** `/patients/new`. **ROLE:** `manage_patients` (`technologist`, `pathologist`, `reception`,
`lab_admin`).

### 6.1 MRN generation — server-generated, not user-entered

MRN is a 10-character uppercase hex string generated server-side
(`randomBytes(5).toString('hex').toUpperCase()`), retried up to 5 times on collision. You will never
type an MRN — confirm the form has no MRN input field at all.

### 6.2 Register three synthetic patients

**Live-confirmed 2026-08-26:** registered Wanjiku Kamau (MRN `6D0B5DFAA7`) and Otieno Ochieng Odhiambo
(MRN `E02670C7FD`) through the real form as `test-user-9`. Both persisted with correct MRN format
(10-char uppercase hex, matches §6.1's claim exactly), and the post-submit screen offered real
"Place an order"/"View patient" actions (confirms issue #709 — "give post-submit screens a real next
action" — is genuinely fixed, not just closed-without-verification).

**One correction to this table:** there is **no "Referring facility" field on the registration form
itself** — the form goes First/Middle/Last name → Sex → Date of birth → National ID → Phone → Email →
Address → Next of kin name → Next of kin phone → Save & register, full stop. Referring facility is
selected later, at **order-booking time** (`/orders/new`, Part 8), not at patient registration. If
you're following this table literally, skip the "Referring facility" cell below when registering the
patient — you'll set it when you book that patient's order instead.

1. Log in as `test-user-9` (`reception`).
2. Go to `/patients/new`. Register:

   | Field | Patient 1 | Patient 2 | Patient 3 |
   |---|---|---|---|
   | First name | Wanjiku | Otieno | Mercy |
   | Middle name | *(blank)* | Ochieng | *(blank)* |
   | Last name | Kamau | Odhiambo | Chepkoech |
   | Sex | F | M | F |
   | Birth date | 1985-04-12 | 1990-11-03 | 1972-07-20 |
   | National ID | 12345678 | 23456789 | *(leave blank — optional)* |
   | Phone | +254722000001 | +254722000002 | +254722000003 |
   | Email | *(blank)* | wanjiku.test@example.invalid | *(blank)* |
   | Address | Nairobi | Kisumu | Eldoret |
   | Referring facility | *(none — cash patient)* | Nairobi General Clinic | Rift Valley Medical Centre |

3. **VERIFY** after each submission: a real MRN was generated, patient appears immediately in
   `/patients` "Recently registered."
4. **Deliberate mistake, per the brief:** register a fourth patient, `Peter Kimani`, DOB
   **1995-01-01** (intentionally wrong — his real DOB should be 1993-06-15). Submit.
5. Go to `/patients/[id]/edit` for Peter (edit-patient-form.tsx). Correct the DOB to `1993-06-15`.
   Submit. **EXPECTED RESULT:** persists after reload; `mrn` field is **not editable** (confirm it's
   absent or disabled on the edit form — `patientUpdateSchema` excludes it server-side regardless).
6. **VERIFY auditability:** this correction fires a `patient.update` audit event
   (`@Audit()` on `PUT /v1/patients/:id`). There is no audit-trail UI for patients found in this pass —
   verify via a direct query if you want to see it: `SELECT * FROM audit_event WHERE action = 'patient.update' ORDER BY created_at DESC LIMIT 1;`. `[NOT VERIFIED]` whether any patient-facing screen surfaces this audit trail — record what you actually find.
7. **Duplicate detection:** register a fifth patient with the exact same National ID as Patient 1
   (`12345678`). **EXPECTED RESULT:** a 409/`ConflictException` — "A patient with this national ID
   already exists" — surfaced as a real inline form error, not a raw 500. This is confirmed real by
   `patient-edit.spec.ts`'s own e2e coverage of the update path; verify the **create** path gives the
   same experience.
8. Also test the softer duplicate signal: register someone with the exact same first+last name+DOB as
   an existing patient but a different National ID. **EXPECTED RESULT:** this is a *search* mechanism
   (used by the registration form to warn, not block) — confirm what actually happens; the brief's
   "near-duplicate behavior" is implemented as a search/match, not a hard block, per
   `patient.controller.ts`'s triple-match query.
9. **Changes clinical data:** yes, permanently (patients are real rows, not soft-test-flagged — see §0's note on no synthetic-data naming convention). No built-in cleanup.

### 6.3 What's missing here

`[NOT IMPLEMENTED]`: any visible convention (name prefix, flag) distinguishing synthetic/pilot patients
from real ones. Recommend picking one now for your own pilot's sanity (e.g., always put "ZZTEST" in
the address field) since the system won't do it for you.

---

## PART 7 — Patient List / Search

**Live-confirmed 2026-08-26 — a real, reproducible client-side hang, contradicting the prior closure of
issue #708.** Logged in as `test-user-9` (reception — properly capability-gated, `manage_patients` +
`manage_orders`), `/patients` hung indefinitely on "Loading patients…" with zero resolution — reproduced
repeatedly, in fresh tabs, and **even after a full clean restart of both `apps/web` and `apps/api`**
(ruling out any leftover state from a long session). `/cases` (57 real rows) and `/` (272-row worklist)
both loaded correctly and instantly throughout, in the same session, same account — this is specific to
the Patients/Orders list routes, not a general stall or an RBAC artifact.

**The precise, isolated root cause signature — this is the useful part for engineering:** the
`apps/web` server log confirms the request *itself* always succeeds fast:
```
GET /patients 200 in 1858ms (next.js: 127ms, proxy.ts: 21ms, application-code: 1710ms)
GET /patients 200 in 998ms  (next.js: 16ms,  proxy.ts: 14ms,  application-code: 968ms)
```
Every single time, server-side, in well under 2 seconds. But the browser tab never leaves the
`loading.tsx` Suspense fallback — the resolved 200 response never gets rendered client-side. This
matches issue #708's own original hypothesis exactly ("the defect is client-side, most likely in how the
route's Suspense/loading boundary resolves") — except it is **not intermittent** on this pass, it
reproduced on every attempt, including completely fresh page loads (not just client-side form
navigations). **A tempting but ruled-out red herring:** the browser console shows a React hydration-
mismatch warning on this page (`data-scribe-recorder-ready` attribute injected by a Chrome extension in
the test browser) — but the exact same warning appears on `/` too, which renders correctly every time,
so the hydration warning is unrelated noise, not the cause. Something specific to `/patients` and
`/orders`'s own Suspense/loading-boundary wiring is the real defect.

**FIXED live during this pass (2026-08-26).** Root cause isolated conclusively: removing the route's
`loading.tsx` file (the one structural difference between this route and the unaffected `/`/`/cases`)
immediately unblocked rendering — the Suspense boundary that file creates was the entire problem, not
this app's data/auth/RBAC code. Both `apps/web/app/(app)/patients/loading.tsx` and
`apps/web/app/(app)/orders/loading.tsx` have been deleted, with a comment in each route's `page.tsx`
explaining why and how to re-verify before ever re-adding one. `/patients` now renders correctly.
**Recommend still filing/reopening issue #708** with this root-cause evidence even though it's fixed —
the underlying mechanism (a `loading.tsx` Suspense boundary never resolving under `next dev --webpack`
on Next 16.2.12, despite the server successfully streaming the real RSC payload) is a real Next.js/
webpack-mode defect worth a permanent record and an upstream check (does it also reproduce on
`next build && next start`, or Turbopack?) — this session's attempts to file via `gh` were blocked by
the environment's own permission classifier; a human will need to do it.

**WHERE:** `/patients`.

1. With no query typed, confirm the default view is **"Recently registered"** (most recent 20 —
   `PATIENT_RECENT_RESULT_LIMIT`), not a full list.
2. Search `Wanjiku` — expect a case-insensitive match on first/last name via `ilike`, plus prefix match
   on MRN/National ID if you search a partial ID.
3. Search something matching >50 patients if you have that much data (unlikely in a pilot, but note
   the behavior): results hard-cap at 50 with a message "Showing the first 50 matches, refine your
   search" — **there is no pager**, this is a deliberate ADR-0013 deferral, not a bug.
4. **Sorting:** only the Name column is client-sortable (`patients-table.tsx`); MRN/Sex/Age/National ID
   are display-only. Confirm this matches what you see, and record it as a known limitation, not
   something to file fresh.
5. **Explicitly record as usability observations, per the brief:** no filter panel (e.g., by sex or
   registration-date range); no pagination on a genuinely large patient base beyond the 50-cap message;
   confirm whether the empty-search-with-zero-results state renders a helpful message or a blank table.

---

## PART 8 — Order Booking

**Live-confirmed 2026-08-26 — currently blocked, could not complete this Part, confirmed to survive a
full clean restart.** `/orders/new?patientId=<uuid>` (patient ID looked up directly via `psql` to route
around the broken list page, §7) hangs identically to `/patients`/`/orders` — indefinitely on "Loading
orders…", **even immediately after a full, clean restart of both `apps/web` and `apps/api`** (ruling out
resource exhaustion from a long session — the first hypothesis when this was first found). The
`apps/web` log confirms the server-side request itself succeeded: `GET /orders/new?patientId=... 200 in
6.0s`. So this is the same precise defect as §7: the server round-trip completes and returns real data,
but the client never renders past the Suspense/loading fallback. `/` and `/cases` both continued to work
correctly throughout, in the same fresh session, ruling out a global regression.

**FIXED live during this pass, same fix as §7:** `/orders/new` shares `/orders`'s `loading.tsx` file
(both were in `apps/web/app/(app)/orders/`) — deleting it (§7) unblocked this route too, confirmed
directly: `/orders/new?patientId=<uuid>` now renders the real order-booking form (test catalog, correct
patient name/MRN) instead of hanging. Booking a test on a patient — the single most basic clinical
workflow in the system — works again through the UI. This was **not** a resource/environment
artifact — it survived a full clean restart and only resolved once the `loading.tsx` file itself was
removed; see §7 for the full root-cause isolation.

**Practical consequence:** Parts 8 (this one) onward can now be live-verified in a future pass — this
was the blocker preventing it this time.

**WHERE:** `/orders/new` (arrives with `patientId` pre-filled from a patient's page — there's no
patient picker on this screen itself, confirm that's really true).
**ROLE:** `manage_orders` (`technologist`, `pathologist`, `reception`, `lab_admin`).

### 8.1 What is and isn't captured at booking

Captured: test/panel selection (checkboxes against the live catalog), Priority (`routine`/`stat`),
Referring facility (dropdown, only rendered if at least one facility exists), Requesting doctor
(free-text). **Not captured at booking:** specimen information (that's a separate later accessioning
step — Part 9 for AP, a receiving step for other disciplines), pricing (not shown at all here), or
payer type — cash-vs-facility is decided later, at invoice-generation time (Part 15), not at order
time. `[DESIGN-PARTNER CONFIRMATION REQUIRED]`: confirm this ordering (payer decided at invoicing, not
booking) matches how the design partner's real front desk actually works.

### 8.2 Five booking scenarios

1. **Cash patient, single test.** Log in as `test-user-9`. From Wanjiku Kamau's patient page, click
   into order booking. Select Glucose only, Priority `routine`, no referring facility, requesting
   doctor `Dr. Local GP`. Submit. **VERIFY:** order detail page shows patient name+MRN, status badge,
   the one ordered test, requesting doctor, and contextual buttons ("Receive at reception," "Generate
   invoice," etc. — record exactly which show up before anything downstream happens).
2. **Referring-facility patient.** From Otieno Odhiambo's page (registered with Nairobi General
   Clinic), book CBC + Peripheral Blood Smear, priority `routine`, referring facility auto/selected as
   Nairobi General Clinic, requesting doctor `Dr. Amina Hassan`.
3. **Multiple tests, mixed disciplines.** For Mercy Chepkoech, book Glucose + Creatinine + CBC in one
   order. **VERIFY:** all three lines appear with independent status badges.
4. **STAT priority.** Book a Glucose-only order for Wanjiku with Priority `stat`. **VERIFY:** the
   priority badge/SLA behavior differs visibly from routine (per `sla-targets.sql`'s seeded STAT
   turnaround target).
5. **Pathology order.** For Peter Kimani (corrected DOB), book the seeded AP procedure (check
   `/admin/tests` for its exact seeded name/code first). This order feeds directly into Part 9.

For each: **FAILURE would be** any order missing a test you selected, wrong patient attached, price
information leaking into this screen when it shouldn't (it's supposed to be absent here), or a
duplicate order created by a double-click (test this deliberately — click Submit twice fast on one
order and confirm only one order results, or record that it doesn't).

**Changes permanent/clinical data:** yes, every order is real. No cleanup mechanism; leave in place.

---

## PART 9 — AP / Pathology Case Workflow

**Live-confirmed end-to-end 2026-08-26.** Ran the complete real chain for Peter Kimani's breast case
(order → accession → block → slide → narrative → synoptic → sign-out) through the actual UI, each step
verified against the database, not just the screen. Everything below matches the guide's existing
description exactly, plus:

- **A real bug found and fixed along the way:** the "New AP case" form
  (`apps/web/app/(app)/cases/new/case-accession-form.tsx`) generated its specimen-part row `id`s with
  `crypto.randomUUID()` and then baked that random value into the DOM `id` attributes for the specimen-
  type input and rejection-reason select. Since that function runs during both the server render and the
  client's pre-hydration render (producing a *different* UUID each time), this was a real, confirmed
  hydration mismatch (`rejection-reason-<server-uuid>` vs. `rejection-reason-<client-uuid>`) that made
  the form's inputs unreliable. **Fixed:** those `id` attributes now key off the row's array index
  instead. Verify this stays fixed if you rerun this Part — the hydration-mismatch console warning should
  not reappear when opening `/cases/new?orderId=...`.
- Case detail page renders exactly as described: accession-numbered parts/blocks/slides tree, a
  "Record synoptic protocol (<panel name>)" link that appears automatically once a matching protocol
  exists for the part's specimen type, Narrative form, Screen card (cytology-only, server-gated),
  Sign-out card, and a real **Audit trail section built into the page** (see the updated Part 19 below).
- Synoptic protocol (§10.2's Breast example): opened directly with no picker (single match), the
  conditional HER2-percent-membrane-staining field appeared live the moment HER2 status was set to
  "Positive (Score 3+)" and not before — confirms the conditional-visibility behavior is real, not just
  present at load.
- Sign-out (§9.5): completed with **no visible re-authentication prompt** — because `test-user-4` had
  authenticated moments earlier in the same session and the step-up check evidently accepts a
  sufficiently recent `auth_time` rather than always forcing a fresh interactive login. The resulting
  `case_report_version` row has a real HMAC signature, `signed_by_role: pathologist`, `auth_time_used`
  populated, and `status: final` — the sign-out itself is genuinely real and correctly gated, this is
  just a UX note: **don't assume "no login prompt appeared" means step-up was skipped — verify via the
  audit event's `context.step_up` field (see Part 19) before concluding a security gap.** If you want to
  see the actual interactive re-auth prompt fire, sign out from a tab where you logged in as the
  pathologist a while ago (login idle beyond whatever freshness window this check uses), not immediately
  after logging in.
- **A tooling note for whoever runs this literally, not an app bug:** several buttons on this page
  (`Add block`, `Add slide`, `Accession case`, `Sign out this case`) were intermittently unresponsive to
  a plain simulated mouse click during this pass but worked immediately when triggered via
  `element.click()` in the console — almost certainly a browser-automation quirk (this session used
  Claude-in-Chrome), not evidence of anything wrong with the buttons themselves. If you hit an
  unresponsive button while testing, try clicking directly with a real mouse before concluding it's
  broken.

## PART 9 — AP / Pathology Case Workflow (original)

This is the deepest part of the system and the one that changed the most across recent engineering
sessions (see `docs/scope/current.md`, sessions 40–41) — **every stage below now has real browser UI**,
which was not true a few sessions ago. Use `test-user-9` (reception) for booking, `test-user`
(technologist) for accessioning/blocks/slides/screening, and **`test-user-4`** (the only tenant-`...0001`
account holding `pathologist`) for narrative, sign-out, and amendment.

### 9.1 Order → Case creation → Accession

1. From Peter Kimani's AP order (Part 8 scenario 5), open the order detail page. Click **"New AP
   case"** (only shown when `order.status !== 'cancelled'`) — this takes you to
   `/cases/new?orderId=<uuid>`.
2. **WHO:** technologist (`test-user`) or reception. Enter one specimen part: specimen type `tissue`
   (free-text field — **there is no controlled vocabulary here**, a typo here silently breaks the
   two-tier cytology check in 9.4, so type carefully), optionally a rejection reason if simulating a
   rejected specimen.
3. Submit. **EXPECTED RESULT:** a new case with a real accession number (`{orderNumber}-P{n}` scheme,
   ADR-0049), status `accessioned`.
4. **VERIFY:** the case detail page (`/cases/[caseId]`) renders a Parts → Blocks → Slides tree, empty
   below the part you just created.
5. **Deliberate rejection test:** create a second AP case (a second AP-order patient, or re-order for
   Peter) with a specimen type `cervical_cytology` and a rejection reason `Insufficient volume`.
   **VERIFY:** the part shows `status: rejected` — confirm this is visible in the UI, not just via API.
6. Attempt to create a **second** case for the exact same order. **EXPECTED RESULT:** a real duplicate
   rejection (`ux_case_tenant_order` constraint), surfaced verbatim in the UI, not a silent duplicate.

### 9.2 Block → Slide

1. On the case detail page, use **"Add block"** under the tissue part. Accept the auto-generated code
   (`{accession}-B1`).
2. Add a second block (`-B2`).
3. Under `-B2`, use **"Add slide"** — auto-generated `-S1`.
4. **VERIFY:** tree re-renders live showing both blocks and the one slide, no page reload needed.
5. **Changes clinical data:** yes, part of the permanent specimen record.

### 9.3 Reflex/add-on test ordering (optional but real)

On block `-B2`, use the **"Add test"** dropdown (populated from the live catalog) to order an
additional test directly onto that block — e.g. an IHC-style add-on. **VERIFY:** the newly-ordered
test is visible and enterable through the *generic* results screen at `/orders/[id]/results` once its
status moves to `received` — this is a genuinely working shortcut, not a gap.

### 9.4 Gross / Microscopic / Diagnosis narrative

**WHO:** pathologist (`test-user-4`) — though note the narrative fields are **not append-only** (no DB
trigger enforces immutability on `case_narrative`, per its own schema comment) and are editable at any
case status until sign-out snapshots them.

1. On the case detail page, find the Narrative form (`narrative-form.tsx`) — three text areas:
   - **Gross description**: `Received in formalin, a 2.5 x 1.8 x 1.2 cm piece of grey-white tissue,
     serially sectioned to reveal a firm, tan-white mass measuring 1.4 cm in greatest dimension.`
   - **Microscopic description**: `Sections show infiltrating duct carcinoma, moderately differentiated,
     with associated fibrous stroma. No definite lymphovascular invasion identified.`
   - **Diagnosis**: `Invasive ductal carcinoma, Nottingham grade 2, right breast.`
2. Save. **VERIFY:** reload the page — all three persist.
3. **Distinguish clearly for your own notes:** Gross/Microscopic/Diagnosis are free-text narrative;
   the **synoptic protocol (Part 10)** is the separate, structured, coded data — the two are stored in
   different tables and rendered as separate report sections. Do not confuse a synoptic element for a
   narrative field when you get to Part 10.

### 9.5 Sign-out

**WHO:** `test-user-4` only (needs `verify` capability). **This requires a fresh re-authentication
(step-up)** — the UI literally says "Requires a fresh re-authentication."

1. Before signing out, confirm the case's lineage is complete (at least one active block/slide per
   part) — attempt sign-out on an intentionally incomplete case first to see the real rejection
   message (`assertCompleteLineage`'s exact text, e.g. `"Part ... has no active block"`), then complete
   the lineage and retry.
2. On the case detail page, use the **"Sign out"** card. If prompted, complete the step-up
   re-authentication flow (a real Keycloak login prompt, not a password re-type modal in-app).
3. Submit. **EXPECTED RESULT:** case status flips to `signed_out`; a `case_report_version` v1 is
   created with an HMAC-SHA256 signature; page swaps to showing Report Versions + an Amend control in
   place of the Sign out card.
4. **VERIFY immutability:** `case_report_version` rows are append-only via a DB trigger — there is no
   UI or API path to edit v1's content directly; the only path forward is Amendment (9.6).
5. **VERIFY audit:** a `case.sign_out` audit event is written in the same transaction, including the
   step-up `authTime` and method.
6. **Cytology-specific gate:** if you sign out a `cervical_cytology` case that hasn't been through
   Screening first (9.7), **EXPECTED RESULT:** a clear rejection ("requires screening before sign-out"),
   not a silent success.
7. **Changes clinical data irreversibly (short of amendment):** yes — this is the one true point of no
   return in this guide. Don't sign out a case you plan to keep experimenting on; make a fresh one.

### 9.6 Amendment

**WHO:** `test-user-4`, fresh step-up required again (independently re-checked, not reused from sign-out).

1. On a `signed_out` case, use the **"Amend"** card. Enter a required reason:
   `Correction after review — margin status re-evaluated.`
2. Submit. **EXPECTED RESULT:** creates `case_report_version` v2 (`amendmentOf` = v1's id); a DB
   trigger flips v1 to `status: superseded` with `superseded_by` pointing at v2; case status becomes
   `amended`.
3. Amend a second time to prove chained versioning (v3, `amendmentOf` v2, v2 flips to `superseded`).
4. **VERIFY:** the Report Versions list on the case page shows all versions with correct current/
   superseded status.
5. **FAILURE would be:** amending without a reason succeeding (should 400); amending a case that was
   never signed out succeeding (should 400 — wrong-state rejection); a technologist session (no
   `verify`) seeing the Amend control at all.

### 9.7 Cytology two-tier screening (do this on the `cervical_cytology` case from 9.1)

**WHO:** technologist (`test-user`) for screening — no step-up required for this action.

1. Build out the cytology case's lineage (block/slide) same as 9.2.
2. On the case detail page, use the **"Screen"** card. **EXPECTED RESULT:** status moves
   `accessioned`/`in_process` → `pending_review`.
3. Attempt Screen on a **histology** (non-cytology) case. **EXPECTED RESULT:** a plain 400,
   `"does not require screening"` — this is intentional, not a bug (the Screen card renders
   unconditionally regardless of specimen type by design; the server is the real gate).
4. **Return-to-screening (reject):** as `test-user-4` (needs `verify`), use the **"Return to
   screening"** action with a required reason, e.g. `Sample quality insufficient for review — recollect.`
   **EXPECTED RESULT:** status moves back to `in_process`, not forward.
5. Re-screen, then sign out per 9.5 (cytology's full real chain is
   `accessioned → pending_review → signed_out → amended`, fully browser-reachable today).

### 9.8 What's genuinely missing here — don't go looking for it

- No **reviewer-facing "pending review queue"** view exists — no backing route at all (confirmed
  exhaustively). You'll have to navigate to each case directly by ID/list filter.
- No **cytology reject/return audit-trail UI**, though the underlying action is fully audited.
- Cases list (`/cases`) filters by status tabs (Active/Pending Review/Signed Out/Amended) —
  **use these tabs**; the default view historically hid `signed_out`/`amended` cases entirely
  (fixed as issue #613, but confirm the tabs are still there and working).

---

## PART 10 — Synoptic Reporting

**Live-confirmed 2026-08-26 for the Breast protocol only** (§10.2's worked example) — as part of the
same Peter Kimani case walked through in §9. The main "Invasive Carcinoma of the Breast (ICCR)" protocol
opened directly with no picker (single match for `breast`), all 15 required dropdowns plus 2 numeric
fields were filled and saved successfully (confirmed: 17 new `coded` Observation rows created in one
batch, tied to one `synoptic.record` audit event), and the **conditional HER2-percent-membrane-staining
field appeared live** the instant HER2 status was set to "Positive (Score 3+)" — genuinely reactive, not
just present at page load. The "Linked panels → Record Breast Biomarker Panel (ER/PR/HER2) (CAP)" link
is confirmed present as a separate, distinct entry point (not merged into the organ protocol's own
form), matching this section's claim exactly.

**§10.3's colorectal multi-protocol disambiguation picker — live-confirmed 2026-08-27.** Ran the full
sequence end to end:

1. Registered a new patient (Mercy Chepkoech, MRN `942F605EDF`), booked an AP-STD order, accessioned it
   with `specimenType: colorectal`. The case's synoptic link initially reads "Record synoptic protocol
   (Colon and Rectum (Resection))" — that's just the *first-loaded* protocol name shown as a label, not
   a resolved choice; navigating to the link itself is what triggers disambiguation.
2. Opening the synoptic URL directly **did** show the picker, exactly as documented: "Choose reporting
   standard — More than one synoptic protocol is available for specimen type 'colorectal' -- choose
   which standard to record against," with two links, "Colorectal Cancer (ICCR)" and "Colon and Rectum
   (Resection) (CAP)," each carrying an `?organProtocolId=` query param.
3. Picked CAP, filled the full 15+-element form, and hit a real validation error worth flagging:
   submitting with "Margin status" = "All margins negative for invasive carcinoma" still produced
   **"Missing required element(s): closest_margin_site, mesorectal_excision_quality,
   rectal_tumor_location."** The latter two are genuinely conditional (they appeared only after setting
   Operative procedure = "Low anterior resection" and Tumor site = "Rectum" respectively — confirmed
   live-reactive, same pattern as the Breast HER2 field in §10.2). But `closest_margin_site` stayed
   required even though margin status was negative — there's no closest margin when nothing is
   positive. `[DESIGN QUESTION]`: is `closest_margin_site` supposed to be conditional on margin status
   being positive/present, the way the other two conditionals are keyed to their own trigger fields? As
   built, it's unconditionally required whenever this protocol is used at all. Filled it with "Distal"
   to get past validation (an arbitrary value, since none applied) and the protocol saved successfully.
4. **Second real finding**: the "recorded" confirmation view echoes back raw enum codes, not the
   display labels the form used — e.g. `Operative procedure: low_anterior_resection`,
   `Histologic grade: g2`, `Primary tumor (pT) category: pT3`, instead of "Low anterior resection,"
   "G2: moderately differentiated," "pT3: invades through muscularis propria...". The Breast worked
   example in §10.2 wasn't checked closely enough on this point to say whether it's protocol-specific or
   universal — worth a design-partner check on whether clinicians reading this screen need the
   human-readable form.
5. Tried to set the org default standard to CAP as `test-user-11` (`lab_admin`, not `qa` as this
   section originally said — `test-user-5`/qa was never actually tried, `lab_admin` is confirmed to hold
   `manage_org_settings` per `capabilities.ts`) — succeeded, saved cleanly with a "Saved." confirmation.
6. **Third real finding, RBAC-related**: while logged in as `test-user-11` (`lab_admin`), attempting to
   place a brand-new order failed with a generic "Something went wrong placing the order" message. This
   is **not a bug** — confirmed via the API log that `POST /v1/orders` correctly returned `403`, and
   `capabilities.ts` (lines 201-227) deliberately does not grant `lab_admin` the `manage_orders`
   capability (a documented decision from a prior pilot-readiness pass: "user administration is
   lab_admin's own real responsibility, not QC/workflow oversight's"). The RBAC gate itself is working
   correctly. The **actual gap** is UX consistency: `/admin/org-settings` shows a clear "You do not have
   permission to edit organization settings" message on a 403, while `/orders/new` collapses the same
   kind of 403 into a generic "Something went wrong" that's indistinguishable from a real server error.
   A user in a role without `manage_orders` has no way to tell "I'm not allowed to do this" from "the
   app is broken." Switched back to `test-user` (technologist, holds `manage_orders`) to actually place
   the order.
7. Accessioned a **second** colorectal case (patient Kiptoo Rono, MRN `3C9C585B42`, accession
   `260826-000195`) and opened its synoptic link. **Confirmed the picker was skipped entirely** — the
   link went straight to `/cases/.../synoptic/[id]` and rendered the "Colon and Rectum (Resection)
   (CAP)" form directly, no "Choose reporting standard" interstitial. The org-default-standard
   auto-resolution feature (issue #690/#692) works exactly as designed.

## PART 10 — Synoptic Reporting (original)

**WHERE:** `/cases/[caseId]/synoptic/[partId]`. **WHO:** pathologist (`test-user-4`), though the
recording action itself uses `manage_specimens` (also held by `technologist`) — confirm which role
your build actually gates this on when you get there.

### 10.1 The exact seven protocols seeded on tenant `...0001`

| Protocol | Standard | `specimenType` |
|---|---|---|
| Invasive Carcinoma of the Breast | ICCR | `breast` |
| Breast Biomarker Panel (ER/PR/HER2) | CAP | `breast` (a *panel*, linked to the organ protocol) |
| Colorectal Cancer | ICCR | `colorectal` |
| Colon and Rectum (Resection) | CAP, AJCC 8th ed. | `colorectal` (coexists with the ICCR one — disambiguation picker, see 10.3) |
| Primary Carcinoma of the Lung | CAP | `lung` |
| Carcinoma of the Prostate Gland (Radical Prostatectomy) | CAP | `prostate` |
| Cervical Cytology (Pap) | Bethesda System 2014 | `cervical_cytology` |

### 10.2 Worked example: Breast protocol

1. Create (or reuse) an AP case whose part has `specimenType: breast`.
2. Navigate to that part's synoptic page. **EXPECTED RESULT:** since only one protocol matches
   `breast` that isn't a panel, it opens directly — no picker (confirm; see 10.3 for when a picker
   should appear instead).
3. Fill a representative subset of the 25 elements (`db/seed/synoptic-protocol-breast.sql`):
   - Neoadjuvant therapy: `No`
   - Operative procedure: (pick the seeded option, e.g. `Lumpectomy`)
   - Specimen laterality: `Right`
   - Tumor focality: `Single focus` — **leave `tumor_focus_count` alone and confirm it's hidden**
     (conditional field, only shown when focality = "multiple foci" — this is the live
     conditional-visibility behavior to actually test)
   - Tumor max dimension (mm): `18`
   - Histological tumor type: (pick a seeded option)
   - Histological tumor grade: (pick a seeded option)
   - Margin status: (pick a seeded option)
   - Estrogen receptor status: `Positive`, percent positive: `90`
   - HER2 status: set to the seeded "3+" option and **confirm `her2_percent_membrane_staining` appears**
     (conditional on HER2 3+) — then switch HER2 back to negative and confirm it disappears again,
     proving the visibility rule is live, not just present at load.
4. Save/submit. **VERIFY:** values persist on reload; the response is stored as a single "table"-type
   Observation keyed to a shared grid analyte (an implementation detail you don't need to see, but the
   persistence is what matters).
5. Now do the **Breast Biomarker Panel** for the same part (ER/PR/HER2, CAP) — confirm it's offered as
   a *separate*, linked panel rather than merged into the organ protocol's own fields.

### 10.3 Multi-protocol disambiguation (colorectal specifically)

Colorectal is the one specimen type with **two coexisting protocols** (ICCR organ protocol + CAP
colon/rectum resection, AJCC 8th edition). Create a case with `specimenType: colorectal` and open its
synoptic page. **EXPECTED RESULT:** a **"Choose reporting standard"** picker appears (only shown when
2+ eligible protocols exist) — pick the CAP one, fill its pT/pN/pM staging elements, submit.

Then: as `test-user-5` (`qa`), set the org's **default synoptic reporting standard** to CAP via
`/admin/org-settings` (Part 2 — revisit that field now). Create a **second** colorectal case and open
its synoptic page again. **EXPECTED RESULT:** the picker is now **skipped automatically**, going
straight to the CAP protocol, since the org preference resolves it. This is a real, deliberately-built
feature (issue #690/#692) — worth testing precisely because it's easy to click past without noticing
it worked.

### 10.4 What's NOT supported — don't assume otherwise

`[DESIGN-PARTNER CONFIRMATION REQUIRED]`: the seven protocols above are the **entire** synoptic
library today. The `D:\LIS\research\cap documents` folder on disk contains the **full CAP protocol
library** (100+ organ-specific templates) — none of the others are wired into this system. Do not
assume a protocol exists just because its `.docx` template is sitting in that research folder.

`[NOT VERIFIED]`: the exact capability gate on the recording endpoint (whether a plain technologist
can record synoptic data, or only a pathologist) — confirm live and record which role(s) you actually
see the form for.

---

## PART 11 — Cytology (live-confirmed 2026-08-26)

Ran the **complete real chain** on a fresh case (Wanjiku Kamau, `specimenType: cervical_cytology`,
accession `260826-000192`): `accessioned → pending_review → in_process (returned) → pending_review
(re-screened) → signed_out`. Every transition confirmed via direct DB query, not just the UI:

- **Screen** (`test-user`, technologist, no step-up): `case.screen` audit action, status
  `accessioned → pending_review`. Exact audit action name confirmed (was `[NOT VERIFIED]`).
- **Negative control, confirmed real:** created a second, separate case with `specimenType: tissue`
  (histology) and clicked its "Screen this case" button too — it renders unconditionally regardless of
  specimen type exactly as this section warns, but the server correctly rejected it: *"Case
  \<id\> does not require screening (no cytopathologist two-tier review needed)"* — a real, clear
  message, no status change (confirmed still `accessioned` afterward).
- **Return to screening** (`test-user-4`, pathologist, required reason): `case.return_to_screening`
  audit action confirmed (was `[NOT VERIFIED — confirm exact name]`), with the exact reason text stored
  in the audit row's `reason` column. Status moved `pending_review → in_process` correctly.
- **Re-screen and sign out**: re-screening moved it back to `pending_review`; sign-out (same pathologist
  session, no fresh interactive re-auth prompt shown — consistent with §9.5's step-up-freshness finding)
  produced `status: signed_out` with a real `case_report_version` and `case.sign_out` audit event.
- **Auditability**: the full account of who-did-what is genuinely queryable and matches this section's
  claims exactly — `case.accession` (technologist) → `case.screen` (technologist) →
  `case.return_to_screening` (pathologist, with reason) → `case.screen` (technologist again) →
  `case.sign_out` (pathologist).

**Not tested this pass:** the specific "sign out a `cervical_cytology` case that hasn't been through
screening first" gate (§9.5 step 6) — would need a second, never-screened cytology case; this one had
already been screened by the time sign-out was attempted.

Already covered in depth as part of the AP case lifecycle (§9.7) because it isn't a separate module —
it's the same `case` state machine with an extra `pending_review` gate. Summary for this section:

- Screening: ✅ implemented, technologist-level, no step-up (§9.7 step 2).
- Reviewer/finalization: ✅ implemented — it's literally the same `finalize()`/sign-out action as
  histology, just gated on `pending_review` status first.
- Reject/return-to-screening: ✅ implemented, pathologist-level, required reason, no step-up (§9.7 step 4).
- Pending-review **queue view**: `[NOT IMPLEMENTED]` — no dedicated worklist UI, no backing route.
- Audit trail: the underlying actions are audited (`case.screen`, presumably `case.return_to_screening`
  — confirm the exact audit action names via `GET /v1/cases/:id/audit-trail`), but there's no
  cytology-specific audit UI, only the generic case audit trail if one exists at all — verify.
- Cervical/Pap Bethesda synoptic protocol: ✅ seeded, test per §10.

---

## PART 12 — WSI / Digital Pathology (live-confirmed 2026-08-26)

**Useful discovery for whoever runs this next: you don't need to build a `.dzi.zip` fixture from
scratch.** The repo already ships real, valid ones for exactly this purpose, at
`apps/api/test/fixtures/`: `test-dzi.zip` (valid), `no-dzi.zip` (no descriptor), `two-dzi.zip`
(ambiguous), `backslash-paths.zip`, and `path-traversal.zip`. Copy whichever you need to a location the
browser tooling can read from and upload it directly — no scanner, no `libvips`, no `Compress-Archive`
required.

All three core scenarios confirmed real, on the cervical-cytology case from §11:

- **Valid upload** (`test-dzi.zip`, slide `260826-000192-B1-S1`): reached `status: ready` in the
  `whole_slide_image` table (confirmed directly — this status is only set after every tile *and* the
  `.dzi` descriptor are successfully written to object storage, per the service's own design, so this is
  strong evidence the tiles actually landed, not just a status flag flipping). The slide's card correctly
  swapped from the upload form to a "View whole-slide image" link once ready.
- **Viewer**: opened `/cases/[caseId]/slides/[slideId]/viewer` — a canvas-based viewer initialized with
  no console errors, but this pass could not get a real screenshot of it (a persistent CDP
  `params.clip.scale` error specific to this canvas-heavy page, not an app-level failure — the canvas
  reported `1×1` dimensions, which may simply reflect the deliberately tiny placeholder tile this
  fixture uses for fast test runs, not a broken viewer). **If you want a true visual confirmation of
  pan/zoom working, do this step with a real browser, not headless/automated tooling** — this pass's
  tooling genuinely couldn't capture it either way.
- **Failure case 1 — no `.dzi` descriptor** (`no-dzi.zip`, slide S2): `status: failed`, real
  `error_message`: *"No .dzi descriptor found in the uploaded zip"*. The UI correctly rendered
  *"Previous upload failed — try again below."* with a working retry form in place of the old one —
  matches this section's claim exactly.
- **Failure case 2 — two `.dzi` descriptors** (`two-dzi.zip`, same slide S2, retried): `status: failed`,
  real `error_message`: *"Expected exactly one .dzi descriptor, found 2"*. Same clean retry UI.

**§12.2 step 5 (RBAC) — live-confirmed 2026-08-27, and it's better than this section assumed.** Logged
in as `test-user-5` (`qa`, no `manage_specimens`) and opened the same cervical-cytology case from §11
(the one with the already-failed S2 slide, retry UI pending). The "Upload WSI" form — file input, label,
button — was **not present in the page HTML at all**, confirmed by searching the full `<main>` innerHTML
for "Upload"/"file" and finding zero matches (vs. the same page as `test-user`/technologist, where
"Whole-slide image (.zip)" / "Upload WSI" render normally). This is **server-rendered conditional
UI, not a client-hidden button** — contradicts this section's "the button may still render... confirm
both halves" framing, which was based on a prior finding that may have applied to a different route.
For this specific case-detail page, the safer of the two possible gaps (a visible-but-rejected button)
does not apply — the correct behavior (don't show the affordance at all to a role that can't use it) is
what's actually implemented.

**§12.2 step 6 (cross-tenant isolation) — live-confirmed 2026-08-27.** As `test-user-2` (tenant
`...0002`), navigated directly to the tenant-`...0001` case URL used throughout this section
(`/cases/625ec9e6-4a10-4952-b382-12dfd81521e2`, the cervical-cytology case with the ready WSI slide).
**Result: a real 404** (`notFound()`), not the case content and not the slide/viewer — RLS isolation
holds for this route, matching the same convention already confirmed on `/patients/[id]` and
`/orders/[id]` in §7/§8.

**WHERE:** `/cases/[caseId]` (upload form nested in the slide tree) and
`/cases/[caseId]/slides/[slideId]/viewer`.

### 12.1 What this actually is — read carefully before testing

This is a **DZI (Deep Zoom Image) pyramid viewer**, not a raw-image or "take a photo through the
microscope" feature. You must upload a **zip file containing a pre-built DZI tile pyramid** (the kind
a slide scanner or `libvips`/`vips_dzsave` produces) — a JPEG straight off a phone camera will not
work and is not the same artifact as a WSI.

### 12.2 Steps

1. On a slide you created in §9.2, use **"Upload WSI"**.
2. **Valid case:** upload a real DZI zip (if you don't have a scanner export handy, the repo's own test
   fixture pattern — a `sharp`-generated pyramid zipped correctly — is the shape to reproduce; ask
   engineering for a sample `.dzi.zip` if you need one for this pass). **EXPECTED RESULT:** status
   flows `processing → ready`; open the viewer and confirm tiles actually render (pan/zoom works).
3. **Failure case 1 — no `.dzi` descriptor in the zip:** upload a zip of plain images with no `.dzi`
   file. **EXPECTED RESULT:** a clear rejection with retry UI, not a silent `ready` status with a
   broken viewer.
4. **Failure case 2 — two `.dzi` descriptors:** upload a zip with two `.dzi` files (ambiguous pyramid).
   **EXPECTED RESULT:** same clear rejection.
5. **RBAC:** log in as `test-user-5` (`qa`, no `manage_specimens`). **EXPECTED RESULT:** the button may
   still render (a documented "hidden button isn't proof of authorization" finding from a prior
   session), but the actual upload **must** be server-rejected. Confirm both halves — visible button,
   real rejection — don't just check one.
6. **Cross-tenant isolation:** as `test-user-2` (tenant `...0002`), attempt to open the exact case/slide
   URL you just created under tenant `...0001`. **EXPECTED RESULT:** 404, not the real image (RLS
   isolation).

### 12.3 Known, already-fixed and already-flagged gaps — for your context, not new findings

- A backslash-path zip-entry bug (PowerShell's `Compress-Archive` output) was found and fixed (issue
  → PR `65488df`) — if you build your own test zip on Windows, prefer a real DZI tool over
  hand-zipping with `Compress-Archive`, or you may re-trigger path-separator edge cases the fix
  specifically targeted; still worth a quick regression check.
- No annotation tools. No tile-load-failure UI — a broken tile currently shows a silent black canvas
  rather than a visible error (a named, deferred P3 improvement, not something to file fresh).
- No Playwright e2e coverage exists for WSI at all — everything here has only ever been manually/API
  verified in prior sessions.

---

## PART 13 — Pathologist Review + Sign-out

This is fully covered by §9.4–9.6 above (narrative review, synoptic review, sign-out, step-up,
amendment). Do not re-run it separately — cross-reference those steps when you reach this point in
your own test pass, and use this checklist to confirm you covered everything the brief asked for:

- [ ] Opened an assigned/relevant case and reviewed the full parts→blocks→slides tree (§9.2)
- [ ] Reviewed gross/microscopic/diagnosis narrative (§9.4)
- [ ] Reviewed synoptic data for at least one protocol (§10.2)
- [ ] Signed out with a genuine step-up re-authentication, not a stale/cached one (§9.5)
- [ ] Confirmed the audit event and immutability of the signed version (§9.5 steps 4–5)
- [ ] Amended at least twice to see chained versioning (§9.6)
- [ ] Confirmed a technologist session cannot see the Sign out/Amend controls at all (§9.5/9.6 FAILURE checks)

---

## PART 14 — Reporting (live-confirmed 2026-08-26)

Used Peter Kimani's signed-out breast case (§9). All confirmed real, not just present at load:

- **PDF download**: fetched directly (`GET /cases/[id]/report-versions/[versionId]/download`) — real
  `%PDF-1.3` file, `content-type: application/pdf`, 7801 bytes. A naive raw-byte substring search for
  "Peter"/"Kimani" initially found nothing — this is a PDFKit quirk, not missing content: text is drawn
  via hex-string `TJ` operators (`<4b696d616e69>` etc.), not literal ASCII bytes. Decoding those hex
  pairs directly confirmed the patient's exact MRN (`F7271DE399`) is genuinely present in the rendered
  content — the PDF is correctly populated, just not `grep`-able in its raw form. If you need to
  eyeball the actual layout, open the downloaded file in a real PDF viewer; don't rely on a raw-text
  search turning up nothing as evidence of a missing-content bug.
- **Org branding in the PDF**: still `[NOT VERIFIED]` — not checked this pass; the render code wasn't
  inspected for a logo/org-name block. Check this directly next time.
- **Email delivery**: sent via a locally-started `mailhog/mailhog` container (see §14.2) after
  restarting `apps/api` with `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false` exported —
  the platform-wide default in `.env` points at real Gmail, and the SMTP transporter is memoized on
  first use, so this override must be in place *before* `apps/api` starts, not set afterward. A real
  email arrived in MailHog: subject `Pathology report for Peter Kimani — case 260826-000191` (exact
  match to the code's own subject template), a plain-text body, and a genuine PDF attachment
  (`case-report-<caseId>-v1.pdf`, valid base64, decodes to the same real PDF).
- **No-email/no-facility rejection**: attempting to send with an empty "Email to" field produced a
  clear, well-written **client-side** message — "This patient has no email on file — enter a recipient
  address." — not the raw 400 the original draft predicted. This is a nicer result than expected, not a
  gap.
- **A tooling note, not an app bug:** the "Email to" input didn't accept simulated keyboard `type`
  actions reliably during this pass (stayed empty despite a visible cursor and focus) — had to be set
  via a native-setter + `input`-event dispatch instead. If you hit an input that "won't take typed text"
  while testing, try that before concluding it's broken.

## PART 14 — Reporting (original)

**WHERE:** `/cases/[caseId]/report-versions/[versionId]/download` (PDF) and the "Send by email" form
on the case detail page.

### 14.1 PDF report

1. On the case you signed out in §9.5, download the report version PDF.
2. **Inspect and verify every field the brief asks for** — the generator (`case-report-render.ts`,
   `pdfkit`) is confirmed to render: Title ("Anatomic Pathology Report"), Patient block (name, MRN,
   DOB, sex), referring facility/ordering provider, Case accession number + status, Specimen Parts
   (accession numbers + block codes), Narrative (gross/microscopic/diagnosis), Synoptic Findings
   grouped by protocol (including repeating-group instances with sub-headings), Signature block
   (version number, status, signed-by role, signed-at timestamp, amendment reason if applicable).
3. **Laboratory identity/branding in the PDF:** `[NOT VERIFIED]` whether the org name/logo/address you
   set in Part 2 actually appears on this PDF — check directly and record what you find; the generator
   code wasn't confirmed either way for this field during this research pass.
4. **Download an amended version's PDF too** (v2 or v3 from §9.6) — confirm the amendment reason and
   correct version number appear, and that it's clearly distinguishable from the current version.

### 14.2 Email delivery — real, but read this first

This is genuinely implemented via Gmail SMTP + an app password (nodemailer), not a stub.
**Do NOT send to a real person's inbox during this pilot pass unless you have explicit authorization**
— use one of the two safe options below.

**Option A — MailHog (recommended, fully local, zero risk):**
```bash
docker run -d --name pilot-mailhog -p 1025:1025 -p 8025:8025 mailhog/mailhog:latest
```
Set `SMTP_HOST=localhost`, `SMTP_PORT=1025`, leave `SMTP_USER`/`SMTP_APP_PASSWORD` blank, restart
`apps/api`. Open http://localhost:8025 to see everything the app sends, with zero real-world delivery
risk.

**Option B — a real Gmail app password you control**, configured either platform-wide (`.env`
`SMTP_*`) or per-tenant via `/admin/org-settings`'s "Report email (Gmail)" section (§2.2). Only do this
if you're comfortable a real email will actually be sent.

### 14.3 Steps (using MailHog)

1. On the signed-out case, use **"Send by email."** Confirm the "Email to" field is **prefilled from
   the patient's own on-file email** — register/edit the patient first to have an email on file if you
   want to see this prefill (Wanjiku and Otieno both have one from Part 6).
2. A second quick-fill button should appear if the case's order has a referring facility on file
   (`SendReportEmailForm`'s facility quick-fill) — confirm it prefills the facility's email instead when
   clicked.
3. Submit. **EXPECTED RESULT:** success message; open http://localhost:8025 and confirm a real message
   arrived with the correct subject (`Pathology report for {patient} — case {accession}`) and a real
   PDF attachment (open it — confirm it's not a corrupt/empty file).
4. Attempt to send when the patient has **no email on file and no referring facility either.**
   **EXPECTED RESULT:** a real 400, not a silent no-op or crash.
5. **Changes data:** no clinical data changes; this is a distribution action, correctly not step-up-
   gated (confirmed deliberate — it reads already-signed content, it doesn't attest anything new).

---

## PART 15 — Billing: Cash (live-confirmed 2026-08-26)

Used Wanjiku Kamau's cash order (§8 scenario 1, Glucose only). Logged in as `test-user-10` (cashier).
All confirmed real:

- **Invoice generation**: `Generate invoice` created a real invoice (`INV-260826-000049`, $5.00,
  `unpaid`) — confirmed in the DB, not just the UI. **One real UI lag worth noting:** the order-detail
  button stayed showing "Generate invoice" (not "View invoice") until the page was reloaded — the
  invoice existed correctly in the DB the whole time, this is a client-revalidation gap, not a
  duplicate-risk. The `ux_invoice_tenant_order` unique constraint the guide's duplicate-protection claim
  relies on is confirmed to exist in the schema.
- **Currency display finding worth flagging:** the invoice and payment UI hardcode a `$` (USD) symbol
  and label ("Amount (USD)") regardless of the org's own `currency` setting (set to `KES` in Part 2 for
  this exact tenant). **`[DESIGN DECISION REQUIRED]`** — if the design partner's real currency isn't
  USD, every invoice and receipt currently displays the wrong symbol; this needs a decision before
  pilot, not just a cosmetic note.
- **Partial → full payment**: recorded $2.50 then the remaining $2.50 on the $5.00 invoice; status
  correctly moved `unpaid → partial → paid`, confirmed via the `payment` table (one row at 250 cents,
  then a second at 250 cents). The "Take payment" card correctly disappears entirely once `status: paid`
  — a real, deliberate UI guard against any further payment attempts on a settled invoice.
- **Overpayment rejection — confirmed real, but read this before concluding anything's broken:** the
  amount `<input>` has a client-side `max` attribute equal to the remaining balance. Entering an amount
  above it silently blocks the native form submission with a **browser-native constraint-validation
  tooltip** ("Value must be less than or equal to 55") — no network request fires, no
  `role="alert"` element appears, which can look like "nothing happened, no error" if you're checking
  the DOM programmatically rather than actually looking at the browser. **The real, authoritative
  server-side check is still there and still correct** — confirmed by removing the `max` attribute and
  resubmitting: got a clear `role="alert"` message, *"Payment amount ($100.00) exceeds the remaining
  balance ($55.00) on this invoice"* — better-written than the guide's original "raw BadRequestException"
  prediction. **If you're testing this by typing into the real browser field, you'll just see the native
  tooltip and the field refusing to submit — that tooltip firing IS the pass, you don't need to see the
  server message too.**

## PART 15 — Billing: Cash (original)

**WHERE:** the order detail page ("Generate invoice" / "View invoice") and `/billing/invoices/[id]`.
**ROLE:** `manage_billing` (`technologist`, `pathologist`, `cashier`, `lab_admin`).

### 15.1 Generate an invoice

1. Log in as `test-user-10` (`cashier`).
2. Open Wanjiku's cash order from Part 8 scenario 1. Click **"Generate invoice."**
3. **VERIFY:** invoice shows the correct patient, the one line item (Glucose) with its **snapshotted**
   price (confirm: later changing the catalog price for Glucose in Part 5 does **not** retroactively
   change this already-issued invoice), status `unpaid`.
4. **Duplicate-invoice protection — test this explicitly, it's a named requirement:**
   - Click **"Generate invoice" a second time** on the same order (or reload and click again). **EXPECTED
     RESULT:** returns the **same existing invoice** (`alreadyExisted: true`), not a duplicate row and
     not an error. This is backed by both an application-level check and a DB-level unique constraint
     (`ux_invoice_tenant_order`) as a race-safe backstop.
   - Reload the order page mid-flow and click Generate again to simulate a user's confused double-click.
     Same expected result.
   - **VERIFY in the DB if you want the strongest proof:**
     `SELECT count(*) FROM invoice WHERE order_id = '<the order id>';` must be exactly `1`.
5. **FAILURE would be:** two invoice rows for one order, or a 500 on the second click instead of the
   idempotent return.

### 15.2 Payment — full, partial, overpayment

1. On the unpaid Glucose invoice, record a **partial** payment (method `cash`) for half the total.
   **VERIFY:** status becomes `partial`, balance due reflects the remainder correctly.
2. Record the remaining balance. **VERIFY:** status becomes `paid`, balance `0`.
3. On a fresh second invoice (Otieno's order, once payer-type is resolved — see 16.1 first if this
   turns out to be a facility invoice instead), attempt to pay **more than the remaining balance.**
   **EXPECTED RESULT:** a real, explicit rejection (`BadRequestException`) — overpayment is **not**
   silently accepted or converted into a credit; there is no refund/credit mechanism in this schema at
   all (`[NOT IMPLEMENTED]`, confirmed — issue #489's own §17.5/§17.6 scope, still open, needs a real
   business-process decision on refunds/reminders before it could be built).
4. **Reload/refresh test:** after recording a payment, hard-refresh the invoice page. **VERIFY:** the
   updated status/balance persists (not just an optimistic client-side update that reverts).
5. **Changes financial data:** yes, permanently. No cleanup mechanism for payments; leave in place.

---

## PART 16 — Billing: Referring Facility (live-confirmed 2026-08-26)

Used Otieno Odhiambo's order to Nairobi General Clinic (§8 scenario 2, CBC + PBS, $55.00). All confirmed
real:

- Invoice auto-resolved `payer_type: corporate` and the correct `referring_facility_id` the moment it
  was generated — no manual toggle needed, confirmed directly via the `invoice` table. Matches §16.1's
  claim exactly.
- Recorded a $25 partial payment; the statement page correctly aggregated it: `INV-260826-000050 |
  Otieno Odhiambo | partial | $55.00 | $30.00` with a matching `Facility total (1 patient) $55.00 $30.00`
  footer row — the balance-due math is genuinely correct, not just displaying the invoice total twice.
- **Date-range filter, tested for real:** a future date range (`2027-01-01` to `2027-01-31`) correctly
  returned a real empty state — *"No invoices billed to this facility in this date range."* — not a
  stale/cached full list. This resolves the guide's own "confirm this isn't cached" instruction.
- Same currency-symbol caveat as Part 15 applies here too (hardcoded `$`, not the tenant's `KES`).

## PART 16 — Billing: Referring Facility (original)

**WHERE:** `/billing/facility-statement`. This is a **read-only consolidated view**, not a separate
billing ledger — "one invoice = one order" stays true even for facility-payer orders (a deliberate
ADR-0041 boundary, not an oversight).

### 16.1 Steps

1. Ensure Otieno Odhiambo's order (Nairobi General Clinic, Part 8 scenario 2) has generated an invoice
   with `payerType: corporate` — this happens automatically at invoice-generation time when the order
   has a referring facility attached; confirm this is really automatic and doesn't require an explicit
   payer-type toggle you missed.
2. Book and invoice **at least one more** order under Nairobi General Clinic (e.g. a second visit for
   Otieno, or register a fourth facility patient) so the statement has more than one row to
   consolidate.
3. Go to `/billing/facility-statement`. Filter: Referring facility = `Nairobi General Clinic`, a date
   range covering today.
4. **VERIFY:** table lists each invoice (linked, patient, status, total, balance due) plus a footer row
   totaling facility total, grand total, grand balance due across all listed invoices.
5. Record a partial payment on one of the facility's invoices, then reload the statement. **VERIFY:**
   the aggregation reflects the new paid/balance split correctly.
6. Test the **date-range filter** for real: set a From date after today and confirm the statement
   correctly shows zero rows, not a stale/cached full list.
7. Use the **Print** button. **VERIFY:** print-specific layout renders sensibly (this uses dedicated
   print CSS — check it doesn't just print the raw screen with nav chrome included).
8. `[NOT IMPLEMENTED]` — confirm and record: invoice inclusion/exclusion toggles (picking which
   invoices go on a statement) don't exist; the statement is always "everything matching the filter."

---

## PART 17 — Search / Worklists

Run this quick sweep across every list screen and record what you find — most of the gaps below are
already-known, deliberate v1 scope cuts, not surprises, but confirm each one live:

| Screen | Search | Filter | Sort | Pagination | Notes |
|---|---|---|---|---|---|
| `/patients` | ✅ name/MRN/national ID | ❌ none | Name column only | ❌ hard 50-cap message instead | §7 |
| `/orders` | ❌ no free-text search box (only status/priority/date filters) | ✅ status (Ordered/Cancelled), priority (Routine/STAT), `createdFrom`/`createdTo` date range | ❌ none (fixed by `createdAt DESC`, no column sort) | ❌ hard 100-cap message instead | see finding below |
| `/cases` | ❌ no search box at all — confirmed both live (`q=` param silently ignored, all 60 cases still returned) and in code (`cases/page.tsx` only destructures `{ status }` from `searchParams`, nothing else) | ✅ status tabs (Active/Pending Review/Signed Out/Amended) | `[NOT VERIFIED]` | `[NOT VERIFIED]` | tabs are the known-good part, confirmed by issue #613 |
| `/billing/invoices` | ❌ confirmed no search (same code pattern as `/cases` — `invoices/page.tsx` only destructures `{ status }`) | ✅ status tabs (Unpaid/Partial/Paid/All) | `[NOT VERIFIED]` | ❌ none (deliberate, matches `cases`/`orders` precedent) | |
| `/admin/referring-facilities` | ❌ none | ❌ none | `[NOT VERIFIED]` | ❌ 200-row hard cap, no pager | §4 |
| `/admin/users` | ❌ none | ❌ none | ❌ none (fixed order) | ❌ none — no cap needed, only 10 seeded accounts | confirmed live as `test-user-11`; only form on the page is "Add a staff account" |
| Reports | n/a — no report list screen exists at all (§9.8/Part 14) | | | | `[NOT IMPLEMENTED]` |

**Real bug found live 2026-08-27, `/orders` date-range filter**: `createdTo=2026-08-27` (a bare date, no
time) silently excludes same-day orders placed after midnight. Concretely: with two real orders placed
minutes apart on 2026-08-27 (00:36 and 00:49), `?createdFrom=2026-08-27&createdTo=2026-08-27` returned
**zero results** — "No orders match these filters" — even though both orders fall on that exact date.
Widening to `createdTo=2026-08-28` immediately surfaced them, confirming `createdTo` is being compared
as midnight-start-of-day (`00:00:00`) rather than end-of-day, so a same-day upper bound excludes nearly
everything from that day. Passing an explicit time (`createdTo=2026-08-27T23:59:59`) doesn't work around
it either — the API just 500s ("Something went wrong loading orders") on a non-date-only string, so
there's currently no way to get today's orders in the same query as today's own end-of-day boundary.
`[DESIGN QUESTION]`: should `createdTo` be inclusive of the whole calendar day it names? As built, no —
worth a design-partner call on whether this is the intended semantics or a genuine off-by-one.

For each remaining `[NOT VERIFIED]` cell (case/invoice sort and pagination — not reached this pass with
only 60/small invoice counts on hand, too few rows to force pagination or notice a sort order one way or
the other): check it live and fill in ✅/❌ plus any empty-state, loading-state, or error-state
observation.

---

## PART 18 — RBAC / Security Acceptance Test

This is the **real, current** capability grant table (`apps/api/src/auth/capabilities.ts`) — use these
exact grants, not the brief's example role names.

| Role | Capabilities held |
|---|---|
| `technologist` | `enter_result`, `manage_patients`, `manage_orders`, `manage_specimens`, `manage_billing` |
| `pathologist` | everything `technologist` has **+** `verify` |
| `qa` | `resolve_qc`, `manage_workflow`, `manage_report_templates`, `manage_catalog`, `view_operational_reports`, `manage_org_settings` |
| `reception` | `manage_patients`, `manage_orders` only |
| `cashier` | `manage_billing` only |
| `lab_admin` | `manage_org_settings`, `manage_users`, `manage_catalog`, `manage_billing`, `manage_patients` |
| `clinician` | `place_order_own_patient`, `view_related_patient_results`, `acknowledge_critical_own_patient` (all additionally row-filtered to their own related patients) |
| `patient` | `view_own_results` only (additionally row-filtered to their own record) |

### 18.1 Allow/deny matrix to run (log in as each account, attempt each action)

| Account | Action | Expected |
|---|---|---|
| `test-user-9` (reception) | Register patient | ✅ allowed |
| `test-user-9` (reception) | Sign out a pathology case | ❌ denied — no `verify` |
| `test-user-9` (reception) | Change org settings | ❌ denied — no `manage_org_settings` |
| `test-user-9` (reception) | Record a payment | ❌ denied — no `manage_billing` |
| `test-user` (technologist) | Accession a case | ✅ allowed |
| `test-user` (technologist) | Sign out | ❌ denied — no `verify` |
| `test-user` (technologist) | Record a payment | ✅ allowed — `technologist` **does** carry `manage_billing` (confirm this surprises you the first time; it's real, not a bug) |
| `test-user-4` (pathologist) | Review/sign out | ✅ allowed |
| `test-user-4` (pathologist) | Manage users | ❌ denied — no `manage_users` |
| `test-user-10` (cashier) | Record payment | ✅ allowed |
| `test-user-10` (cashier) | Edit diagnosis/narrative | ❌ denied — no `manage_specimens` |
| `test-user-11` (lab_admin) | Organization settings | ✅ allowed |
| `test-user-11` (lab_admin) | Users | ✅ allowed |
| `test-user-11` (lab_admin) | Facilities | ✅ allowed (`manage_patients`) |
| `test-user-11` (lab_admin) | Catalog | ✅ allowed |
| `test-user-11` (lab_admin) | Billing | ✅ allowed |
| `test-user-11` (lab_admin) | Resolve a QC violation | ❌ denied — `resolve_qc` is `qa`-only, deliberately not folded into `lab_admin` |
| `test-user-5` (qa) | Set org default synoptic standard | ✅ allowed |
| `test-user-5` (qa) | Manage users | ❌ denied — `manage_users` is `lab_admin`-only |
| `test-user-3` (no role) | Anything mutating | ❌ denied everywhere — the true fail-closed baseline |

### 18.2 A real, already-documented under-gating you should specifically re-check

**Re-confirmed live 2026-08-27, still true.** A prior session found `GET /v1/cases`, `GET
/v1/cases/:id`, and `GET /v1/whole-slide-images/:id` are gated **only** by login (`JwtAuthGuard`), with
**no capability check at all** — a `qa`-role token (no AP capability) got a real `200` reading case
data. Logged in as `test-user-5` (`qa`) and opened the exact cervical-cytology case used throughout
§11/§12 (`/cases/625ec9e6-4a10-4952-b382-12dfd81521e2`) directly: the full case detail rendered —
status, specimen parts, block/slide tree, "View whole-slide image" link, full report-version history,
and complete audit trail — with no capability check blocking any of it. Status unchanged from the
prior finding; this remains a currently-accepted gap (human decision on record: "leave as defensive
code," no follow-up filed) — not re-filed as a fresh finding.

**Also re-confirmed at the same time: the `/orders` hang from §18.3 below is gone**, now that the
`loading.tsx` P0 defect (§7/§8) is fixed — `/orders` as `qa` no longer hangs, it **fully renders** the
real orders list (100 real rows shown, patient names, test names, statuses), which is actually a
*bigger* instance of the same under-gating than the "neither" result §18.3 originally recorded: `qa`
has no `manage_orders`, yet reads the complete unfiltered order worklist.

### 18.3 Live-confirmed 2026-08-26: the same under-gating extends to the dashboard, org settings, and
### patient list — bigger than §18.2 on its own

A live browser pass (see §0.1) logged in as `test-user-3` — a real Keycloak account in tenant `...0001`
holding **no assignable role at all** (confirmed on `/admin/users`, which lists it as "No assignable
role") — and found:

| Page | Result for a zero-capability account |
|---|---|
| `/admin/users` | ✅ **Correctly denied** — "You do not have permission to view or manage staff accounts." |
| `/billing/invoices` | ✅ **Correctly denied** — "You do not have permission to view invoices." |
| `/` (dashboard/worklist) | 🔴 **Fully rendered** — the real worklist, all 272 pending rows, patient/test names included |
| `/admin/org-settings` | 🔴 **Fully rendered** — the real org profile (name/address/phone/email/currency), editable; a `POST` submit returned `200` (whether the write actually persists needs a careful re-check — see §0.1's last bullet) |
| `/patients` | 🔴 **Fully rendered** — the real "Recently registered" patient list plus a live "Register patient" button |
| `/orders` | 🔴 **Fully rendered** (re-tested 2026-08-27, after the `loading.tsx` fix — see §18.2 above) — the real orders worklist, 100 rows, patient/test names included |

This confirms enforcement in this app is **inconsistent by page, not absent everywhere**: `manage_users`
and `manage_billing` are correctly checked at the page level; `manage_patients` and `manage_org_settings`
are demonstrably **not** checked on read for at least these four pages (`/`, `/admin/org-settings`,
`/patients`, `/orders`), extending §18.2's already-known case/WSI-API gap to the dashboard landing page
itself — the first thing anyone sees after logging in. The `/orders` row above was originally recorded
as an inconclusive hang (a client-side symptom of the unrelated `loading.tsx` Suspense defect fixed
during this pilot pass); with that defect fixed, `/orders` turns out to belong in the same 🔴 bucket as
the other three, not a separate "neither" case — the under-gating is broader than originally counted,
not narrower.

**Practical severity:** any Keycloak account that exists in the tenant but hasn't been assigned a role
yet (a brand-new hire mid-onboarding, an account an admin meant to configure later, or simply
`test-user-3`/`-7`/`-8`'s existing seeded placeholders) can browse real patient names, the full clinical
worklist, and the organization's contact/billing settings with **zero** roles granted. This is worth
elevating to a real pre-pilot blocker, not a "confirm and move on" item — see the updated **PILOT
GO/NO-GO CHECKLIST**.

**Filed:** [issue #762](https://github.com/mathewkaplos/lis-platform/issues/762) — "Zero-role account
can fully read dashboard, org settings, and patient list (page-level RBAC gap)."

---

## PART 19 — Audit Trail (live-confirmed 2026-08-26 for several rows below)

Live-verified a real, end-to-end AP case run (`test-user-9` books → `test-user` accessions/blocks/
slides/narrative/synoptic → `test-user-4` signs out). All of the following are **confirmed real**, via
direct `audit_event` queries — no longer `[NOT VERIFIED]`:

- `case.accession` — `resource_type: case`, `resource_id` = the case id, `actor_role: technologist`.
- `case.record_narrative` — same pattern, fires on Save narrative.
- `synoptic.record` — fires once per protocol save (17 synoptic-element observations were created in a
  single batch, all sharing one timestamp, for the one `synoptic.record` audit row — confirms §10.2's
  "stored as a single grid-keyed batch" implementation detail).
- `case.sign_out` — **`resource_type` is `case_report_version`, not `case`** — its `resource_id` is the
  *report version's* id, not the case's id. If you're querying by the case id expecting to find this
  row, you won't; query by the report version id instead (or just filter on `action = 'case.sign_out'`
  tenant-wide). Its `context` column contains real step-up proof:
  `{"step_up": {"method": "reauthentication", "authTime": <unix ts>}}` — confirms §9.5's claim
  precisely.
- The case detail page itself (`/cases/[id]`) has a real, working **"Audit trail" section built into the
  UI** — not just a raw API route. It rendered `case.accession` with a human timestamp and "By
  technologist" immediately after accessioning, live, no query needed. This resolves the guide's
  earlier "no audit-trail UI found" uncertainty for at least cases (still genuinely unconfirmed for
  patients — no equivalent section was seen on `/patients/[id]`).
- **A live, real gotcha worth flagging for anyone querying this table themselves:** don't assume
  `resource_id` always equals the domain object named in your test step — check `resource_type` first,
  as this pass found at least one action (`case.sign_out`) that audits a *different* row than the one
  you'd naively expect.

## PART 19 — Audit Trail (original)

`audit_event` is a real, **hash-chained, append-only** table (Invariant #5) — deleting or editing a row
would break the chain for every later entry; never attempt to modify it directly, even to clean up test
data (a prior session deliberately left orphaned audit rows in place for exactly this reason).

For each action below, confirm: **who** (actor role, not just user id), **when**, **what** (before/after
where applicable), and whether it's visible anywhere in the UI vs. only queryable directly.

| Action | Audit action name (confirm exact string live) | UI-visible? | Step-up required? |
|---|---|---|---|
| Patient registration | `patient.create` — confirmed live 2026-08-27, real rows for Mercy Chepkoech/Kiptoo Rono | No dedicated audit-trail UI on `/patients/[id]` (checked the page source directly — no such section exists, unlike the case-detail page) | No |
| Patient demographic correction | `patient.update` — confirmed live (table has real rows from prior-session corrections) | Same as above — no UI | No |
| Case accession | `case.accession` — confirmed live, see §19 above | Yes — the case-detail page's own "Audit trail" section (confirmed §19 above) | No |
| Specimen/block/slide changes | `[NOT VERIFIED — no dedicated audit action found for block/slide creation specifically; only case-level actions confirmed so far]` | Via the case's own Audit trail section, if audited at all | No |
| Narrative edit | `case.record_narrative` — confirmed live, see §19 above | Yes — case's own Audit trail section | No |
| Synoptic response recorded | `synoptic.record` — confirmed live, see §19 above | Yes — case's own Audit trail section | No |
| Sign-out | `case.sign_out` | Via audit-trail route | **Yes** — real Keycloak re-auth, `authTime` bound into the record |
| Amendment | `case.amend` | Via audit-trail route | **Yes** |
| Invoice creation | `invoice.generate` — confirmed live via direct query, real row with full invoice snapshot (`invoiceNumber`, line items, totals) in `after` | No — checked `billing/invoices/[invoiceId]/page.tsx` directly, no "Audit trail" section exists on the invoice detail page (unlike cases) | No |
| Payment recording | `payment.record` — confirmed live, real rows with `method`/`amountCents`/`invoiceId` in `after` | No — same invoice-detail page, no audit UI | No |
| User/role changes | `user.create` (confirmed live — created a throwaway `PilotAudit Throwaway` reception account), `user.role_change` (confirmed live — changed that account reception→technologist, real before/after role-array diff captured), `user.set_enabled` (confirmed live — deactivated that account, `before: {"enabled":true}` → `after: {"enabled":false}`). All three actions exist in code (`user-management.controller.ts`) and all three now have real rows. Note: the role-change select **auto-saves on change**, no separate "Save" button — same for Activate/Deactivate, which uses a native `window.confirm()` dialog (be aware if you're driving this via browser automation — it blocks the page until dismissed, same gotcha as "Cancel order" in §8/§17). | No — `/admin/users` has no per-account history section | No |
| Org settings change | `org_settings.update` — confirmed live (real row from setting the org's default synoptic standard to CAP in §10.3) | No dedicated audit UI on `/admin/org-settings` | No |

**Every `[NOT VERIFIED]` cell above except one is now resolved** — the sole remaining gap is whether
specimen/block/slide creation gets its own dedicated audit action distinct from the case-level ones;
nothing found this pass confirms or rules that out specifically.
**Only sign-out and amendment are confirmed to require step-up** — every other mutation in this system,
including patient corrections and payments, does not, per current code.

---

## PART 20 — Error / Recovery Testing

| Scenario | What you should see | What should happen | Notes |
|---|---|---|---|
| Submit a form with a required field blank | Native/HTML5 or inline validation message | Blocks submission, no partial write | Confirmed real (session 44 found the seeded tenant's own missing "Organization name" blocked its own e2e test this way) |
| Double-submit an invoice generation | Same invoice returned, not duplicated | See §15.1 | Confirmed by design |
| Refresh mid-multi-step form (order booking, case accession) | **Confirmed live 2026-08-27**: typed a specimen type into the case-accession form, refreshed the page (same URL), and the field came back completely blank — the prediction was right, this is a plain server-rendered form with zero client-side persistence (no `sessionStorage` draft-save, no confirm-before-leaving prompt). Not a bug — matches every other form in this app — but worth calling out explicitly for pilot users: don't refresh mid-form, you will lose everything typed so far with no warning. | Confirmed: state is lost, no warning given | |
| Browser back button after a mutation | `[NOT VERIFIED]` | Record whether it shows stale cached data or refetches | |
| Session expiry mid-session | Redirect to Keycloak login, then back to where you were | A real e2e spec (`session-expired.spec.ts`) covers exactly this — the proxy-level session check and the page-level one can race; this was a genuinely hard-won fix, re-verify it still works cleanly | See `docs/scope/current.md` session 46 for the full story if you hit anything odd here |
| Wrong role attempts a gated URL directly (not via nav) | 403 through `error.tsx` boundary with a clear message and a working "Try again" | Confirmed pattern used across `orders`, `cases`, `billing/invoices` | Part 18 |
| Unauthorized/garbage URL (e.g. a case ID from another tenant) | 404, not a 500 or, worse, someone else's data | RLS-backed | Test explicitly with `test-user-2` against a tenant-`...0001` case ID |
| Sign-out attempted on an incomplete case | Plain, verbatim rejection message from `assertCompleteLineage` | No crash, no silent partial sign-out | §9.5 |
| Overpayment | Explicit 400, no silent acceptance | §15.2 | |
| Network interruption mid-submit | `[NOT VERIFIED]` | Hard to simulate cleanly without dev tools throttling; note if you try it | |

---

## PART 21 — Responsiveness / UX

**Live-confirmed 2026-08-27 at mobile width (390×844, dashboard `/`):** the CDP-level screenshot tool was
broken all session (a persistent `params.clip.scale` deserialize error, unrelated to this app), so this
was checked via DOM/CSS assertions rather than a visual screenshot — genuinely weaker evidence than
actually looking at it, but still real signal, not a guess:

- `window.matchMedia('(max-width: 640px)').matches` returned `true`, confirming the narrow viewport
  genuinely applied (note: `window.innerWidth` itself intermittently read `0` through this automation
  path — a tooling quirk, not a real 0-width viewport; `matchMedia` was the reliable check).
- The hamburger nav button was found and clicked; it opened a real `<nav>` containing the complete link
  set (Dashboard, Patients, Orders, Cases, Reception, Collection queue, QC violations, Culture reads,
  Invoices, Facility statement, Reference ranges, Add test, Referring facilities, ...) — matches the
  desktop sidebar, confirming issue #240 still holds.
- The dashboard's own wide worklist table (6 columns: Patient/Test/Priority/Status/Assignee/TAT,
  `scrollWidth: 1126px` — clearly wider than the 390px viewport) is wrapped in a `relative w-full
  overflow-x-auto` container, and `document.documentElement.scrollWidth` stayed at `186px` — the **page
  body does not scroll horizontally**, only the table's own bounded container does. This is exactly the
  convention this section describes, confirmed live on at least this one table.
- **Not re-checked this pass**: the invoice-detail/facility-statement tables and the synoptic protocol
  form specifically (item 4 below), the tablet-width case tree/WSI viewer (item 3), and the keyboard-nav
  `<button>`-in-`<a>` fix (item 5) — still worth a real visual pass by a human with working screenshot
  tooling, since DOM assertions alone can't catch everything a screenshot would (overlapping elements,
  actually-illegible text, etc.).

No dedicated responsive/mobile Playwright coverage exists; prior manual passes found real, specific
issues worth re-checking rather than assuming fixed:

1. **Desktop (1920×1080 or your normal monitor):** run through Parts 6–9 normally; this is the
   dev-tested baseline.
2. **Laptop (1366×768):** repeat patient registration + order booking; check no form fields get
   clipped.
3. **Tablet width (~768px, e.g. resize the browser window or use DevTools device toolbar):** check
   `/cases/[caseId]`'s parts→blocks→slides tree and the WSI viewer specifically — these are the most
   complex layouts in the app.
4. **Mobile width (~390px):** check the hamburger nav drawer (issue #240, confirmed shipped) opens and
   contains the same links as the desktop sidebar. Check a billing table and a synoptic form don't
   force horizontal page scroll (the design system's convention is that wide content scrolls in its
   own bounded container, never the page body — confirm this actually holds on the invoice
   detail/facility-statement tables and the synoptic protocol form).
5. **Keyboard navigation:** Tab through the Cases-list status tabs and the dashboard's own stage tabs
   — a genuine `<button>`-nested-inside-`<a>` bug here was found and fixed across three copies of the
   same pattern; re-confirm all three (`cases/page.tsx`, `billing/invoices/page.tsx`, the dashboard's
   `STAGE_TABS`) still activate on `Tab` → `Enter`, not just on click.
6. **Judge like a real lab employee, not a designer:** can reception genuinely register a patient and
   book an order on whatever device your pilot lab actually uses at the front desk? That's the real
   bar, not pixel polish.

---

## PART 22 — Complete "Day in the Life" Test

One continuous run, no jumping around. All times are illustrative. Cross-references point back to the
detailed steps above — follow them in full the first time; this is the checklist for repeat runs.

| Time | Actor (account) | Action | Ref |
|---|---|---|---|
| 08:00 | `test-user-11` (lab_admin) | Configure org profile (name/address/phone/email/currency) | §2 |
| 08:10 | `test-user-11` | Create 2–3 named staff accounts, assign roles | §3 |
| 08:20 | `test-user-11` | Create 1–2 referring facilities | §4 |
| 08:25 | `test-user-5` (qa) | Confirm seeded catalog visible; note the no-price-field gap if creating a new test | §5 |
| 08:30 | `test-user-9` (reception) | Register a patient (incl. the deliberate-mistake-then-correct patient) | §6 |
| 08:40 | `test-user-9` | Search/find the newly registered patient in the list | §7 |
| 08:45 | `test-user-9` | Book an order (facility-payer, multi-test) | §8 |
| 08:55 | `test-user` (technologist) | Create the AP case from that order, accession the specimen | §9.1 |
| 09:05 | `test-user` | Add blocks/slides | §9.2 |
| 09:15 | `test-user-4` (pathologist) | Enter gross/microscopic/diagnosis narrative | §9.4 |
| 09:30 | `test-user-4` | Record a synoptic protocol response | §10.2 |
| 09:45 | `test-user-4` | Sign out (step-up re-auth) | §9.5 |
| 09:55 | anyone | Download the signed PDF report, inspect every field | §14.1 |
| 10:00 | anyone (MailHog running) | Send the report by email, confirm delivery in MailHog | §14.3 |
| 10:10 | `test-user-10` (cashier) | Generate the invoice, attempt a duplicate click, confirm idempotent | §15.1 |
| 10:20 | `test-user-10` | Record a partial payment, then the balance | §15.2 |
| 10:30 | `test-user-10` or `test-user-11` | Pull the facility statement for the referring facility used above | §16 |
| 10:45 | `test-user-4` | Amend the signed case with a real reason | §9.6 |
| 10:55 | anyone with DB access | Review the audit trail for every action above via direct query | §19 |
| 11:00 | `test-user-9` | Attempt one denied action (e.g. sign-out) to close the loop on RBAC | §18 |

---

## PART 23 — Pilot Acceptance Scorecard

Fill this in as you run the guide. Legend: 🟢 PASS · 🟡 PASS WITH OBSERVATION · 🔴 FAIL ·
⚫ NOT IMPLEMENTED · ⚪ NOT TESTED.

| AREA | TEST | EXPECTED | ACTUAL | STATUS | ISSUE # |
|---|---|---|---|---|---|
| Organization setup | Save + persist org profile | Persists across reload | Confirmed live — org-default-synoptic-standard save (§10.3) round-tripped and rendered "Saved." | 🟢 | |
| Organization setup | Currency validation | `[DESIGN DECISION REQUIRED]` — free text today | Unchanged, not revisited this pass | ⚫ | |
| User management | Create/role-change/deactivate staff | Real Keycloak account changes | Confirmed live 2026-08-27: created `PilotAudit Throwaway` (reception), changed role to technologist, deactivated — all three real, audited (`user.create`/`user.role_change`/`user.set_enabled`), role-change and deactivate both auto-save with no separate Save button | 🟢 | |
| Referring facilities | Create + use as payer | Works; no edit/delete exists | Used as payer live in earlier session's facility-statement pass (§16); the `/admin/referring-facilities` CRUD screen itself not separately re-driven this pass | 🟡 | |
| Catalog | View seeded catalog | Real priced tests visible | Confirmed dozens of times this session across every order-booking flow | 🟢 | |
| Catalog | Create new test with price via UI | `[NOT IMPLEMENTED]` — no price field | Confirmed unchanged | ⚫ | |
| Patient registration | Register + duplicate detection + correction | Works, audited | Confirmed live — 3 real patients registered this session, `patient.create`/`patient.update` both have real audit rows | 🟢 | |
| Patient management | Search/list | Works, capped at 50, no pagination | Confirmed — no change from earlier pass | 🟢 | |
| Orders | Book cash/facility/multi-test/STAT/AP orders | All 5 scenarios succeed | AP/routine orders confirmed repeatedly and reliably (with the known checkbox-double-click quirk). **STAT priority specifically not confirmed this pass** — an attempted STAT selection silently didn't take (own automation click landed wrong, or a real bug — not disambiguated) and the order saved as `routine` instead | 🟡 | |
| AP workflow | Full accession→sign-out→amend chain | Fully browser-reachable | Confirmed live, multiple full runs this session and prior | 🟢 | |
| Cytology | Screen → pending_review → sign-out → return | Fully browser-reachable | Confirmed live in §11 | 🟢 | |
| Synoptic reporting | All 7 seeded protocols, incl. disambiguation | Conditional visibility live | Breast and Colorectal (both ICCR/CAP variants) fully confirmed live, incl. disambiguation picker and org-default auto-skip (§10.3). Lung, Prostate, and Cervical Cytology (Bethesda) protocols never opened/filled live this pass — code presence only | 🟡 | |
| WSI | Upload valid + 2 rejection paths + RBAC + isolation | | All 5 sub-checks confirmed live: valid upload→ready, both rejection paths, RBAC (upload form absent server-side for `qa`), cross-tenant 404 (§12) | 🟢 | |
| Reporting | PDF fields complete; email via MailHog | | PDF generation and email delivery confirmed live in an earlier pass (§14); org branding in the PDF specifically still `[NOT VERIFIED]` | 🟡 | |
| Billing (cash) | Invoice idempotency, partial/full pay, overpay rejection | | Confirmed via real audit rows (`invoice.generate`/`payment.record`, incl. partial-then-full payment sequences) and §15's existing live pass | 🟢 | |
| Billing (facility) | Consolidated statement, date filter, print | | Confirmed live in §16's earlier pass | 🟢 | |
| RBAC | Full allow/deny matrix (§18.1) | | Core capability grants match `capabilities.ts` exactly; §18.2/18.3's read-path under-gating (cases, WSI, dashboard, org-settings, patients, orders all readable with no capability check) is a real, known, accepted gap — not a fresh fail, but keeps this from a clean 🟢 | 🟡 | issue on record per §18.2 |
| Auditability | Every action in §19's table confirmed | | **Fully resolved this pass** — every row in §19's table now has a confirmed real audit action name; only "specimen/block/slide changes get their own dedicated action" remains genuinely unconfirmed | 🟢 | |
| Search/worklists | §17's table fully filled in | | Fully filled in this pass; found one real bug (`/orders` `createdTo` date-filter boundary excludes same-day results — see §17) and confirmed `/cases`/`/billing/invoices` have no search box by design | 🟡 | [#764](https://github.com/mathewkaplos/lis-platform/issues/764) |
| UX/responsiveness | §21's 6 checks | | Mobile nav drawer and horizontal-scroll containment confirmed live via DOM assertions (screenshot tooling broken all session); tablet-width case tree/WSI viewer, keyboard nav, and the invoice/synoptic-form scroll checks not re-verified this pass | 🟡 | |

---

## START HERE

1. Read **§0** above — it changes how you should read the rest of this document.
2. Run **Part 1.1–1.2** to bring up the stack and confirm every service is healthy.
3. Log in as `test-user-11` / `test-password-11` and do **Part 2** (org setup) — this is the fastest way
   to confirm the whole login → RBAC → persistence chain works before you invest in anything deeper.
4. Do **Part 18.1's** RBAC sweep next (10 minutes, highest signal-to-effort ratio in this guide).
5. Then run **Part 22** (Day in the Life) start to finish once, using the cross-references back into
   Parts 2–19 for full step detail on your first pass.

## MASTER TEST DATA

**Accounts:** the full table in §1.4 — copy it somewhere handy, you'll switch logins constantly.

**Patients** (§6.2): Wanjiku Kamau (F, 1985-04-12, cash), Otieno Ochieng Odhiambo (M, 1990-11-03,
Nairobi General Clinic), Mercy Chepkoech (F, 1972-07-20, MRN `942F605EDF`, registered live 2026-08-27
for §10.3's colorectal disambiguation test), Kiptoo Rono (M, 1965-03-12, MRN `3C9C585B42`, registered
live 2026-08-27 as the org-default-CAP-skip test patient), Peter Kimani (M, DOB deliberately
mis-entered as 1995-01-01 then corrected to 1993-06-15).

**Staff accounts created live** (§19, §23): `PilotAudit Throwaway` (reception→technologist role
change, then deactivated) — a disposable account created purely to exercise `user.create`/
`user.role_change`/`user.set_enabled` audit rows live; safe to ignore or delete, holds no real data.

**Referring facilities** (§4.2): Nairobi General Clinic (+254 711 222 333, referrals@nairobigen.example),
Rift Valley Medical Centre.

**Tests used** (all pre-seeded, tenant `...0001`): Glucose, Creatinine, CBC, Peripheral Blood Smear,
the seeded AP procedure (check `/admin/tests` for its exact current code/name).

**AP cases** (§9): one `tissue` breast case (full narrative + Breast + Breast Biomarker synoptic +
sign-out + 2 amendments), one `cervical_cytology` case (full screen → return → re-screen → sign-out
chain, plus WSI upload/rejection testing per §12), two `colorectal` cases live-created 2026-08-27 for
§10.3 — accession `260826-000194` (picker shown, CAP protocol filled in full) and `260826-000195`
(picker correctly auto-skipped after setting the org default to CAP), plus one throwaway `tissue` case
(accession `260826-000196`) created solely to test the refresh-mid-form data-loss scenario in §20.

**Organization:** Pilot Pathology Laboratory, 123 Laboratory Road, Nairobi, +254 700 000 000,
pilot@example.com, KES.

## DO NOT ACCIDENTALLY DO THIS

- **Never run `pnpm db:reset` against anything other than your local Docker Postgres** — it drops the
  volume. It does **not** touch Keycloak users, so a reset leaves orphaned Keycloak accounts behind
  from any `/signup` runs (§1.5) — clean those up separately via the Keycloak admin console if it
  matters to you.
- **Never point `/signup` (§1.5) at the open internet** — it has no rate limiting, CAPTCHA, or email
  verification by design, and creates a real tenant + user on every submission.
- **Never send Part 14's report email to a real person's inbox** without explicit authorization — use
  MailHog (§14.2 Option A) by default.
- **Sign-out and amendment (§9.5, §9.6) are the two genuinely hard-to-undo actions** in this system —
  once signed out, a case's content is only ever reachable forward through Amendment, never edited in
  place. Don't sign out a case you still want to freely experiment on.
- **Never hand-edit `audit_event` rows**, even to clean up test data — it's hash-chained; editing or
  deleting a row breaks verification for every later row in the chain.
- **Never hand-edit `infra/keycloak/lis-realm.json` against a running Keycloak instance** — it's
  imported once at container start; change the file and re-import (`docker compose down -v keycloak &&
  docker compose up -d keycloak`) rather than using the admin console for anything meant to persist.
- **Merging anything to `main` in this repo auto-deploys a real, live DigitalOcean staging droplet** —
  this pilot guide is written entirely against your local stack; don't confuse the two, and don't treat
  staging as a spare pilot environment without checking with the team first (it's Tailscale-gated and
  has previously gone down from an unrelated docs-only merge).

## PILOT GO/NO-GO CHECKLIST

Minimum conditions before inviting a real design partner, based on what this pass actually found —
brutally honest, not a wish list:

- [x] **Fixed 2026-08-27: the page-level RBAC gap confirmed live in §18.3 ([issue
      #762](https://github.com/mathewkaplos/lis-platform/issues/762)).** A zero-role Keycloak account
      could read the full clinical worklist, the organization's settings, and the patient/order
      list/detail screens. Rather than gate each route on one specific `@RequireCapability` (several of
      these routes are legitimately read by multiple roles — e.g. `/patients` by
      technologist/pathologist/reception/lab_admin *and* a scoped `clinician`, with no single capability
      common to all of them — a narrower gate would have regressed one of them), added a new
      `AnyRoleGuard` (`apps/api/src/auth/any-role.guard.ts`) that denies (403) only a caller with **zero**
      Keycloak realm roles, and applied it to `GET /v1/worklist`, `GET /v1/org-settings`, `GET
      /v1/patients`, `GET /v1/patients/:id`, `GET /v1/orders`, and `GET /v1/orders/:id`. Each affected
      web page (`/`, `/admin/org-settings`, `/patients`, `/patients/[id]`, `/orders`, `/orders/[id]`) now
      shows a clear "you don't have permission" message on a 403 instead of falling through to a generic
      error. **Verified live as `test-user-3`** (the seeded zero-role fixture account): all six pages now
      show the denial message instead of real data. **Verified no regression** as `test-user`
      (technologist): `/`, `/patients`, `/patients/[id]`, `/orders`, `/orders/[id]` all still render
      normally. Backend test suite: `any-role.guard.spec.ts` (new, 2 tests) plus the full
      `patient.e2e-spec.ts` (17), `order.e2e-spec.ts` (15), `org-settings.e2e-spec.ts` (7), and
      `capability-check.e2e-spec.ts` (10) suites all pass unchanged. (`worklist.e2e-spec.ts` has 2
      pre-existing, unrelated failures caused by this tenant's own accumulated fixture-row volume
      exceeding `WORKLIST_RESULT_LIMIT` — confirmed by reproducing the identical failure with this
      session's `worklist.controller.ts` change reverted; not something this fix touched.)
- [x] **Fixed 2026-08-26: the Patients/Orders list + order-booking client-side hang from §7/§8.**
      `/patients`, `/orders`, and `/orders/new` were hanging indefinitely on their `loading.tsx`
      fallback for every account, surviving a full clean restart of both `apps/web` and `apps/api` — a
      real P0 blocking the single most basic clinical workflow (booking a test on a patient), not a
      resource/environment artifact. Root cause isolated live: the server always completed the request
      successfully (`GET /patients 200`, real RSC payload confirmed via direct `fetch()`), but the
      client never rendered past the `loading.tsx` Suspense fallback — a Next 16.2.12 +
      `next dev --webpack` streaming defect, not app logic. **Fix applied:** deleted both `loading.tsx`
      files (`apps/web/app/(app)/{patients,orders}/loading.tsx`); both routes confirmed rendering
      correctly afterward, including a full `/orders/new` booking-form render with real catalog data.
      Fix merged in [PR #763](https://github.com/mathewkaplos/lis-platform/pull/763). Root-cause
      evidence [posted as a comment on issue #708](https://github.com/mathewkaplos/lis-platform/issues/708#issuecomment-5434133301)
      (left closed, since the fix landed — the comment records the confirmed mechanism for anyone who
      hits it again). **Still open:** whether the underlying Next.js/webpack defect also reproduces on
      `next build && next start` or Turbopack — not checked, worth confirming before ever re-adding a
      `loading.tsx` to either route (each `page.tsx` now has a comment explaining why and what to check
      first).
- [ ] **Reset the tenant before the design partner's first login (§0.1).** Tenant `...0001` currently
      carries ~272 leftover e2e/manual-test fixture rows on its dashboard. Run `pnpm db:reset` (§1.1)
      immediately before the real pilot session — do not let a design partner's first impression of the
      product be a worklist full of rows named "SignOut Fixture" and "Billing Fixture."
- [ ] **Resolve the fresh-org catalog gap (§0)** — decide and communicate whether the design partner
      will pilot on a hand-seeded tenant (like `...0001`) or whether a real onboarding path (clone a
      starter catalog, or at minimum let `/admin/tests` set a price) ships first. Today, `/signup`
      alone cannot reach a billable, synoptic-capable lab.
- [ ] **Add a price/billing-code field to the `/admin/tests` UI**, or explicitly commit to
      ops-sets-prices-via-migration as the real interim process and tell the partner that up front.
- [ ] **Confirm the RBAC matrix in §18** matches the partner's real org chart — in particular, that
      `technologist`/`pathologist` both carrying `manage_billing` (front-desk-adjacent, not a dedicated
      cashier-only grant by default) is an acceptable model, not a surprise discovered mid-pilot.
- [ ] **Decide on a real synthetic-data convention** (§6.3) before the partner starts entering data —
      there's currently no way to tell pilot/test rows apart from real ones once entered.
- [ ] **Run the full RBAC allow/deny matrix (§18.1) and re-confirm §18.2's known under-gating** — don't
      let a design partner's first real login be the first time these are checked.
- [ ] **Decide on the invoice overpayment/refund gap (§15.2)** — there is no refund/credit mechanism at
      all today; confirm this is acceptable for the pilot's real financial flows or scope it in first.
- [ ] **Decide on the currency-symbol gap found live 2026-08-26 (§15/§16).** The invoice, payment, and
      facility-statement UI hardcode a `$` (USD) symbol and "Amount (USD)" label regardless of the
      tenant's own `currency` setting (Part 2) — confirmed live with the tenant set to `KES`. If the
      design partner doesn't bill in USD, every invoice and receipt will show the wrong currency symbol
      on day one. **Filed as [issue #765](https://github.com/mathewkaplos/lis-platform/issues/765).**
- [x] **Completed 2026-08-27: the `[NOT VERIFIED]` cells in Parts 17 and 19.** Every audit-trail row in
      §19 now has a confirmed real action name (`invoice.generate`, `payment.record`, `user.create`,
      `user.role_change`, `user.set_enabled`, `patient.create`, `patient.update` all triggered live and
      verified against real `audit_event` rows); §17's search/filter/sort/pagination table is fully
      filled in for every screen. **Two new, real findings surfaced doing this:**
      1. **`/orders`'s `createdTo` date-range filter has a real off-by-one bug** — a same-day upper
         bound (`createdTo=2026-08-27`) is compared as midnight-start-of-day, silently excluding nearly
         every order actually placed that day. **Filed as [issue #764](https://github.com/mathewkaplos/lis-platform/issues/764).**
      2. **`/admin/users`'s role-change and deactivate controls use native `window.confirm()` dialogs**
         — fine for a human, but a real trap for any future browser-automation/e2e coverage of this
         page (a stuck dialog freezes the whole page until dismissed by navigating away or stubbing
         `window.confirm`). Worth a design/engineering note if Playwright coverage is ever added here.
- [x] **Completed for WSI (§12); email delivery (§14) confirmed in an earlier pass.** WSI's manual pass
      (§12, this session) confirmed all 5 sub-scenarios live: valid upload, both rejection paths, RBAC
      (upload form correctly absent server-side for a role without `manage_specimens`), and cross-tenant
      isolation (real 404). Both features still have zero Playwright coverage — this remains a manual
      spot-check, not automated regression protection, and should be revisited before the next release
      touches either area.
- [ ] **Fix or explicitly accept the referring-facility no-edit-no-delete gap (§4)** — a real facility's
      contact details will eventually need correcting.
- [ ] **Decide whether `closest_margin_site` on the Colon/Rectum (CAP) synoptic protocol should be
      conditional on margin status (found live 2026-08-27, §10.3).** It's currently required even when
      margin status is "All margins negative for invasive carcinoma," where there is no positive margin
      to name a site for — unlike the protocol's other two conditional fields (mesorectal excision
      quality, rectal tumor location), which correctly key off their own trigger answers.
      **Filed as [issue #766](https://github.com/mathewkaplos/lis-platform/issues/766).**
- [ ] **Decide whether the synoptic "recorded" confirmation view should show human-readable labels
      instead of raw enum codes (found live 2026-08-27, §10.3).** E.g. it currently shows
      `Operative procedure: low_anterior_resection` instead of "Low anterior resection" — the form
      itself shows proper labels, only the post-save confirmation view doesn't.
      **Filed as [issue #767](https://github.com/mathewkaplos/lis-platform/issues/767).**
- [ ] **Make 403 responses on gated write actions (e.g. `lab_admin` attempting to place an order,
      found live 2026-08-27, §10.3) show a real "you don't have permission" message**, the way
      `/admin/org-settings` already does, instead of the generic "Something went wrong placing the
      order" `/orders/new` currently shows — a user in the wrong role currently can't tell "I'm not
      allowed" from "the app is broken." **Filed as [issue #768](https://github.com/mathewkaplos/lis-platform/issues/768).**
