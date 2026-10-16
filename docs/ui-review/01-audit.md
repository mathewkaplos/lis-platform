# Phase 1 Audit — LIS UI/UX Upgrade

**Date:** 2026-10-16
**Scope:** `apps/web` (Next.js 16 / React 19 / Tailwind 4) + `packages/ui` (shared design system).
**Method:** static code/config inspection only — see "What could not be verified" below for why,
and what remains outstanding once that's resolved.

Every claim is labeled **VERIFIED** (read directly in code/config), **ASSUMPTION** (inferred, not
directly confirmable from repo files), or **RECOMMENDATION** (a suggested action, not a finding).

---

## What could not be verified (and why)

This machine had no Node.js/pnpm installed and Docker Desktop could not be brought up — its
WSL2 backend never stabilized. Root cause, confirmed via `systeminfo`: **hardware virtualization
(Intel VT-x/AMD-V) is disabled in this machine's BIOS/UEFI firmware**
(`Virtualization Enabled In Firmware: No`), not a resource or software problem. This blocks, until
the owner enables it in BIOS and reboots:

- Every live-app item in this prompt's Phase 1 checklist: role logins, screenshots at any
  viewport, 200% zoom checks, keyboard-only completion testing, and the `web-design-guidelines` /
  Playwright / axe-against-the-real-app parts of the audit.
- Confirming whether `storybook-a11y` (the one CI job that *does* run headless Chromium, inside a
  prebuilt container — see §7) is a **required** GitHub branch-protection check — that's a repo
  setting, not a file, and `gh` isn't installed in this environment either.

Node.js 22.23.2 and pnpm 11.21.0 were installed and `pnpm install --frozen-lockfile` succeeded
cleanly, so once virtualization is enabled, `docker compose up -d` + `pnpm db:reset` + `pnpm dev`
should be the only remaining steps to unblock the live half of this audit.

Everything below is therefore a **code-level** audit: real, citable, but it cannot tell you how
anything actually renders, degrades across viewports, or behaves under a screen reader. Treat the
"Responsiveness" and parts of "Accessibility" sections as a map of what to go check live, not a
substitute for checking it.

---

## 1. Stack (VERIFIED)

- Frontend: Next.js **16.3.6** (App Router), React **19.2.4**, Tailwind **4** (CSS-first config,
  no `tailwind.config.*` file — see §2), `lucide-react` **0.475.0** (sole icon library, confirmed
  no other icon package imported anywhere in `apps/web`), `next-intl` **4.13.6**,
  `@playwright/test` **1.62.1** (devDependency, already present).
- Dev server runs on Webpack, not Turbopack (`apps/web/package.json:6`, `"dev": "next dev
  --webpack"`) — deliberate; see §9 for the documented reason.
- Routing: Next.js App Router, 4 route groups — `(app)` (internal staff), `(clinician)`,
  `(portal)` (patient), `(public)` (signup only).
