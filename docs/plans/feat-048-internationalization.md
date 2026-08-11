# Implementation Proposal: FEAT-048 Internationalization
Status: APPROVED
ADR: adr-0043 (accepted)    Date: 2026-08-11    Backlog ID: FEAT-048 (#57)

**Approved 2026-08-11** via the native options-prompt (all three §10 questions accepted as
recommended: ADR-0043's scope cuts as drafted, French as the second language, next-intl as the
i18n library).

## 1. Goal
"Support multiple languages and locales for the international ambition" (issue #57's own purpose
line). Literal AC: "The app correctly renders in at least one additional language with proper
date/number/unit locale formatting."

**Central finding, surfaced before any design choice (ADR-0043):** issue #57's own named
architecture doc (KB-51) and Stitch prompt (§20.15) describe a materially larger system than the
literal AC requires — full multi-language coverage across the entire app, a locale-settings admin
page (date/time format, timezone, first-day-of-week, currency, RTL, live preview), and SI-vs-
conventional clinical unit conversion. ADR-0043 scopes v1 to real, working i18n *infrastructure*,
proven end to end on the `(app)` shell chrome plus two representative screens (Dashboard/worklist
for number formatting, Orders list for date formatting) — the same narrowing discipline FEAT-032/
FEAT-046/FEAT-047's own proposals already applied to their own KB-vision-sized issues.

This codebase has no i18n infrastructure at all today (no `next-intl`/`i18next`/`react-intl`
dependency; every date/number display calls `.toLocaleDateString()`/`Intl.*` directly and ad hoc).
It does have a directly-applicable, already-proven precedent for "a global, session-persistent user
preference, no URL restructuring": dark mode (`lib/theme.ts` + `_actions/set-theme.ts` +
`theme-toggle.tsx` + `app/layout.tsx` reading a cookie). This proposal builds locale the same way.

## 2. Affected files
- `apps/web/package.json` — add `next-intl` dependency.
- `apps/web/next.config.ts` — wrap the existing config with `createNextIntlPlugin()`
  (`next-intl/plugin`), pointing at the new request-config file below. `transpilePackages:
  ["@lis/ui"]` stays unchanged (`frontend-design` entry #4 — unrelated to this change, don't touch
  it).
- `apps/web/i18n/request.ts` (new) — `next-intl`'s `getRequestConfig`, resolving the locale from
  the cookie set below (falling back to `DEFAULT_LOCALE`), loading that locale's message catalog
  from `apps/web/messages/<locale>.json`. **No `[locale]` URL segment, no `next-intl`'s own
  routing/middleware helpers** — this app's existing `proxy.ts` stays completely untouched (ADR-0043
  §Decision 1).
- `apps/web/lib/locale.ts` (new) — mirrors `lib/theme.ts` exactly: `LOCALE_COOKIE_NAME`,
  `SUPPORTED_LOCALES` (a `readonly [string, ...string[]]` tuple), `DEFAULT_LOCALE`, `isLocale()`
  type guard. Constants only, per `frontend-design` entry #8 — never colocated with the `'use
  server'` action file below.
- `apps/web/app/(app)/_actions/set-locale.ts` (new) — `'use server'`, mirrors
  `_actions/set-theme.ts` exactly: sets the locale cookie (`maxAge` matching the theme cookie's
  own one-year precedent), no other export.
- `apps/web/app/(app)/_components/locale-select.tsx` (new, `'use client'`) — a dropdown (not a
  two-state toggle like `ThemeToggle` — more than two values from day one), calling `setLocale()`
  then `router.refresh()`, mirroring `theme-toggle.tsx`'s exact `useTransition` shape.
- `apps/web/app/(app)/_components/top-bar.tsx` — add `<LocaleSelect current={locale} />` next to
  the existing `<ThemeToggle>`.
- `apps/web/app/(app)/layout.tsx` — read the locale cookie the same way it already reads the theme
  cookie, pass it to `TopBar`.
- `apps/web/app/layout.tsx` — read the locale cookie, resolve to a supported locale (default if
  unset/invalid), set `<html lang={locale}>` (currently hardcoded `"en"`), wrap `children` in
  `NextIntlClientProvider` with the resolved locale's messages — global to every route group
  (`(app)`/`(clinician)`/`(portal)`/`(public)`), so the mechanism is available everywhere even
  though only the `(app)` group ships translated content in v1.
