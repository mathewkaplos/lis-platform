# Implementation Proposal: Mobile navigation trigger (issue #240)
Status: APPROVED
ADR: none    Date: 2026-08-20    Backlog ID: TASK-240

## 1. Goal
`apps/web/app/(app)/_components/sidebar.tsx`'s root `<nav>` is `hidden ...
sm:flex` — fully unreachable below Tailwind's `sm` breakpoint (640px), with no
replacement trigger. Below `sm`, an authenticated user has no way to navigate
at all except the browser back button and whatever link happens to already be
on the current page. Add a hamburger-triggered drawer, visible only below
`sm`, that surfaces the same nav items the desktop sidebar already renders —
closing the gap without redesigning the app shell.

Deliberately scoped to *only* this: per `frontend-design` Skill entry #12,
"responsive/mobile layout" for the rest of the app (individual screens,
tables, forms at narrow widths) has never been verified and is explicitly out
of scope here. This proposal makes the nav reachable; it does not audit or
fix any other screen's own narrow-viewport behavior.

## 2. Affected files
- `packages/ui/src/index.ts` — add `Sheet`/`SheetTrigger`/`SheetContent`/
  `SheetClose`/`SheetHeader`/`SheetTitle` to the existing "underlying
  shadcn/ui base components" export block. **Finding, not assumption:**
  `packages/ui/src/components/sheet.tsx` already exists on disk (it's what
  `SlideOver` wraps) but is not exported from `index.ts` today — confirmed by
  grep, zero non-`slide-over.tsx` importers anywhere in the repo. This
  proposal is the first consumer to need the bare primitive directly.
- `apps/web/app/(app)/_components/sidebar.tsx` — extract the existing
  `NAV_ITEMS.map(...)` link-list JSX into a small shared subcomponent
  (`SidebarNavLinks`, plain function, no new client boundary) so the exact
  same rendered links (already server-translated via `getTranslations`) can
  be reused inside both the desktop `<nav>` and the new mobile drawer's
  content, with zero duplication of the `NAV_ITEMS` array or its labels.
- `apps/web/app/(app)/_components/mobile-nav-trigger.tsx` (new) — `'use
  client'`. Renders a hamburger `Button` (`sm:hidden`) that opens a
  `Sheet`/`SheetContent side="left"` containing whatever `children` it's
  given. Closes itself automatically on route change via `usePathname()` (see
  §5 — no existing precedent for this pattern in the repo, first real use).
- `apps/web/app/(app)/_components/sidebar.tsx` — render a new slim `sm:hidden`
  mobile header strip (app name + `MobileNavTrigger` wrapping
  `<SidebarNavLinks />`) alongside the existing desktop `<nav>`, both returned
  from the same `Sidebar` server component (a Server Component may render a
  Client Component and pass it pre-rendered JSX children — no function values
  cross that boundary, so `frontend-design` entry #6's constraint doesn't
  apply here).

No `apps/api` change. No new route. No new translation namespace (reuses the
existing `Sidebar` message keys).

