# Implementation Proposal: Organization profile page (name, address, contact, logo, currency)
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #706 (part of EPIC #697)

## 1. Goal

There is no page to view or edit organization identity after signup —
`tenant`'s own schema (`packages/db/src/schema/tenant.ts`) has only a `name`
column, set once at signup and never editable. Add address, phone, email,
logo, and currency fields, and a real settings page to view/edit all of them
(including `name`).

While here: `apps/api/src/org-settings/org-settings.controller.ts`
(`GET`/`PUT /v1/org-settings`, issue #692) already exists for a single field
(`preferredSynopticSourceStandard`) but has **zero web UI consumers of the
`PUT`** — confirmed via `grep`. Rather than building a second, parallel
settings page, this proposal extends the existing controller/schema and
gives it its first real edit UI, covering both the new profile fields and
the pre-existing synoptic-standard preference in one screen.

## 2. Affected files

- **Modified:** `packages/db/src/schema/tenant.ts` — add `address`, `phone`,
  `email`, `logoUrl`, `currency` columns (all nullable `text`, matching
  `patient.ts`'s own convention for optional contact fields).
- **New:** `db/migrations/00XX_tenant_profile_fields.sql` — generated via
  `drizzle-kit generate`, not hand-written.
- **Modified:** `packages/domain/src/org-settings.ts` — extend
  `orgSettingsSchema`/`orgSettingsUpdateSchema` with the new fields plus
  `name` (all optional in the update schema; `name` non-empty when
  provided).
- **Modified:** `apps/api/src/org-settings/org-settings.controller.ts` —
  `get()` selects and returns the new columns; `update()`'s upsert sets them
  on conflict too (currently only `preferredSynopticSourceStandard` is
  updated on conflict — `name` is explicitly never touched once a row
  exists, per its own comment; this proposal changes that specifically for
  `name`, since editability is the whole point of this feature, while
  keeping the same lazy-upsert shape for tenants with no row yet).
- **New:** `apps/web/app/(app)/admin/org-settings/page.tsx` — Server
  Component, fetches current settings via `GET /v1/org-settings`.
- **New:** `apps/web/app/(app)/admin/org-settings/org-settings-form.tsx` —
  `'use client'` form (mirrors `create-referring-facility-form.tsx`'s
  `useActionState` shape), covering name/address/phone/email/logo
  URL/currency/preferred synoptic standard in one form.
- **New:** `apps/web/app/(app)/admin/org-settings/actions.ts` — `'use
  server'` action calling `PUT /v1/org-settings`.
- **New:** `apps/web/app/(app)/admin/org-settings/types.ts` — `State`/
  initial-state constant, kept out of the `'use server'` file per
  `engineering/frontend-design` entry #8.
- **Modified:** `apps/web/app/(app)/_components/sidebar.tsx` — add "Org
  settings" nav entry, unconditional (matches this file's own documented,
  repeatedly-reaffirmed no-nav-gating convention — see #710's closure).
- **Modified:** `packages/i18n` message file(s) for the new nav label key
  (matching FEAT-048's `labelKey` convention already used by every other nav
  item).

## 3. Architecture consulted

- `apps/api/src/org-settings/org-settings.controller.ts`'s own header
  comment — the lazy-upsert-on-first-write pattern for the exemption-tier
  `tenant` table (ADR-0039), and why `TenantContextInterceptor`'s `tx` is
  used only for the audit transaction, not RLS.
- `create-referring-facility-form.tsx` — the `useActionState` create-form
  shape this new form mirrors.
- `engineering/frontend-design` Skill entries #6 (function props / Server-
  Client boundary — not directly triggered here, no `DataTable` involved)
  and #8 (`'use server'` files may only export async functions — directly
  applicable, hence the separate `types.ts`).

## 4. Skills loaded

`engineering/frontend-design` (new `apps/web` page/form) and
`engineering/api-design` (modifies an existing `apps/api` route).

## 5. Assumptions & autonomous decisions

- **Currency stored as free text (ISO 4217 code), not a DB enum** — matches
  this schema's own established convention of never enum-constraining this
  class of field (`synoptic_protocol.source_standard`,
  `preferredSynopticSourceStandard` itself). The web form offers a `<select>`
  of common codes (USD, KES, EUR, GBP, plus an "other" free-text fallback)
  as the UI-level constraint, not a schema-level one — the actual choice of
  which currencies to support display-wise is a later, separate concern
  (invoice currency formatting) out of this proposal's scope.
- **Logo stored as a URL, not a file upload.** Building real file-upload
  infrastructure (object storage, an upload endpoint) for a single logo
  image is disproportionate to this issue's scope; a URL field lets an org
  point at an already-hosted image. A real upload flow is a reasonable
  future fast-follow, not blocking this issue.
- **`name` becomes genuinely editable**, changing the existing
  `update()`'s documented "never touching name" behavior specifically for
  this field. This is the correct, intended behavior change for this
  feature (the whole point is org identity being editable) — the original
  comment's reasoning ("tenants pre-dating FEAT-045 have no name to
  preserve") only explains why the *lazy-create* path uses a placeholder,
  not why an explicit edit should be blocked.
- **Gated by the existing `manage_org_settings` capability**, currently
  granted only to `qa`. Once #701 (real role model) lands, this should move
  to whatever role becomes "org admin" — not blocking this issue on that
  one, since `qa` is the correct *existing* holder of this capability today.

## 6. Risks

Low-medium. Touches a real schema migration and an existing, working
endpoint (`org-settings`) that #692's synoptic-picker feature already
depends on — the migration is additive-only (new nullable columns, no
backfill/rename of anything `#692` already relies on), and `update()`'s
`preferredSynopticSourceStandard` behavior is preserved unchanged, only
extended.

## 7. Acceptance criteria

- A `qa`-role user can view and edit org name, address, phone, email, logo
  URL, currency, and preferred synoptic standard from one screen, and the
  values persist and reload correctly.
- A non-`qa` user can view the page (read-only) but the form's save action
  is rejected (403) if attempted directly, matching every other admin
  screen's existing capability-gating shape.
- Existing #692 synoptic-picker behavior (auto-resolving the CAP/ICCR choice
  from `preferredSynopticSourceStandard`) is unaffected.
- `pnpm typecheck` and `pnpm lint` pass; migration applies cleanly against
  the local dev DB.

## 8. Testing plan

Manual `web-verify`-style pass (direct HTTP against a signed session
cookie, given this session's real-browser flakiness): confirm `GET
/admin/org-settings` renders, `PUT /v1/org-settings` round-trips all new
fields via curl against the real API, and the existing synoptic-picker
consumer (`cases/[caseId]/synoptic/[partId]/page.tsx`) still resolves
correctly with a `preferredSynopticSourceStandard` set.

## 9. Rollback plan

Revert the migration (drop the new columns — additive-only, no data loss
for any pre-existing consumer) and the new files; `org-settings.controller.ts`
and `org-settings.ts` revert to their pre-existing single-field shape.

## 10. Questions requiring human approval

None — capability gating, currency-as-text, and logo-as-URL are all
consistent with existing repo conventions and reasonable scope-limiting
choices for this issue specifically.