- State management: no client global-state library (no Redux/Zustand/Jotai found); forms use
  React 19's `useActionState` against server actions; a handful of client components use local
  `useState` (e.g. the results grid's held-state banner).
- Styling: Tailwind 4 utility classes + the shared token layer in `packages/ui/src/tokens.ts`,
  bridged into Tailwind's `@theme inline` in `apps/web/app/globals.css`.
- Component library: `packages/ui`, built on shadcn/ui conventions (`components.json`: style
  `new-york`, icon library `lucide`) on top of Radix primitives (`radix-ui` package) for
  Dialog/Checkbox/Label/Popover/DropdownMenu.
- Build tooling: pnpm workspace monorepo, Vitest (unit), Playwright (e2e), Storybook
  (`packages/ui/.storybook`).

## 2. Design foundations (VERIFIED)

A design-token system **already exists** and is not a blank slate — this materially changes the
shape of Phase 2 (it's an audit-and-extend task, not a from-scratch design-direction exercise):

- `packages/ui/src/tokens.ts` + `docs/design.md`: color (light/dark), a 7-step type scale
  (12/13/14/16/20/24/30px), a 5-step spacing scale (8/12/16/24/32px on a 4px base), radius
  (6/8/12px + full), and two elevation values. Sourced from an external spec
  (`docs/plans/feat-010-design-system-v1.md`, "Google Stitch Prompt Library §0"), landed as
  **FEAT-010**.
- Dark mode: two co-existing mechanisms, both implemented — `prefers-color-scheme: dark` (OS
  default) and a `[data-theme="dark"]` attribute override, each able to override the other
  (`apps/web/app/globals.css:64-98`, explicitly documented as intentional).
- Theme toggle exists (`apps/web/app/(app)/_components/theme-toggle.tsx`) and is wired correctly
  for the internal `(app)` group via a cookie + server action — **but it is only ever rendered
  inside `(app)/_components/top-bar.tsx`**. `(clinician)` and `(portal)` have no equivalent, and
  `(public)` has no layout at all. Clinician and patient-portal users can never manually switch
  theme — only the OS default ever applies to them. **RECOMMENDATION:** decide in Phase 2/3
  whether that's acceptable (external users may not need it) or a gap to close.
- **Font-token drift (VERIFIED):** `tokens.ts`/`docs/design.md` document **Inter** as the UI font.
  The app actually loads **Geist**/**Geist Mono** via `next/font/google`
  (`apps/web/app/layout.tsx:2,9-17`), mapped in `globals.css:114-115`. Documentation and
  implementation have diverged — someone changed the font without updating the token doc, or vice
  versa. Low visual risk (both are clean geometric sans faces) but worth reconciling so the design
  doc is trustworthy again.
- **Breakpoints (VERIFIED absence, ASSUMPTION on resulting values):** no `tailwind.config.*`
  exists anywhere in the repo, and no `--breakpoint-*` custom properties are set in `globals.css`'s
  `@theme inline` block — consistent with Tailwind 4's CSS-first model, but it means breakpoints
  are whatever Tailwind 4 ships by default (`sm`640/`md`768/`lg`1024/`xl`1280/`2xl`1536px),
  un-reviewed against this project's actual target devices (bench desktop 1366×768 sits just below
  `lg`; worth a deliberate Phase 2 decision rather than inherited defaults).
- **One documented, intentional token bypass:** `packages/ui/src/components/stat-card.tsx:47`
  hand-picks a darker green (`#15803D`) instead of the canonical `--success` token (`#16A34A`)
  because the token fails contrast at that use — see §7 for why that instinct was correct, and
  that the same problem exists untreated in several other places.

## 3. Component inventory (VERIFIED)

17 components in `packages/ui/src/components/`: Badge, Button, Card (+5 sub-parts), Checkbox,
DataTable, DropdownMenu (+11 sub-parts), FilterBar, FormField, Input, Label, Popover (+5
sub-parts), Sheet (+9 sub-parts), SlideOver (+6 sub-parts, a thin re-export of Sheet — see below),
StatCard, StatusPill, SusceptibilityBadge, Table (+7 sub-parts).

- **Storybook coverage:** 7 of 17 have `.stories.tsx` files (DataTable, FilterBar, FormField,
  SlideOver, StatCard, StatusPill, SusceptibilityBadge). The other 10 have none, though 6 of those
  get *transitive* exercise as children inside the 7 stories (Button, Input, Checkbox, Label,
  Sheet, Table). **Badge, Card, DropdownMenu, and Popover get zero Storybook/axe coverage, direct
  or transitive** — DropdownMenu is notable since it backs every dropdown in the app's top bar
  (user menu, locale, theme).
- **Test coverage: zero.** No `*.spec.ts(x)`/`*.test.ts(x)` file exists anywhere under
  `packages/ui`. The only automated check on this package is the Storybook/axe CI job (§7), which
  only catches DOM-visible a11y violations, not logic regressions (e.g. a broken keyboard handler
  with no resulting axe violation would ship silently).
- **Design-system gap: no `Select` or `Textarea` primitive.** This isn't a duplication of an
  existing component so much as the system not covering a real, common need — see §9 for the
  resulting cost (≈22 copy-pasted raw style strings across `apps/web`).
- **Internal naming duplication:** `SlideOver` (`slide-over.tsx:20-42`) is Sheet with
  `side="right"` and a wider max-width forced — not an independent primitive, just a second name
  for the same thing. No misuse found in `apps/web`, but it's a latent "which one do I import"
  question for anyone extending the system.
- **3 raw `<table>` usages bypass `Table`/`DataTable`:**
  `apps/web/app/(app)/admin/report-templates/[testDefinitionId]/preview.tsx:87`,
  `apps/web/app/(app)/billing/facility-statement/page.tsx:191`,
  `apps/web/app/(app)/billing/invoices/[invoiceId]/invoice-view.tsx:89` — each hand-rolls the exact
  border/padding treatment `Table`/`TableRow`/`TableCell` already encode.
- **One direct, avoidable duplicate:** `apps/web/app/(app)/orders/page.tsx:126-131` hand-rolls a
  search `<input>` with `Input`'s exact className string, in a file that already imports
  `Button`/`Card` from `@lis/ui` — just not `Input`.
- Icons: fully consistent — `lucide-react` only, confirmed via repo-wide grep for competing icon
  libraries (zero hits).

Full inventory table, file:line citations, and the hex/px token-bypass list are preserved in the
raw research notes; ask if you want them expanded into this document rather than summarized.

## 4. Screen inventory

See `docs/ui-review/screen-inventory.md` — 39 pages (the brief's 37 undercounted by 2;
`report-templates` has a list + designer sub-page, and `cases/[caseId]` has 2 further nested
routes). Every row cites the page file and, where non-obvious, the exact role-check helper it
imports. **Screenshot columns are empty** for the reason in "What could not be verified" above.

## 5. Responsiveness audit — BLOCKED, static substitute only

Cannot run: no live render at any viewport, 200% zoom, or table-degradation behavior. What's
checkable from code alone:

- `sm:`/`md:`/`lg:`/`xl:` responsive Tailwind prefixes are used extensively across `apps/web`
  (confirmed in `apps/web/app/(app)/layout.tsx`, `_components/top-bar.tsx`,
  `_components/command-palette.tsx`, and throughout page-level JSX) — the app is clearly
  *attempting* responsive layout, not fixed-width-only.
- `DataTable` (`packages/ui/src/components/data-table.tsx`) has no built-in column-priority,
  sticky-column, or card-view-on-phone behavior — its own code comment says this scope was
  deliberately deferred. **This is the single highest-risk item for the bench-desktop/tablet/phone
  requirement in prompt §5** — every dense worklist/results screen in the app (orders, patients,
  cases, results-entry, QC violations, critical notifications) renders through this one component,
  so whatever table-degradation strategy Phase 2/3 picks, it only needs to be built once, here.
- Breakpoints are Tailwind defaults, unreviewed against the project's actual target devices (§2).

**RECOMMENDATION:** this section needs a full live pass the moment Docker/virtualization is
sorted, before Phase 2 proposes anything about table degradation — right now there's no evidence
either way about how bad it currently looks on a 1366×768 bench desktop or a 390px phone.

## 6. UX audit — key workflows (VERIFIED from code, not from driving the UI)

Traced via code for: register patient, register order, accession a specimen, receive a specimen,
enter results, review/authorize, release a report, handle a critical value, search.

**Strong, genuine safety gates already in place** (worth preserving exactly, not just
"not breaking," during the redesign):
- Specimen reception rejection requires a real two-step confirm (first click reveals a required
  reason select and does *not* submit; second click submits) —
  `apps/web/app/(app)/reception/reception-form.tsx:158-176`.
- Critical-value acknowledgment requires a **documented free-text read-back**, not a bare confirm
  button — the field is schema-required (`acknowledgeCriticalNotificationSchema`).
- Case sign-out/amend requires **server-enforced step-up re-authentication**
  (`@RequireStepUp()`) — a 403 redirects the browser into a fresh login challenge before the
  irreversible action can proceed. `screen()` (moving a case to pending review) deliberately has
  no such requirement.
- Patient registration checks for a probable duplicate (name+DOB) server-side and requires an
  explicit "register anyway" confirmation rather than silently creating a duplicate record.
- Result finalization is blocked inline, with a visible reason, when an unacknowledged critical or
  an open QC violation exists — not a silent failure.

**Gaps found:**
- **There is no global search.** The `Ctrl/Cmd+K` command palette
  (`apps/web/app/(app)/_components/command-palette.tsx:13-15,50-64`) is a literal, labeled stub —
  disabled input, "Coming soon" text, no command registry. Prompt §6 explicitly asks for "global
  search for patient / specimen / accession number" — this doesn't exist yet in any form; what
  exists is per-screen entity-scoped filters (patients, orders, cases each separately).
- **The dashboard — the first screen every role lands on after login — has no `error.tsx` or
  `loading.tsx`**, and neither does the `(app)` route group root itself. The highest-traffic screen
  in the app has zero App Router error/loading boundary.
- 403-handling is inconsistent: most pages render an inline, styled "you don't have permission"
  message; a few (`cases/[caseId]/page.tsx:84` and its two nested routes) instead `throw new
  Error()` and rely on the nearest error boundary, which renders as a generic crash page, not a
  polished permission message.
- Several routes (`/`, `/orders`, `/orders/[id]`, `/orders/[id]/results`, `/patients`,
  `/patients/[id]`) **deliberately removed** `loading.tsx` due to a reproduced Next 16.2.12 +
  `next dev --webpack` bug (the Suspense loading boundary never resolving client-side, confirmed
  via the dev server's own access-log timing). This is a real framework-level finding worth
  re-verifying against a production build (or Turbopack) before Phase 2/3 assumes loading
  skeletons are free to reintroduce — they may still be blocked by the same bug.
- Results-entry keyboard support is real but partial: Enter commits a value and advances focus to
  the next enterical row (`results-grid.tsx:238-254,318-320`), but there's no arrow-key 2D grid
  navigation and no `role="grid"` semantics — closer to "Enter-to-advance" than a full
  keyboard-navigable data grid. `DataTable` itself only supports `tabIndex=0` + Enter/Space on
  whole rows, same limitation.
- Click/field counts (prompt §6 asks for before/after measurement): patient registration is 11
  fields (3 required) + 1 click; specimen accession requires at least 1 dynamic part row + 1
  click, no confirmation dialog; order registration is checkbox-driven with a client-side filter,
  1 click. These are reasonable now baselines to compare any Phase 4 change against.

Role gating is handled consistently for internal `(app)` pages via 8 named helper functions in
`apps/web/auth/roles.ts`, each explicitly commented as "UI convenience only, not the real
enforcement point" (the real gate is `apps/api`'s `CapabilityGuard`). The two external portals,
`(clinician)` and `(portal)`, use a second, inline pattern (`session.roles.includes(...)` directly
in their layouts) instead of the shared helpers — not wrong, but a second convention to be aware
of.

## 7. Accessibility audit (VERIFIED from code + existing CI, not from a live screen reader/zoom pass)

**Existing automated coverage is real but narrower than it looks:**
- `.github/workflows/pr.yml`'s `storybook-a11y` job (line 488) genuinely fails the build on a real
  WCAG violation — it runs `axe-playwright`'s `checkA11y` against every Storybook story inside a
  prebuilt Playwright container (`packages/ui/.storybook/test-runner.ts`), checking
  `wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa` tags. Confirmed by direct read, not inference.
- But it only covers the **7 components that have stories**, plus whatever those stories render as
  children. **Badge, Card, DropdownMenu, and Popover get zero coverage.** The job's own comment
  ("6 design-system primitives") is already stale against the current 7-story/17-component
  reality — it undercounts by one and overstates how much of the library is actually checked.
  There is **no axe run against the real, integrated `apps/web` application anywhere** — only
  against isolated Storybook stories.
- Whether `storybook-a11y` is a *required* GitHub branch-protection check (i.e., can a PR merge
  with it red?) could not be determined from repo files — that's a GitHub settings artifact this
  session has no access to check. **RECOMMENDATION:** verify via `gh api
  repos/<owner>/<repo>/branches/main/protection` before relying on it as a hard gate.
- `eslint-plugin-jsx-a11y` is only partially enabled, and only in `apps/web`: `eslint-config-next`
  wires in 6 of its ~30 rules (`alt-text`, `aria-props`, `aria-proptypes`,
  `aria-unsupported-elements`, `role-has-required-aria-props`, `role-supports-aria-props`), **all
  at `warn` severity**, and `apps/web/package.json`'s `lint` script has no `--max-warnings` flag —
  so a real violation would show as a warning in CI output but **would not fail the build**.
  Missing entirely: `label-has-associated-control`, `click-events-have-key-events`,
  `no-static-element-interactions`, `anchor-is-valid`, and the rest of the plugin's rule set.
  `packages/ui` has **no ESLint config and no `lint` script at all** — ESLint (including those 6
  rules) never runs against the design system's own source.

**Manual code-level findings:**
- No raw `<img>` tags anywhere in the app (nothing to flag for missing `alt`).
- Every icon-only interactive element found (top bar user menu, theme toggle, mobile nav trigger,
  locale select, command palette, copy-chip) has an explicit `aria-label`, with decorative icons
  separately marked `aria-hidden="true"` — a real, consistent pattern, though the check was
  targeted at `lucide-react`-importing files (15 total) rather than exhaustive across every page.
- `FormField` (`packages/ui/src/components/form-field.tsx`) correctly wires `htmlFor`/`id`,
  `aria-describedby`, `aria-invalid`, and `aria-required` via `cloneElement`, and error text is
  `role="alert"` — a solid, reusable pattern, consumed consistently across 30 files.
- Dialogs/overlays (`Sheet`/`SlideOver`) are thin wrappers over Radix's `Dialog` primitive, which
  natively supplies `role="dialog"`, `aria-modal`, and a real focus trap + focus-return-on-close —
  confirmed via a prior Playwright-verified finding already documented in
  `mobile-nav-trigger.tsx:18-23`. The close button has visually-hidden "Close" text alongside its
  icon, not just an aria-label.
- Visible focus-ring styling exists on every primitive checked that has a focusable element (8 of
  17 components) — focus is not being suppressed anywhere found.
- **Contrast failures (WCAG 2.2 AA, SC 1.4.3), computed from the exact token hex values —
  confirmed real, repeated, at actual text sizes, not just icons:**
  - `textMuted` (#8A93A2) on white/background: **≈3.1:1**, fails the 4.5:1 normal-text threshold.
    Used as real 12-14px copy in `command-palette.tsx`, the Levey-Jennings chart, and the patient
    portal results page.
  - `colorSemantic.warning` (#D97706) used as text color: **≈3.0–3.2:1**, fails. Used for a
    clinically-relevant status message — `results-grid.tsx:666,673,706,713`'s "Saved — held on a
    QC violation..." text — not a decorative element.
  - `colorSemantic.success` (#16A34A) used as text color: **≈3.1–3.3:1**, fails. Used repeatedly
    for confirmation text across ~12 files (sign-out, screen, amend, narrative, email-send forms,
    the results grid's "Finalized" status).
  - `colorSemantic.danger` (error text) and `colorSemantic.info`/`colorAccent` (links/buttons) all
    **pass** (4.5–6.3:1).
  - This explains, and generalizes, `stat-card.tsx`'s own documented workaround (§2) — the same
    root problem (semantic tokens picked for chips/borders, not validated as text colors) shows up
    in at least 4 other components with real body/status copy, not fixed there.
- Keyboard support is real where it exists (global `Ctrl/Cmd+K` listener, `DataTable` row
  activation, results-grid Enter-to-advance) but, as noted in §6, is "Enter/Tab-level" rather than
  full 2D grid navigation anywhere.

**Testing/tooling snapshot:**
- `apps/web` has 6 real unit specs outside e2e, plus 10 Playwright e2e specs covering real
  clinical-workflow paths (admin CRUD, billing, case sign-out, the full register→order→receive→
  finalize→verify spine, patient editing, permission-denied, session-expired, unsaved-changes
  guard). **None of the 10 e2e specs include an accessibility assertion.**
  `packages/ui` has zero test files of any kind.
- No visual regression tooling anywhere (`percy`/`chromatic`/Playwright `toHaveScreenshot`: zero
  matches repo-wide). Phase 4's planned addition of Playwright visual snapshots (prompt §10) has a
  clean slate to build on, not a competing/legacy tool to migrate off of.

## 8. Quality tooling — CI snapshot (VERIFIED)

Two workflows relevant here:
- `pr.yml`: 4 jobs — `build-and-test` (lint/typecheck/migrate/seed/unit/e2e for apps/api+gateway+
  interop/build), `rls-isolation-check` (dedicated cross-tenant leak test), `web-e2e` (apps/web's
  real-browser Playwright suite against a full live stack), `storybook-a11y` (axe-on-Storybook,
  §7).
- `constitution-gate.yml`: 1 job, `check-invariants` — checks the two structural invariants (no
  free-text clinical columns, RLS required on new tenant tables). Unrelated to UI/a11y.

`pnpm lint`/`pnpm typecheck`/`pnpm test` all exist as scripts and run in CI; locally, none were run
this session (no reason to believe they'd behave differently, but not independently re-confirmed
here since this was a read-only audit).

## 9. Problem areas — synthesis (RECOMMENDATION, prioritization only; see §3/§6/§7 for the
underlying VERIFIED findings)

Ranked roughly by clinical-safety-adjacency, usability impact, and how cheaply each is fixed once
at the shared-component level vs. needing 20+ individual file edits:

1. **No `Select`/`Textarea` primitive** → ~22 independent copies of the same raw style string
   across the app. Highest-leverage single fix: build the two missing primitives once, and every
   consuming file becomes a one-line import swap.
2. **Contrast failures on `warning`/`success`/`textMuted` as text colors** → affects real
   clinical-status and confirmation copy, not decoration. Fixing the token values (or adding
   darker "on-light-text" variants, the pattern `stat-card.tsx` already improvised once) is a
   token-layer fix that propagates everywhere automatically.
3. **No global search**, despite being explicitly requested in this project's own prompt and
   having a visible, labeled "Coming soon" stub already in the UI users can see today.
4. **The dashboard (highest-traffic screen) has no error/loading boundary at all.**
5. **DataTable has no column-priority/sticky-column/card-view story** — every dense worklist in
   the app depends on this one component, so this is a single fix with the widest blast radius for
   the responsiveness requirement in prompt §5. Needs a live pass first (§5) to know how bad it
   actually looks before designing the fix.
6. **Design-system test coverage is zero**, and Storybook/axe coverage is 7 of 17 components
   (missing Badge, Card, DropdownMenu, Popover entirely) — any Phase 4 component change ships with
   no regression safety net beyond manual review.
7. **Inconsistent 403 handling** (styled inline message vs. raw thrown Error/crash page) — a
   cheap, mechanical fix once identified (3 files).
8. Smaller, lower-risk items: the Inter/Geist font-doc drift, `SlideOver`/`Sheet` naming overlap,
   the Levey-Jennings chart's color-only severity marker (legend compensates, in-chart points
   don't), theme toggle unreachable from `(clinician)`/`(portal)`.

---

*Raw, fully-cited research notes (full component table, full 39-page screen-by-screen trace, full
file:line lists for every duplicate/contrast/a11y finding) exist in this session's working notes
and can be expanded into this document or a companion appendix on request — summarized here to
keep this file reviewable in one sitting.*