- `apps/web/messages/en.json`, `apps/web/messages/<second-locale>.json` (new) — message catalogs
  for: `Sidebar` nav labels, `TopBar` static labels, the Dashboard/worklist page (title, stage-tab
  labels, filter labels, "Apply"), the Orders list page (title, column headers, any static filter
  labels).
- `apps/web/app/(app)/_components/sidebar.tsx` — nav labels via `useTranslations`.
- `apps/web/app/(app)/page.tsx` (Dashboard/worklist) — static strings via `getTranslations`
  (Server Component); `StatCard` count values via `getFormatter().number(...)` — the AC's *number*
  formatting proof point.
- `apps/web/app/(app)/orders/page.tsx`, `apps/web/app/(app)/orders/orders-table.tsx` — static
  strings via `getTranslations`/`useTranslations`; `orders-table.tsx`'s existing `new
  Date(row.createdAt).toLocaleString()` replaced with `useFormatter().dateTime(...)` — the AC's
  *date* formatting proof point. This is the only existing locale-sensitive call site this proposal
  touches; every other `.toLocaleDateString()`/`.toLocaleString()` call elsewhere in the app is
  explicitly out of scope (§5).
- **Explicitly NOT touched:** `apps/api/src/report/report-render.ts` (PDF generation) — its
  `formatDateTime`/`Intl.DateTimeFormat` stay pinned to `'en-US'`/`'UTC'`, unchanged (ADR-0043's own
  load-bearing boundary — TASK-058's byte-identical-PDF determinism AC depends on this).
  `apps/web/proxy.ts` — unchanged (no URL restructuring, §Decision 1).

## 3. Architecture consulted
- KB-51 (Commercialization) — the destination this v1 deliberately doesn't fully build yet;
  ADR-0043 documents exactly which parts.
- The Google Stitch Prompt Library §20.15 (Localization) — the fuller locale-settings-page vision
  ADR-0043 defers.
- `apps/web/lib/theme.ts` / `_actions/set-theme.ts` / `_components/theme-toggle.tsx` /
  `app/layout.tsx` (TASK-036) — the direct, already-proven precedent this proposal's own locale
  mechanism copies shape-for-shape.
- `apps/api/src/report/report-render.ts`'s own header comment (TASK-058) — the determinism
  boundary this proposal must not cross.
- `engineering/frontend-design` (required by the feature's own issue) — entry #4
  (`transpilePackages`/Next config gotchas — checked, not applicable to `next-intl`'s own plugin
  wrapping, but confirms `next.config.ts`'s current shape before editing it), entry #8 (`'use
  server'` files may only export async functions — `_actions/set-locale.ts` gets its own
  `lib/locale.ts` for constants, not colocated), entry #9 (route-group URL prefixes — irrelevant
  here since this proposal adds no new route group or dynamic segment).

## 4. Skills loaded
- `engineering/frontend-design` (required by the feature's own issue) — entries #4, #8, #9 (see
  above).
- `engineering/testing` — real-browser verification convention (`web-verify`) for the locale
  switch, mirroring every prior `apps/web`-touching feature's own manual-verification step.

## 5. Assumptions & autonomous decisions
- **ADR-0043's own scope cuts as one coherent v1 boundary** (cookie-based locale, no URL prefix;
  `(app)` shell + Dashboard + Orders list only, not full-app coverage; no §20.15 locale-settings
  page; no SI-vs-conventional unit conversion; `report-render.ts` untouched) — flagged together as
  §10 question 1, since they're one coherent scope decision, not several independent ones.
- **`next-intl`'s "without i18n routing" mode**, not its default URL-prefixed routing mode —
  avoids touching `proxy.ts`'s matcher or any existing route's URL shape (§10 question 2).
- **Context7 was unavailable when planning this feature** (transport-level errors, not a bad
  query — confirmed via three retries) — `next-intl`'s exact current API surface for the
  cookie-based/no-routing mode should be sanity-checked against its own docs at the start of
  `/develop`, not assumed correct purely from this proposal's own general knowledge of the library.
- **No update to `apps/web/proxy.ts`.** Locale never gates access the way auth does; the cookie is
  read, not enforced.

## 6. Risks
- **Every screen beyond the Dashboard and Orders list stays English-only** even when a non-English
  locale is selected — a real, visible gap for v1, acceptable per ADR-0043's own "prove the
  mechanism" framing, not acceptable as a permanent state.
