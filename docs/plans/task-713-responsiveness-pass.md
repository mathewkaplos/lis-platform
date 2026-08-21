# Implementation Proposal: Tablet/mobile responsiveness pass
Status: IMPLEMENTED
ADR: n/a    Date: 2026-08-21    Backlog ID: #713 (part of EPIC #697)

## 1. Goal

Audit the pilot-facing screens for narrow-viewport (phone/tablet) breakage
and fix genuine issues found. This session's live browser tooling was
unreliable (login form submissions not registering across repeated
retries, confirmed via a healthy `apps/web` dev log with no corresponding
request) -- per `web-verify`'s own documented gotchas, this is treated as
environment/tooling flakiness, not evidence either way about the app. This
proposal is scoped, transparently, to a **code-level responsive audit**
(Tailwind breakpoint handling read directly from source) rather than
device/browser visual verification.

## 2. Findings

- **App shell mobile nav: already correct, no action needed.**
  `apps/web/app/(app)/layout.tsx` renders `Sidebar` (`hidden ... sm:flex`)
  and `MobileTopNav` (a real drawer via `MobileNavTrigger`, `sm:hidden`)
  side by side -- full mobile nav coverage already exists. (This
  contradicts a stale note elsewhere claiming issue #240, mobile sidebar,
  was unresolved; #240's own proposal doc
  `docs/plans/task-240-mobile-nav.md` is the real precedent and matches
  what's in the code today.)
- **`TopBar` (`apps/web/app/(app)/_components/top-bar.tsx`): a real,
  confirmed overflow bug.** Its row is `flex justify-between` with no
  `flex-wrap`, and `MobileTopNav` renders *above* it at every breakpoint
  (it doesn't replace `TopBar` on mobile -- both are visible). The row
  packs `CommandPalette`'s full-width trigger (icon + "Search..." text +
  a "Ctrl+K" `<kbd>`) on the left, and a raw 36-character tenant UUID
  badge + locale select + theme toggle + user-menu avatar on the right,
  with no shrink/wrap/hide handling anywhere in the row. On a real phone
  viewport (~375-414px) this set of controls cannot fit on one line, and
  since a page must never scroll horizontally by design, the row overflows
  its container.
- Grid-based forms/screens already checked (`order-builder-form.tsx`,
  `(app)/page.tsx`, `patients/[id]/page.tsx`, `report-templates` designer,
  `reference-ranges-table.tsx`) all use responsive `sm:`/`md:`/`lg:`
  grid-cols prefixes that collapse to a single column below the
  breakpoint -- correct pattern already, no action needed.
- Table-heavy screens (`invoices-table.tsx`, `facility-statement`,
  `cases-table.tsx`, etc.) all render through the shared `DataTable`/
  `Table` primitives in `packages/ui`, both of which already wrap their
  content in `overflow-x-auto` containers (`data-table.tsx:96`,
  `table.tsx:9`) -- correct pattern already, no action needed.

## 3. Affected files

- `apps/web/app/(app)/_components/top-bar.tsx` -- the tenant-ID badge is
  now hidden below `sm` (it's a static label per its own existing
  comment, not a switcher -- no functional loss on mobile, and it was the
  single largest fixed-width element in the row).
- `apps/web/app/(app)/_components/command-palette.tsx` -- the "Search..."
  label and "Ctrl+K" `<kbd>` hint collapse to icon-only below `sm`; added
  `aria-label="Search"` to the trigger button since it can now render with
  no visible text.

## 4. Architecture consulted

`docs/plans/task-240-mobile-nav.md` (the original mobile-nav proposal,
confirms `MobileTopNav`'s own intentional stacking-above-`TopBar` design)
and the shared `DataTable`/`Table` primitives in `packages/ui` (confirmed
already handle horizontal overflow correctly, no changes needed there).

## 5. Skills loaded

`engineering/frontend-design` (existing `apps/web` components modified --
responsive class changes only, no new components).

## 6. Assumptions & autonomous decisions

- Chose to hide (not truncate) the tenant-ID badge on mobile, since it's
  explicitly a static label with no interactive purpose (existing comment:
  "not a switcher") and truncating a UUID to a few characters would leave
  it meaningless anyway.
- Chose icon-only collapse for the command-palette trigger over removing
  it on mobile entirely, since Cmd/Ctrl+K itself remains a legitimate
  desktop-only affordance, but the icon should stay reachable everywhere
  the stub exists at all.
- Scoped this pass to the app shell (the one component present on every
  authenticated page) plus a source-level check of grid/table patterns
  elsewhere, rather than a page-by-page visual pass, given the disclosed
  browser-tooling limitation this session.

## 7. Risks

Low -- both changes are `hidden`/responsive-visibility class additions
with no layout, data, or behavior change above `sm`. The command-palette
button gains an explicit `aria-label` it previously relied on visible text
for, which is a strict accessibility improvement, not a regression.

## 8. Testing plan

`pnpm --filter web typecheck`/`lint` clean. Visual/device verification is
explicitly **not** performed this session (browser-tooling instability,
disclosed above) -- flagged for a follow-up manual/device check rather
than claimed as verified.

## 9. Rollback plan

Revert the two changed files. No schema/API/behavior change.