## 3. Architecture consulted
- `docs/plans/feat-010-design-system-v1.md` (TASK-036's own proposal) —
  confirms the sidebar's `hidden ... sm:flex` shape was a deliberate desktop-
  only v1 scope cut, not an oversight, and that no mobile trigger was ever
  planned as a fast-follow at that time.
- No ADR governs app-shell layout/navigation; none is being added here — this
  is UI/query-surface-shaped work over the existing message-key-driven nav
  list, not a new architectural decision (same standing as `ADR-0041`'s
  framing for billing's own deferred screens).

## 4. Skills loaded
- `engineering/frontend-design` (required — new `apps/web` component). Its
  own entry #12 names this exact gap and issue number. Entry #6 (function
  props can't cross into Client Components) directly shapes the
  server-renders-then-passes-children design in §2/§5. Entry #9/#10 (route
  group / dynamic-segment naming) not applicable — no new route added.

## 5. Assumptions & autonomous decisions
1. **Use the bare `Sheet` primitive (`side="left"`), not `SlideOver`.**
   `SlideOver` is one of the 6 exported design-system primitives, but it's a
   purpose-built *right-side, 480-640px* detail/quick-edit panel (per its own
   header comment, sized for the Stitch Prompt Library's slide-over spec) —
   the wrong shape and side for a narrow left-side nav drawer. Exporting
   `Sheet` directly from `index.ts` matches the file's own existing
   precedent ("underlying shadcn/ui base components, available directly for
   cases the 6 primitives don't cover").
2. **The drawer closes itself on navigation via `usePathname()` + `useEffect`,
   not Radix's default close-on-outside-click/Escape only.** `(app)/layout.tsx`
   persists across client-side navigations within the route group (Next.js
   App Router layout semantics), so the `Sheet`'s own open/closed React state
   would otherwise survive a link tap and leave the drawer open over the next
   page. This is a real, first-use pattern in this repo (grepped: no existing
   `usePathname` caller anywhere in `apps/web`) — flagged here rather than
   discovered only during `web-verify`, since it's a predictable consequence
   of Next's own persistence model, not project-specific trivia.
3. **The mobile trigger lives inside `sidebar.tsx` itself, not `top-bar.tsx`.**
   `Sidebar` already owns `NAV_ITEMS` and the server-side translated labels;
   moving that data into `TopBar` (a plain props-only component today, no
   session/translation access) would be a larger, unrelated refactor. The
   mobile header strip renders as a sibling of the desktop `<nav>`, inside the
   same file, both `sm`-gated in opposite directions (`sm:hidden` /
   `hidden sm:flex`).
4. **No role/capability filtering added.** Matches every existing nav-entry
   precedent in this file (confirmed, see the file's own header comments) —
   the API's own `CapabilityGuard` is the real enforcement point, not the
   nav. The mobile drawer surfaces exactly the same unconditional list the
   desktop nav already does.
5. **Scope is the trigger + drawer only — no broader mobile audit.** Per the
   issue's own explicit open question ("fast-follow vs. defer to a broader
   mobile pass") and this proposal's own §1 framing.

## 6. Risks
- **`resize_window` (Claude-in-Chrome) is confirmed unreliable in this dev
  environment** — session 41's breadcrumb found it reports success while
  `window.innerWidth` never actually changes. Verification here must use a
  real Playwright viewport (`web-verify` Skill's own native headless
  Chromium, `page.setViewportSize`), not the browser-extension tool, or must
  confirm `window.innerWidth` directly before trusting any extension-driven
  resize.
- **First real use of `usePathname()` in this repo** — no existing precedent
  to mirror if the close-on-navigate behavior misbehaves (e.g. a race between
  the Sheet's own exit animation and the route change). Needs an actual
  browser-driven check (tap a link, confirm the drawer is closed on the next
  screen), not just a code read.
- **`Sheet`'s default `w-3/4` content width** (`sheet.tsx`'s own `side="left"`
  class) may be wider than ideal for a short nav-item list vs. its original
  design intent (detail panels) — a minor visual judgment call, not a
  functional risk; can be trimmed via `className` on `SheetContent` if it
  looks wrong live.

## 7. Acceptance criteria
- Below `sm` (640px): the desktop `<nav>` is hidden (unchanged); a hamburger
  button is visible and opens a left-side drawer containing every item
  currently in `NAV_ITEMS`, each a real working link.
- At/above `sm`: the hamburger trigger is hidden (unchanged desktop
  behavior); the existing `<nav>` renders exactly as it does today.
- Tapping a nav link inside the open drawer navigates to that route and the
  drawer is closed on the destination page (not left open over it).
- The trigger button is keyboard-reachable and operable (`Enter`/`Space`),
  and the drawer traps focus and closes on `Escape` — Radix `Dialog`'s own
  built-in behavior, confirmed still present through this wrapping, not
  assumed.
- No change to any existing desktop-viewport behavior or to any other screen.

## 8. Testing plan
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter web build` — standard gate,
  no automated check in this repo currently exercises viewport-conditional
  Tailwind classes.
- No new Storybook story — `sidebar.tsx`/`top-bar.tsx` (the app-shell
  composition layer) have never been storied in this repo (confirmed: no
  `.stories.*` file exists for either); the new `mobile-nav-trigger.tsx`
  follows that same precedent rather than introducing shell components into
  Storybook for the first time.
- Real `web-verify` pass (native Playwright, per session 39/40's own
  established native-Windows setup — not the Claude-in-Chrome extension, per
  §6's risk): log in as a real user, set viewport to a real mobile width
  (e.g. 390×844), confirm the desktop nav is gone and the hamburger/drawer
  works end-to-end (open, every link present, tap-to-navigate, drawer closed
  on the destination page, `Escape` closes it). Repeat at `sm` and above to
  confirm no desktop regression. Check both light and dark mode.
- Manual keyboard-only pass (matches session 41's own just-fixed
  keyboard-activation bug on the status tabs): reach the trigger via `Tab`,
  activate with `Enter`/`Space`, confirm focus lands inside the drawer, `Tab`
  through the links, close with `Escape`, confirm focus returns to the
  trigger button (Radix `Dialog`'s default) — verified live, not assumed
  from the primitive's own docs, per session 41's own finding that a
  React-focus + synthetic-key approach can mask a real markup bug.

## 9. Rollback plan
Single, self-contained PR touching only `packages/ui/src/index.ts` (additive
export) and three files under `apps/web/app/(app)/_components/`. Revert the
PR; no schema, migration, or API surface involved.

## 10. Questions requiring human approval
1. **Scope: ship just the trigger+drawer now (this proposal), or fold in a
   broader mobile-viewport audit of other screens while this is already
   being touched?** **Approved as recommended (2026-08-20): ship this
   proposal's scope only** — the broader audit is a real, larger,
   separately-scoped effort (frontend-design entry #12 notes zero existing
   screens have been verified at narrow width) and bundling it here risks
   turning a small, well-bounded fix into an open-ended one.
2. **Export `Sheet` directly from `packages/ui`'s public index, or keep it
   internal and have `mobile-nav-trigger.tsx` import from the relative
   component path instead?** **Approved as recommended (2026-08-20): export
   it** (matches the file's own stated convention for "cases the 6 primitives
   don't cover") — a future screen needing a plain (non-detail-panel-shaped)
   drawer/sheet shouldn't have to reach past `packages/ui`'s public surface
   to get one.