- **`next-intl`'s message-catalog discipline is easy to drift from silently** — a missing key in
  the second locale's JSON file falls back to `next-intl`'s own default behavior (typically the key
  itself or an error, depending on configuration) rather than English; the testing plan below
  explicitly renders both locales to catch this, not just the default one.
- **A future feature that wants to translate a third screen** must remember to add its own message
  namespace to both `messages/*.json` files — no automated check enforces catalog parity between
  locales; left as a real, accepted gap for v1 (the same class of gap ADR-0043 accepts elsewhere).

## 7. Acceptance criteria
- [ ] A locale selector in `TopBar` switches the app between English and the chosen second
      language; the choice persists across a full page reload and a new browser session (cookie-
      based).
- [ ] With the second language selected, the `(app)` shell chrome (sidebar nav, top bar), the
      Dashboard/worklist page, and the Orders list page render entirely in that language — no raw
      translation-key strings visible anywhere on those screens.
- [ ] The Dashboard's `StatCard` counts render through locale-aware number formatting (proven by a
      real difference in output between the two locales' own number-formatting conventions, if any
      exist for integers — else proven by the formatter actually being invoked, not a
      `Number.prototype.toString()` fallback).
- [ ] The Orders list's created-at column renders through locale-aware date/time formatting, with a
      real, visible difference between the two locales' own date conventions.
- [ ] `apps/web/proxy.ts` is byte-for-byte unchanged.
- [ ] `apps/api/src/report/report-render.ts`'s existing test suite (`report-render.spec.ts`) passes
      unmodified, proving PDF generation's own determinism is untouched.
- [ ] Every other existing `apps/web` screen renders unchanged (still English, still its current
      hardcoded strings) with the second locale selected.

## 8. Testing plan
- Unit: none new beyond what's already covered — this feature is UI string/formatting plumbing, no
  new business logic (matching this repo's own precedent of not unit-testing plain component
  rendering elsewhere).
- Regression: `apps/api/src/report/report-render.spec.ts` (existing suite, run unmodified) — proves
  `report-render.ts`'s determinism boundary held.
- Manual: the app driven through a real headless browser (`web-verify`), **in both locales**: app
  shell chrome, Dashboard, and Orders list each screenshotted in English and in the second
  language; the locale selector exercised end to end (switch → reload → still switched); every
  other screen spot-checked to confirm it's still English-only and otherwise unaffected. Light and
  dark mode both, confirming the new `LocaleSelect` control doesn't regress `ThemeToggle`'s own
  existing behavior.

## 9. Rollback plan
One new dependency (`next-intl`), one `next.config.ts` wrapper (revertible in one line), a handful
of new files (`lib/locale.ts`, `_actions/set-locale.ts`, `_components/locale-select.tsx`,
`i18n/request.ts`, two `messages/*.json` files), and string/formatter edits confined to
`sidebar.tsx`/`top-bar.tsx`/`app/layout.tsx`/`app/(app)/layout.tsx`/the Dashboard/Orders screens. A
plain revert restores every screen's current hardcoded English strings with zero data or contract
implications — no migration, no API change, no route change.

## 10. Questions requiring human approval
1. **Approve ADR-0043's scope cuts as one coherent v1 boundary** — cookie-based locale with no URL
   prefix, `(app)` shell + Dashboard + Orders list only (not full-app translation coverage), no
   §20.15 locale-settings admin page, no SI-vs-conventional clinical unit conversion, and
   `report-render.ts` (PDF generation) left completely untouched — with each deferred piece tracked
   as real future work, not silently dropped?
2. **Which second language should v1 ship?** No existing artifact in this repo names a specific
   target market/language. Recommending **French** (broad reach across many Francophone lab
   markets, and a natural, well-resourced choice for `Intl`/ICU tooling) — alternatives considered:
   Spanish (broadest global second-language reach) and Swahili (plausible East-African market fit,
   given this project's own seeded-data conventions, though nothing in the repo confirms that
   target market). Any of the three works equally well as a proof of the mechanism; this is a real
   product decision, not a technical one, so it's not mine to pick silently.
3. **Approve `next-intl` as the i18n library** (vs. `i18next`/`react-intl`) — chosen for its
   first-class Next.js App Router support and built-in `Intl`-wrapping formatters
   (`useFormatter`/`getFormatter`), with the caveat that Context7 was unavailable to verify its
   current exact API during planning (§5) — a quick docs sanity-check at the start of `/develop` is
   planned regardless of this answer?
