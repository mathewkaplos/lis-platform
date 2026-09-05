# Implementation Proposal: App-shell route navigation progress indicator
Status: APPROVED
ADR: n/a    Date: 2026-09-05    Backlog ID: issue #805

## 1. Goal

Deleting `loading.tsx` from `/patients` and `/orders` (docs/pilot/PILOT-USER-GUIDE.md §7/§8) correctly
fixed a real Suspense-boundary hang under `next dev --webpack`, but left every route navigation with
zero visual feedback while the next page renders (confirmed live, 3-4s of a frozen-looking Dashboard
before `/patients` appears — `docs/ux-responsiveness-audit-2026-09-05.md` §3.2). Add a single,
app-shell-level top-of-page progress bar that reacts to any internal link click and clears once the
new route commits — without using a per-route Suspense boundary, so it structurally cannot reproduce
the original hang.

## 2. Affected files

- `apps/web/app/(app)/_components/route-progress-bar.tsx` — new client component, the only piece of
  actual logic.
- `apps/web/app/(app)/layout.tsx` — one-line addition, rendering `<RouteProgressBar />` once in the
  shared app shell (same file every page already renders through, per `TopBar`/`Sidebar`'s own
  precedent).
- No API, schema, or per-route file changes. No `loading.tsx` is added anywhere.

## 3. Architecture consulted

- `docs/pilot/PILOT-USER-GUIDE.md` §7/§8/§9 — the exact prior root-cause writeup for why a per-route
  `loading.tsx` Suspense boundary hangs under this repo's current `next dev --webpack` setup. This
  proposal's whole design constraint is "never re-introduce that mechanism," confirmed by construction:
  the new component uses no `<Suspense>`, no route-level file convention Next.js treats specially — it
  is a plain client component mounted once in the existing shared layout.
  - Note found while re-reading this section: `/patients/[id]/page.tsx`'s own header comment (per
    §7/§8's cross-references) says a `loading.tsx` was also removed from `/patients/[id]` for the
    identical reason — this proposal doesn't touch that route directly, but the new shell-level
    indicator covers it for free (it isn't route-specific).
- `apps/web/app/(app)/layout.tsx` (current) — confirms the shared shell structure this component slots
  into, and that `Sidebar`'s own nav links are plain `next/link` `<Link>` elements (verified: `import
  Link from 'next/link'`), so a `document`-level click listener on `<a>` elements reaches every
  existing nav link with no changes to `sidebar.tsx`/`top-bar.tsx` themselves.

## 4. Skills loaded

- `engineering/frontend-design` (required — new `apps/web` component + a layout edit). No entry applies
  directly: no new route/dynamic segment (entries #9/#10), no client-only library with import-time
  `document` access (entry #11 — this component only touches `document` inside `useEffect`, which is
  exactly that entry's own safe pattern), no `useActionState` form (entry #8), no thrown Server
  Component error (entry #12 — this component never throws, it's a plain client-side visual). Confirmed
  no regression risk to any existing entry.
- `engineering/api-design` — not loaded; no `apps/api` change.

## 5. Assumptions & autonomous decisions

- **Detection mechanism: a capture-phase `click` listener on `document` for internal `<a>` elements,
  paired with a `usePathname()`/`useSearchParams()`-keyed `useEffect` to detect the route actually
  committing.** This is the standard technique existing "top loader" libraries use (no new dependency
  needed — building it directly keeps this to one small file, consistent with this repo's "smallest
  working version" discipline over adding a package for ~40 lines of logic).
- **Auto-hide safety net (8s timeout) if no route change commits after a click** — covers a link that
  triggers something other than a full navigation (e.g. a same-page anchor, a client action that
  doesn't change the URL) or a route that errors before committing, so the bar can never get stuck
  visible forever. 8s chosen as comfortably longer than the slowest observed real navigation this audit
  measured (3-4s, dev-mode on-demand compile) with headroom.
- **Excludes:** modifier-key clicks (cmd/ctrl/shift/alt — the browser opens a new tab, no navigation
  feedback needed in the current one), `target="_blank"` links, external (`http`) hrefs, and same-page
  anchors (`#...`) — these are the same exclusions every existing top-loader implementation of this
  pattern uses, and none of them represent an in-page navigation this indicator is meant to cover.
- **Visual treatment: a plain `animate-pulse` bar** (existing Tailwind utility, no new keyframes/CSS)
  rather than a sliding/indeterminate animation — smallest version that visibly signals "something is
  happening," matching this repo's existing spinner/skeleton conventions elsewhere rather than
  introducing a new animation style.
- **Not wired to Server Action submissions** (e.g. "Save & register," "Sign out this case") — those
  already have their own per-form pending state via `useActionState`'s `pending` flag (confirmed:
  `sign-out-case-form.tsx`, `protocol-form.tsx`, and others already disable/relabel their own submit
  button while pending). This proposal is scoped to plain link-driven page navigation only, matching
  issue #805's own reproduction (a sidebar nav click), not a general "add loading state everywhere"
  effort.

## 6. Risks

- A false-positive "show" on a link click that turns out not to navigate (e.g. blocked by an
  in-page confirm, or a link whose destination 404s) is covered by the 8s auto-hide — worst case is a
  brief, harmless bar flash rather than a stuck indicator.
- Extremely low risk overall: purely additive, presentation-only, no interaction with data fetching,
  auth, or any existing route's own rendering logic.

## 7. Acceptance criteria

- Clicking any sidebar nav link (or any other internal `<Link>`) shows a thin progress bar at the top
  of the viewport immediately on click.
- The bar disappears once the new route's content has actually rendered (pathname/searchParams change
  committed).
- No `loading.tsx` file is added anywhere — the fix must not reintroduce the mechanism §7/§8 removed.
- A same-page anchor click, an external link click, or a modifier-key click does not trigger the bar.

## 8. Testing plan

- `pnpm --filter web typecheck` and `pnpm --filter web lint`.
- Manual `web-verify` pass: click through Dashboard -> Patients -> Orders -> Cases and confirm the bar
  appears on each click and clears once the destination renders; confirm a same-page anchor/external
  link does not trigger it.
- Explicitly re-verify the original bug does NOT reproduce: hard-refresh `/patients` and `/orders`
  directly (not via click) several times in a row, confirm no hang (this component doesn't touch those
  routes' own render path at all, but this is the regression this whole proposal exists to never
  reintroduce, so it's worth a direct re-check).

## 9. Rollback plan

Two-file, additive change (one new component, one `<RouteProgressBar />` line in the shared layout) —
revert the one commit if anything regresses. No migration, no API change, no data change.

## 10. Questions requiring human approval

**Approved 2026-09-05** — scoped exactly as proposed: hand-rolled component, no new dependency, plain
`animate-pulse` visual treatment.
