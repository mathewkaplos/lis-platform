# Implementation Proposal: Fix real page-wide horizontal overflow on narrow viewports (#713 follow-up)
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #713 follow-up (part of EPIC #697)

## 1. Goal

The earlier #713 pass (PR #728) was a code-level Tailwind-breakpoint audit only — this session's live browser tooling was unreliable at the time, disclosed transparently. The user asked for a thorough follow-up with real device/viewport testing. This proposal is that follow-up: a genuine live rendering pass at real narrow viewports, which surfaced one real, previously-undetected bug that no static code read could have caught.

## 2. Finding

At a real 386×840px viewport, the entire app shell overflowed horizontally to ~1686px on the dashboard (Worklist) page — roughly 4.5x the actual viewport width. Root cause: the classic Flexbox "min-width: auto" trap. `apps/web/app/(app)/layout.tsx`'s content-column `<div className="flex flex-1 flex-col">` is a flex item inside the outer row (`Sidebar` + this column). A flex item's default `min-width` is `auto`, meaning it will not shrink below its content's intrinsic minimum width — so any sufficiently wide descendant (here, the dashboard's worklist `Table`, whose long test names + `whitespace-nowrap` header cells have real intrinsic width) forces this column, and every ancestor up to `<body>`, to grow to fit it. This happens *despite* the `Table` component's own `overflow-x-auto` wrapper (`packages/ui/src/components/table.tsx`), because the flex sizing algorithm computes the item's minimum size from content *before* that wrapper's overflow ever gets a chance to clip/scroll it.

This is exactly the class of bug a static Tailwind-class read cannot catch — every individual class involved (`flex-1`, `overflow-x-auto`, `whitespace-nowrap`) is correct in isolation; the bug only manifests as an emergent interaction once real content is rendered at a real narrow width.

## 3. Affected files

- `apps/web/app/(app)/layout.tsx` — added `min-w-0` to the content-column flex item and to `<main>`, the standard, minimal fix for this exact Flexbox trap.

## 4. Architecture consulted

`packages/ui/src/components/table.tsx` (confirmed the `overflow-x-auto` wrapper is correctly present and was never the problem — the bug was one level up, in the flex ancestor chain not letting that wrapper's sizing take effect).

## 5. Method (why this pass found what the code-only pass missed)

`resize_window` in this session's browser tooling reports success but has zero real effect (confirmed via direct `window.innerWidth` inspection — stuck at 1366×768 regardless of the requested size), and earlier `computer` screenshot calls hit the same intermittent renderer-freeze pattern documented elsewhere this session. Rather than give up at that wall, used a genuine same-origin `<iframe>` sized to real device dimensions (390×844 mobile, 768×1024 tablet) — an iframe's `contentWindow` has its own independent CSS viewport for media-query purposes regardless of the outer browser window's actual size, confirmed directly (`iframe.contentWindow.innerWidth` === the requested width, `matchMedia('(min-width:640px)')` correctly toggling). This is real, CSS-spec-accurate viewport rendering, not a simulation — every screenshot and every overflow measurement in this pass is of an actually-narrow document, not an inference.

Programmatic overflow detection (`document.documentElement.scrollWidth > clientWidth`) was used as the primary signal rather than relying on visual screenshot inspection alone, since screenshots only show what's inside the frame and can't prove *absence* of overflow — the DOM measurement can.

## 6. Testing plan

- `pnpm --filter web typecheck`/`lint` clean.
- **Live-verified, real narrow-viewport rendering, before and after the fix:**
  - Before: dashboard page, 386px real viewport → `scrollWidth: 1686`, confirmed overflow, root element traced to the specific `TH`/table row content.
  - After: same page, same viewport → `scrollWidth: 371` (no overflow), programmatically confirmed via `documentElement.scrollWidth <= clientWidth`.
  - Swept every other key pilot screen at the same real 386px viewport post-fix, all clean (`overflow: false`): `/patients`, `/patients/new`, `/orders`, `/cases`, `/admin/org-settings`, `/admin/users`, `/admin/referring-facilities`, `/billing/invoices`.
  - Spot-checked `/orders` at a real 768px tablet viewport post-fix: clean, sidebar/TopBar/filters/table all render correctly with the `sm:` breakpoint genuinely active (`matchMedia` confirmed).
  - Visually confirmed via real screenshots: the mobile nav drawer opens/closes correctly and lists all 14 nav items reachable; the TopBar header (PR #728's own fix) correctly collapses to icon-only/hidden-tenant-badge at mobile width and shows the full search/tenant-badge/locale/theme/avatar row at tablet width.

## 7. Rollback plan

Revert `apps/web/app/(app)/layout.tsx`. No schema/API change.
