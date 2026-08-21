# Implementation Proposal: Accessibility pass (keyboard + screen reader) across pilot flows
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #717 (part of EPIC #697)

## 1. Goal

A keyboard-only and screen-reader-facing code audit across the flows this
epic touches (org signup, patient registration/search, order entry, AP
case accessioning/sign-out, billing), per #717's acceptance criteria:
every in-scope flow completable keyboard-only, no interactive control
invisible to a screen reader. As with #713, this session's live browser
tooling was unreliable, so this is a code-level audit (component source,
not a live screen-reader run), disclosed transparently rather than claimed
as device-verified. `#710` (referenced by #717 as prior art) was actually
closed as not reproducible this epic -- table rows were already keyboard-
accessible; this issue is the broader sweep #717 itself calls for.

## 2. Findings

- **`DataTable` (`packages/ui/src/components/data-table.tsx`): already
  correct.** Clickable rows get `tabIndex={0}`, an `onKeyDown` handler for
  Enter/Space, and a visible `focus-visible:ring`. Confirms #710's own
  closure.
- **Icon-only buttons across `apps/web` (`ThemeToggle`, `LocaleSelect`,
  `MobileNavTrigger`, the report-template designer's move/remove
  controls, the top-bar user-menu trigger): already correct.** Every one
  carries a real, specific `aria-label` (spot-checked directly, not
  sampled -- grepped every `size="icon*"` button in `apps/web/app` for a
  missing `aria-label`; the only matches without one in the same diff
  window were false positives where the label is a few lines further
  down).
- **Custom dropdowns/sheets (`LocaleSelect`, `MobileNavTrigger`'s `Sheet`):
  already correct.** Built on Radix primitives (`DropdownMenu`, `Sheet` in
  `packages/ui`), which supply focus trapping, `Escape`-to-close, and
  focus restoration out of the box -- confirmed via `mobile-nav-trigger.tsx`'s
  own comment describing a real Playwright pass that specifically verified
  focus-restore-on-close behavior.
- **Form labeling (`patients/new`, `orders/new/order-builder-form.tsx`,
  `orders/page.tsx`'s filter form, `cases/[caseId]/synoptic/[partId]/
  protocol-form.tsx`'s real clinical data-entry form, the report-template
  designer): already correct.** Every raw `<input>`/`<select>` found via a
  direct grep across `apps/web/app/(app)` is wrapped in either the shared
  `FormField` component or an explicit `<label>` element -- including
  `protocol-form.tsx`'s `coded_multi` checkbox-group branch, which
  deliberately renders its own `<label>` per option specifically because
  `FormField`'s single-child contract doesn't fit a group (its own comment
  explains this).
- **`storybook-a11y` CI check: real, but narrower than #717's own scope.**
  It runs an axe pass against `packages/ui`'s design-system primitives
  only (per its own comment in `.github/workflows/pr.yml`, "6
  design-system primitives") -- it does not cover real app pages/flows, so
  it wouldn't have caught the one real gap found below.
- **Genuine gap found: no "skip to main content" link in the `(app)`
  shell.** `apps/web/app/(app)/layout.tsx` renders `Sidebar` (14 nav
  links) + `MobileTopNav` + `TopBar` (search trigger, tenant badge,
  locale, theme, user menu) before `<main>` on *every* page, with no way
  to bypass them. A keyboard-only user re-tabs through this same block on
  every single page navigation across every flow in scope -- a textbook
  WCAG 2.4.1 "Bypass Blocks" failure, and one that compounds specifically
  because it repeats on every page rather than being a one-off.

## 3. Affected files

- `apps/web/app/(app)/layout.tsx` -- added a "Skip to main content" link
  (visually hidden via `sr-only`/`focus:not-sr-only`, first element in tab
  order) targeting a new `id="main-content"` on the `<main>` element
  (given `tabIndex={-1}` so it's a valid, reliable focus target for a
  non-focusable-by-default landmark element).

## 4. Architecture consulted

`packages/ui`'s `DataTable`, `DropdownMenu`, `Sheet`, `FormField`
components (confirmed already accessible); `.github/workflows/pr.yml`'s
`storybook-a11y` job (confirmed its actual scope); `docs/plans/
task-240-mobile-nav.md` (existing precedent for the shell's own nav
components).

## 5. Skills loaded

`engineering/frontend-design` (existing `apps/web` layout modified).

## 6. Assumptions & autonomous decisions

- Scoped the fix to the `(app)` route group (the shell shared by every
  flow #717 names: org signup lands here post-auth, patient/order/case/
  billing screens all render inside it) -- the separate `(clinician)` and
  `(portal)` route groups have their own layouts and are not named in
  #717's flow list; flagged as a candidate follow-up, not fixed here, to
  keep this change scoped to what was asked.
- Did not add a second skip-link target for the sidebar nav itself (e.g.
  "skip to navigation") -- with only one persistent landmark to bypass
  (main content is the only thing worth skipping *to*), a single link
  covers the actual friction point named in #717's own acceptance
  criteria.
- Given the breadth of "every flow in Phases 1-3" and this session's
  disclosed browser-tooling limitation, treated a thorough source-level
  audit (every custom interactive component, every raw form input) as the
  right-sized substitute for a live screen-reader pass, consistent with
  the same judgment call already made and disclosed on #713.

## 7. Risks

Very low -- an additive, visually-hidden-until-focused link plus a
`tabIndex={-1}`/`outline-none` landmark id. No change to any existing
tab order, control, or visible layout at rest.

## 8. Testing plan

`pnpm --filter web typecheck`/`lint` clean. Live screen-reader/keyboard
device verification is explicitly **not** performed this session (browser-
tooling instability, same disclosed limitation as #713) -- flagged for a
follow-up manual pass rather than claimed as verified.

## 9. Rollback plan

Revert `apps/web/app/(app)/layout.tsx`. No schema/API/behavior change.
