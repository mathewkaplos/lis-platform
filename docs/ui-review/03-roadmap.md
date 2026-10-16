# Phase 3 — Prioritized Roadmap

Builds on `01-audit.md` and `02-design-standard.md` (both approved). Ordered by clinical safety,
then usability impact, then consistency, then effort/regression risk — per the master prompt.
Shared design-system/component work comes before individual-screen work, per the same prompt.

Each unit is scoped to be reviewable in one sitting. None of these require a backend/API change
**except UI-010's attention-band counts, which are explicitly flagged as blocked below** — found
during this revision, not assumed away.

---

## Clinical-safety and workflow-efficiency verification (addendum, this revision)

Requested before approval: confirm whether validate/authorize/sign-out confirmation, amended-result
marking, and critical-value display were actually verified adequate in Phase 1, with evidence —
not assumed. Re-checked directly against the real code (not re-stating the original audit) because
Phase 1's workflow trace focused on *who* can click these actions, not *how* the click itself is
confirmed.

**Verified adequate, with evidence:**
- **Critical-value acknowledgment** — requires a free-text read-back, schema-required
  (`acknowledgeCriticalNotificationSchema`), not a bare button. Confirmed in Phase 1.
- **Critical-value display** — `StatusPill`'s HH/LL treatment (solid red chip + icon + white alert
  dot + letter flag) confirmed compliant with the project's own "never color alone" rule
  (`status-pill.tsx:20-54,81-86`).
- **Case sign-out AND amend** — both require server-enforced step-up re-authentication, not just a
  UI confirmation. Confirmed directly in `apps/web/app/(app)/cases/[caseId]/actions.ts`: the header
  comment at line 97-99 states `amendCase` is "the second real caller (after... wait, actually
  first) of the `step_up=1` redirect," and `signOutCase`'s own comment (line 159-164) confirms the
  same branch, both gated by `@RequireStepUp()` on the API side. `screenCase`, `addBlock`,
  `addSlide`, `addOrderedTest`, `updateNarrative`, `returnToScreening`, and the report-email action
  are each explicitly commented as having **no** `@RequireStepUp()` — a deliberate, documented
  distinction between truly irreversible actions and lesser ones, not an oversight.

**Gaps found — not adequate, adding units (see UI-016/UI-017 below):**
- **Result verify/finalize has no confirmation step.** `results-grid.tsx:256-271,780-791`:
  `handleVerify` fires `onClick` directly — no dialog, no second step, no explicit "you are about
  to verify this result for this patient" moment beyond the row already being visible on screen.
  The code comment at line 176-180 confirms this is deliberate ("keyboard-only, no mouse... matches
  this grid's existing AC for finalize") — i.e., `finalizeResult` has the identical single-action
  shape. This does not meet the master prompt's own §6 standard ("validate, approve, authorize...
  require deliberate confirmation") — it's the one core clinical action in the app that doesn't
  follow the two-step/read-back/step-up pattern everything else here does.
- **Amended results are not explicitly marked as amended.** `cases/[caseId]/page.tsx:370-389` —
  the report-versions list shows version number + a status `Badge` (`final`/`draft`, not
  "amended") + signed-by + an optional free-text `reason` field. There is no "Amended" label or
  visual marker distinguishing an amendment from an original version; a viewer has to notice the
  version count and read the reason text to infer it happened. The master prompt's §6 is explicit:
  "amended results are clearly marked" — this doesn't meet that today.

**Workflow-efficiency / keyboard-entry findings:** click/keystroke counts recorded in Phase 1
(patient registration 1 click + 11 fields/3 required, order registration 1 click, specimen
accession 1 click with no confirmation dialog) showed no significant friction — these are already
reasonably lean. The one real gap is keyboard-entry depth: `results-grid.tsx` and `DataTable` both
support only linear Tab/Enter progression, no arrow-key 2D grid navigation, and the only documented
keyboard shortcut in the entire app (Ctrl/Cmd+K) opens a non-functional stub — "shortcuts for
frequent actions (documented, discoverable)" per prompt §6 isn't met today. Adding UI-018 for
arrow-key grid navigation; folding shortcut-discoverability into UI-011's acceptance criteria
(it belongs in the command palette once that actually works, not as a separate affordance).

---

### UI-001 — Contrast-safe status-text tokens + font-doc correction

**Problem/evidence:** `colorSemantic.warning`/`success` fail WCAG AA as text color (~3.0–3.3:1,
need 4.5:1) — computed from the real token hex values in `01-audit.md` §7. Live on
`results-grid.tsx:666,673,706,713`'s QC-hold status message and ~12 other confirmation strings.
`--text-muted` has the same problem (~3.1:1). Separately, `tokens.ts`/`docs/design.md` document
Inter as the UI font; the app has shipped Geist since `layout.tsx:2,9-17` — the doc no longer
describes reality.

**Proposed improvement:** Add light **and dark** mode text-safe variants (dark mode currently has
no override for `--text-muted` at all — `globals.css`'s dark block redefines
background/surface/border/text-primary/text-secondary but not text-muted, so whatever light value
is set stays in effect against a near-black background; confirmed by computing the existing
light value against `#0b0e14` — current ~2:1, would still fail badly even after the light-mode fix
below):

| Token | Light (current → proposed) | Dark (proposed, new) |
|---|---|---|
| `--text-muted` | `#8a93a2` → `#475569` (~6.5:1 on `#f7f8fa`) | `#94a3b8` (~7.4:1 on `#0b0e14`) — no dark override exists today, this is a new addition, not a change |
| `--warning-text` (new) | `#92400e` (~7:1 on white) | `#fbbf24` (bright amber-400, high contrast on `#131721`) |
| `--success-text` (new) | `#15803d` (matches `stat-card.tsx`'s own existing hex bypass) | `#4ade80` (green-400, high contrast on `#131721`) |

Update `tokens.ts`/`docs/design.md` to say Geist, not Inter. Swap the ~15 light-mode call sites
currently using the base semantic token as text color to the new `-text` variant (file list in
`01-audit.md` §7).

**Screens/components affected:** `packages/ui/src/components/stat-card.tsx` (remove its local hex
bypass, use the new token instead), `results-grid.tsx`, `worklist-view.tsx`, and ~10 confirmation
banners across cases/billing/admin forms.

**User benefit:** every role reading a status/confirmation message, in either theme — legible at
normal reading distance instead of borderline (or, for dark-mode muted text, instead of actually
failing worse than the light-mode version did).

**Responsiveness impact:** none — color-only change.

**Risk:** **Low.** Additive tokens, mechanical find-replace at call sites, no layout change.

**Dependencies:** none — this is the foundation other units build on.

**Acceptance criteria:** every identified call site re-measured at ≥4.5:1 against its actual
background **in both light and dark mode**; no visual regression elsewhere; `docs/design.md`
accurately describes the shipped font.

**Verification:** contrast-checker tool run against each changed pair in both themes; visual diff
screenshot of each affected screen at 1366×768 in both themes; `storybook-a11y` CI job stays green.

---

### UI-002 — Add `Select` and `Textarea` primitives to `packages/ui`

**Problem/evidence:** No such components exist. ~22 files hand-roll the identical raw style
string on bare `<select>`/`<textarea>` elements (full file:line list in `01-audit.md` §3) — not
because anyone chose to bypass the system, but because the system has a real gap.

**Proposed improvement:** Build `Select` and `Textarea` in `packages/ui/src/components/`,
matching `Input`'s existing treatment exactly (`border-input`, `radius-input`, the same
focus-ring classes) so visually nothing changes — this is a consolidation, not a redesign.

**Screens/components affected:** `packages/ui` only, in this unit. Call-site migration is UI-003.

**User benefit:** none directly yet (no visual change) — this unit exists purely to make UI-003
possible without inventing a 23rd copy of the same styling.

**Responsiveness impact:** none.

**Risk:** **Low.** New, additive components; nothing consumes them yet in this unit.

**Dependencies:** should land before or alongside UI-003.

**Acceptance criteria:** `Select`/`Textarea` visually indistinguishable from the current raw
elements at every viewport; keyboard behavior (native select/textarea semantics) preserved;
Storybook story added for each (also closes part of UI-014's gap).

**Verification:** side-by-side screenshot of new component vs. one real existing raw `<select>`;
`storybook-a11y` passes on the new stories.

---

### UI-013 — `packages/ui` component test coverage

**Problem/evidence:** Zero test files exist anywhere under `packages/ui`. The only automated
check is `storybook-a11y`, which catches DOM-visible a11y issues but not logic regressions (e.g.
a broken keyboard handler with no resulting axe violation).

**Proposed improvement:** Add focused unit tests for the highest-risk logic: `FormField`'s
aria-wiring (`cloneElement` injecting `id`/`aria-describedby`/`aria-invalid`/`aria-required`
correctly), `DataTable`'s keyboard row-activation (`Enter`/`Space` on a focused row).

**New dev dependencies this would need (flagging for approval before adding, per constraint §3):**
`packages/ui` currently has no component-level test runner — only `build`/`typecheck`/`storybook`/
`build-storybook`/`test-storybook` scripts exist, no `test`. Rendering/interacting with React
components in Vitest needs `@testing-library/react`, `@testing-library/jest-dom`, and likely
`@testing-library/user-event` (for the keyboard-interaction test specifically), plus a DOM
environment for Vitest (`jsdom` or `happy-dom`) if `packages/ui/vitest.config.ts` doesn't already
have one — **none of these are currently installed; this unit cannot proceed without that
approval**, separate from approval of the unit's content.

**Screens/components affected:** `packages/ui` test files only — no production code change.

**User benefit:** indirect — protects every screen that depends on these two components from a
silent regression during this roadmap's own later units (UI-004/UI-005/UI-015 all touch
`DataTable` directly).

**Responsiveness impact:** none.

**Risk:** **Low**, contingent on the dependency approval above.

**Dependencies:** none structurally; sequenced early (right after UI-001/UI-002) so later
`DataTable` work has a regression net while it's being changed.

**Acceptance criteria:** tests cover the specific aria-wiring and keyboard-handler logic described
above; `pnpm --filter @lis/ui test` (new script needed — none exists today) runs in CI.

**Verification:** tests pass locally and in CI; intentionally break the logic once to confirm the
test actually catches it, then revert.

---

### UI-015 — Playwright visual regression snapshots

**Problem/evidence:** Prompt §10 asks for Playwright visual snapshots "once the shared components
are stable," baselined from Phase 1. **Important gap to flag:** Phase 1 was conducted as a
**static, code-only audit** — Docker/WSL2 was never brought up on this machine (blocked on
disabled BIOS virtualization, see `01-audit.md`'s "What could not be verified"), so **no live
screenshots of the real running app exist from Phase 1** to baseline against. The only real
screenshots that exist are the Phase 2 mockups, which render static HTML standing in for the
design direction, not the actual live app.

**Proposed improvement:** This unit must first **capture a genuine baseline** (role logins,
real app, every screen in `screen-inventory.md`, every viewport in the `lis-ui` skill's §7) — the
live-audit work Phase 1 was explicitly blocked from doing — before `toHaveScreenshot()` baselines
can mean anything. If Docker/virtualization is still unavailable when this unit starts, **stop and
report** rather than baselining against mockups or a partial environment. Once a real baseline
exists, add Playwright `toHaveScreenshot()` checks for the shared components/screens already
touched by UI-001 through UI-013 (the components this roadmap is actively changing — not a
blanket snapshot of all 39 screens on day one).

**Screens/components affected:** new `apps/web/e2e/visual-*.spec.ts` files (or equivalent); no
production code change.

**User benefit:** indirect — catches unintended visual regressions in later units (UI-003 onward)
automatically instead of relying solely on manual before/after screenshot review.

**Responsiveness impact:** none directly; the snapshots themselves should cover the full viewport
set so future regressions are caught per-viewport.

**Risk:** **Low** for the tooling itself; **the real risk is sequencing** — if run before a real
baseline exists, it would silently baseline against something wrong (a mock, or dev-mode-only
rendering) and give false confidence. That's why this is sequenced right after UI-013 and before
UI-003/UI-004: establish the regression net before the first real visual changes land, not after.

**Dependencies:** UI-013 (same "safety net before changes land" reasoning); functionally also
depends on Docker/virtualization being resolved on this machine, or run from an environment where
it is.

**Acceptance criteria:** baseline screenshots exist from a real running app, not a mock; CI job
added/extended to run visual checks; a deliberate, temporary visual change confirms the check
actually fails before being reverted.

**Verification:** manual review of the first baseline set against the real app; one intentional
break-and-revert to prove the check works.

---

### UI-016 — Confirmation step for result verify/finalize (clinical safety — added this revision)

**Problem/evidence:** See addendum above — `handleVerify`/`finalizeResult` in `results-grid.tsx`
fire immediately on click/Enter with no deliberate confirmation step, unlike every other
irreversible clinical action in the app (reception's two-step reject, critical-ack's read-back,
case sign-out/amend's step-up re-auth).

**Proposed improvement:** Needs an owner decision on which safeguard shape fits a high-frequency,
per-analyte action (verify/finalize happens far more often per shift than a case sign-out) — a
full step-up re-auth per row would likely be unusable at the volume this screen handles. Candidate,
lower-friction options to put to the owner rather than silently picking one: (a) a lightweight
inline confirm-on-second-press (same key, e.g. Enter-then-Enter-again within N seconds, with a
visible "press Enter again to verify" micro-state), or (b) a batch-level confirmation only when
multiple rows are about to be committed at once, with single-row entry staying immediate. This
unit's first deliverable should be presenting these options for a decision, not building one
unilaterally — the existing keyboard-only AC for this grid is a real, deliberate design constraint
(per the code's own comment) that any fix must not break.

**Screens/components affected:** `apps/web/app/(app)/orders/[id]/results/results-grid.tsx`.

**User benefit:** technologists/pathologists get the same "what am I committing" clarity on the
single most frequent clinical-authorization action in the app that every other irreversible action
already has.

**Responsiveness impact:** verify any added confirmation UI doesn't break the grid's keyboard-only
flow at any viewport.

**Risk:** **Medium-High.** This is the highest-traffic clinical action in the app — a change here
has to preserve the keyboard-only AC exactly, and over-adding friction (a full dialog per row)
would make routine result entry unworkable. Needs explicit owner sign-off on the chosen approach
before implementation, not just before the roadmap.

**Dependencies:** none technically, but flag to the owner for a design decision before starting.

**Acceptance criteria:** TBD pending the owner's choice of approach above; whichever is chosen must
preserve keyboard-only completion and not meaningfully slow down high-volume result entry.

**Verification:** keyboard-only pass timing a realistic multi-analyte panel entry before/after, to
confirm the added safeguard doesn't make the workflow impractical.

---

### UI-017 — Explicit "Amended" marking on case report versions (clinical safety — added this revision)

**Problem/evidence:** See addendum above — `cases/[caseId]/page.tsx:370-389`'s report-versions
list shows version number, a `final`/`draft` status badge, signed-by, and an optional reason — no
explicit "Amended" indicator.

**Proposed improvement:** Add a distinct `Badge` (e.g. `variant="outline"` with amber/warning
styling, paired with the word "Amended" — never color alone, consistent with the rest of the app's
rule) on any report version where `version.reason` is present and it isn't the first version for
that ordered test, so an amendment is visually obvious without reading the reason text.

**Screens/components affected:** `apps/web/app/(app)/cases/[caseId]/page.tsx`
(report-versions rendering block).

**User benefit:** pathologists and anyone reviewing a case's report history can immediately see
that a version is an amendment, not just a routine version bump — directly meeting the prompt's
own explicit "amended results are clearly marked" requirement.

**Responsiveness impact:** none expected — small addition to an existing list item.

**Risk:** **Low.** Additive UI on an existing, well-understood list; no change to the
amend/sign-out logic itself (already verified adequate above).

**Dependencies:** none.

**Acceptance criteria:** an amended version is visually distinguishable from an original at a
glance, in both themes, without needing to read the reason text.

**Verification:** screenshot a case with ≥2 report versions (one original, one amended) before/after.

---

### UI-018 — Arrow-key navigation in results-entry / `DataTable` (workflow efficiency — added this revision)

**Problem/evidence:** See addendum above — `results-grid.tsx` and `DataTable` both support only
linear Tab/Enter progression; no 2D arrow-key grid navigation exists anywhere, despite prompt §6
explicitly asking for "Enter/arrow navigation in result grids."

**Proposed improvement:** Add Up/Down/Left/Right handling to `results-grid.tsx`'s per-row inputs
(move focus to the adjacent row/column without needing Tab or a mouse) and consider the same for
`DataTable`'s row-activation model if it doesn't conflict with existing sort/select interactions.

**Screens/components affected:** `results-grid.tsx`; `packages/ui/src/components/data-table.tsx`
(evaluate; may be results-grid-only if `DataTable`'s own selection/sort model doesn't fit 2D nav
cleanly).

**User benefit:** technologists entering a multi-analyte panel can move through the grid without
returning to the mouse or relying on Tab's full-page tab order — meaningful for the single most
repetitive data-entry workflow in the app.

**Responsiveness impact:** none (keyboard-only feature; doesn't change layout).

**Risk:** **Medium.** Must not regress the existing, working Enter-to-advance behavior or the
keyboard-only AC this grid already has — add to it carefully, test both old and new paths.

**Dependencies:** none; can run independently of the DataTable-responsiveness units (UI-004/
UI-005) since this is about keyboard behavior, not layout.

**Acceptance criteria:** arrow keys move focus predictably row/column-wise; existing Enter-to-
advance and Tab order both still work unchanged; documented in whatever shortcuts reference UI-011
ends up building.

**Verification:** keyboard-only pass entering a full panel using only arrow keys + Enter; confirm
existing Enter-to-advance e2e behavior (if covered by `clinical-workflow.spec.ts`) still passes.

---

### UI-003 — Migrate raw form controls and raw `<table>`s to shared primitives

**Problem/evidence:** ~22 raw `<select>`/`<textarea>` call sites (file list in `01-audit.md` §3);
3 raw `<table>` usages bypassing `Table`/`DataTable`
(`report-templates/[testDefinitionId]/preview.tsx:87`, `billing/facility-statement/page.tsx:191`,
`billing/invoices/[invoiceId]/invoice-view.tsx:89`); one direct avoidable duplicate
(`orders/page.tsx:126-131` hand-rolls `Input`'s className in a file that already imports other
`@lis/ui` components).

**Proposed improvement:** One-line import swaps — replace each raw element with the shared
component from UI-002 (for selects/textareas) or `Table`/`TableRow`/`TableCell` (for the 3 raw
tables). No markup/behavior redesign, just routing through the shared primitive.

**Screens/components affected:** the ~26 files listed in `01-audit.md` §3 — admin forms, billing
views, case forms, orders filters, results grid, reception form, dashboard filter form.

**User benefit:** consistent focus/hover/dark-mode treatment everywhere; any future styling fix
to `Select`/`Input`/`Table` propagates automatically instead of needing 26 separate edits.

**Responsiveness impact:** none expected (matching the current raw styling exactly), but verify —
`Table`'s border/padding differs slightly from the 3 hand-rolled tables' own treatment.

**Risk:** **Low-Medium.** High file count (mechanical, low per-file risk) but worth batching in a
few PRs rather than one, so a regression is easy to isolate.

**Dependencies:** UI-002.

**Acceptance criteria:** no behavior change on any of the 26 screens, with one known, expected
exception confirmed during UI-002's own verification: below the `md` breakpoint (768px), migrated
selects/textareas render at `text-base` (16px) instead of the raw elements' hardcoded `text-sm`
(14px) — `Select`/`Textarea` mirror `Input`'s own `text-base md:text-sm` pattern, which exists
specifically to keep form fields at ≥16px on narrow/mobile viewports and avoid iOS Safari's
automatic focus-zoom on sub-16px inputs. This is intentional and should NOT be "fixed" to match
the raw elements' old sub-16px size — note it in each affected screen's before/after screenshot
pair as expected, not flag it as a regression; before/after screenshots per screen at 1366×768 and
one narrower viewport (below 768px, to confirm this exact, expected size difference and nothing
else changed); print-specific CSS on the 2 billing tables (`print:` Tailwind variants) re-verified
since those are easy to lose in a swap.

**Verification:** visual diff per file; manual print-preview check on the 2 billing screens;
existing e2e specs (`billing.spec.ts`, `admin-crud.spec.ts`) still pass.

---

### UI-004 — Contain `DataTable` overflow on narrow viewports (sticky key column + in-table scroll + sidebar collapse)

**Problem/evidence:** Confirmed live in Phase 2's own mockup
(`mockups/direction-b-elevate--tablet-768x1024.png`): at 768px, the fixed sidebar + undegraded
table clips the TAT column off-screen. Root-caused further this revision:
`apps/web/app/(app)/_components/sidebar.tsx:149,168` — the full 224px persistent sidebar only
collapses to the mobile hamburger nav **below `sm` (640px)**; between 640px and `lg` (1024px) —
exactly the tablet range this prompt cares about — the full desktop sidebar renders, eating width
that the table then doesn't have. `data-table.tsx`'s own code comment confirms column-priority/
sticky-column/card-view was deliberately deferred.

**Proposed improvement:** Two changes, evaluated together since they address the same symptom from
different ends: (1) `DataTable` gets horizontal scroll contained within the table itself (not the
page), with the first column (Patient/identifying info) sticky; (2) **extend the sidebar's
existing collapse breakpoint from `sm` (640px) to `lg` (1024px)** — i.e. change
`sidebar.tsx:149`'s `sm:flex`/`sm:hidden` pair to `lg:flex`/`lg:hidden`, so tablet widths get the
already-built, already-working mobile hamburger nav instead of the full persistent sidebar. The
second change may turn out to remove most of the problem on its own (more width back for the
table) even before the table itself changes — test both independently to know which is doing the
real work before committing to both permanently.

**Screens/components affected:** `packages/ui/src/components/data-table.tsx` (every consumer
inherits the fix automatically); `apps/web/app/(app)/_components/sidebar.tsx`.

**User benefit:** reception/technologist staff on a tablet stop losing TAT/status visibility —
directly addresses a patient-safety-adjacent visibility gap, not just cosmetics.

**Responsiveness impact:** tablet landscape (1024×768) and portrait (768×1024) primarily; verify
bench desktop (1366×768, 1920×1080) unaffected, and that the now-wider collapse range (640-1024px)
doesn't make the hamburger nav itself feel cramped on a 768px tablet (it was previously only
tested below 640px).

**Risk:** **Medium.** Touches every dense screen in the app via `DataTable`, plus a global nav
change via the sidebar breakpoint — a regression in either is maximally visible.

**Dependencies:** none, but should land before UI-010 (dashboard visual work) so the table/nav it's
styling already behaves correctly at narrow widths.

**Acceptance criteria:** no column clipped at any viewport in the `lis-ui` skill's §7; sticky
column stays visible on horizontal scroll; hamburger nav works correctly across the full
640-1024px range, not just below 640px; keyboard row-activation still works; no change to
desktop-width rendering.

**Verification:** screenshot every `DataTable` consumer screen at 768×1024 and 1024×768, with and
without each of the two changes isolated; keyboard-only pass on the worklist and results grid;
existing e2e specs that touch these screens still pass.

---

### UI-005 — `DataTable` phone card-view / column-priority mode

**Problem/evidence:** Same root gap as UI-004, but at phone width (390×844) even a sticky column
+ in-table scroll is likely too cramped for a usable read — prompt §5 explicitly allows "card view
on phone" as an alternative to column priority.

**Proposed improvement:** A phone-width (`<640px`) card-rendering mode for `DataTable` — one card
per row, showing the same data in a stacked label/value layout instead of columns. Needs a
decision on which 2-3 fields are "always visible" per table (patient+status is an obvious default,
but QC-violations/critical-notifications tables may want different priority fields) — flag this
as a real design decision per consuming screen, not a one-size-fits-all default.

**Screens/components affected:** same as UI-004 — `data-table.tsx` plus a per-screen "priority
fields" config.

**User benefit:** lab managers checking status from a phone (prompt's explicit device class) get a
genuinely usable view instead of a horizontally-scrolled table squeezed into 390px.

**Responsiveness impact:** phone (390×844) specifically.

**Risk:** **Medium-High.** Larger surface than UI-004 (a second rendering mode, not just a
containment fix) and needs a content decision per table, not purely mechanical.

**Dependencies:** UI-004 (build the simpler fix first, confirm it's insufficient at phone width
before committing to the bigger card-view build).

**Acceptance criteria:** card view triggers below the agreed breakpoint; every table's priority
fields reviewed and approved per-screen; touch targets ≥44×44px; no loss of any data (full-row
detail still reachable, just restructured).

**Verification:** screenshot every consumer at 390×844 before/after; touch-target measurement;
keyboard/screen-reader pass on the new card structure (it changes the DOM shape, not just CSS).

---

### UI-006 — Error/loading boundaries on the dashboard and `(app)` route-group root

**Problem/evidence:** The dashboard (`apps/web/app/(app)/page.tsx`) — the first screen every role
sees after login — has no `error.tsx`/`loading.tsx`, and neither does the `(app)` group root
itself. An uncaught error here is a raw Next.js crash screen, not a styled message.

**Which Next.js mode production actually uses (clarified this revision):** confirmed directly from
`apps/web/Dockerfile:26,31-35` and `apps/web/package.json`'s scripts — production runs plain
`next build` (`output: "standalone"`) → `node apps/web/server.js` (the standalone server, Next's
`next start` equivalent), with **no `--webpack` flag anywhere in the build/start path**. That flag
only appears on the `dev` script (`next dev --webpack`), which was added specifically to work
around the documented Suspense-hang bug in dev mode. **The bug has never been independently
re-tested against the actual production path** (`next build` + the standalone server) — it's
reasonable to assume it may behave differently there, but that's unverified, not confirmed safe.

**Proposed improvement:** Add `error.tsx` (styled, matching the inline-message pattern used
elsewhere, e.g. `patients/page.tsx`'s own 403 handling) and `loading.tsx` at the `(app)` group
root. Before shipping the loading boundary, re-verify the Suspense-hang bug against a real
`pnpm --filter web build && node apps/web/.next/standalone/apps/web/server.js` run (production
mode, not `next dev`) — if it still reproduces there, ship the error boundary alone and note the
loading gap as still-blocked-on-framework, same as the routes that already removed theirs; if it
doesn't reproduce in production mode, that's new information worth recording for every other unit
in this roadmap that touches a route with the same removed `loading.tsx`.

**Screens/components affected:** `(app)/error.tsx`, `(app)/loading.tsx` (new files).

**User benefit:** every role, every login — the highest-traffic screen in the app stops being the
one with the weakest failure handling.

**Responsiveness impact:** none.

**Risk:** **Low**, contingent on the production-mode re-verification above.

**Dependencies:** none.

**Acceptance criteria:** a forced error on the dashboard renders the styled boundary, not a crash
page; if `loading.tsx` is added, it's confirmed resolving in a real production-mode build, with
that specific verification method recorded in the PR.

**Verification:** manually trigger an error and confirm the boundary renders; verify any added
loading boundary against the actual `next build` + standalone-server path, not `next dev --webpack`.

---

### UI-007 — Error/loading boundary sweep across remaining ungated pages

**Problem/evidence:** 8 admin pages, `collection-queue`, `critical-notifications`, `qc-violations`,
`reception`, `specimen-processing-qc`, and `specimens/[id]/label` have no error/loading boundary
anywhere in their ancestor chain (full list in `screen-inventory.md`).

**Proposed improvement:** Apply the same pattern validated in UI-006 to each of these routes.
Mechanical once the pattern is proven.

**Screens/components affected:** the ~13 routes listed above.

**User benefit:** consistent failure handling across the whole internal app, not just the
dashboard.

**Responsiveness impact:** none.

**Risk:** **Low.** Same pattern repeated; batch into 2-3 PRs by section (admin / queues-and-QC) to
keep review size manageable.

**Dependencies:** UI-006 (prove the pattern once, first — including its production-mode
loading.tsx verification).

**Acceptance criteria:** every listed route has a styled error boundary; loading boundaries added
only where the production-mode re-check (UI-006) confirms they're safe.

**Verification:** same as UI-006, per route; spot-check 2-3 rather than exhaustively re-testing
all 13 individually if the pattern is identical.

---

### UI-008 — Consistent 403 handling on AP case routes

**Problem/evidence:** `cases/[caseId]/page.tsx:84` and its two nested routes
(`slides/[slideId]/viewer`, `synoptic/[partId]`) throw a raw `Error()` for a 403, caught by the
nearest error boundary — which renders as a generic crash page. Every other gated page in the app
uses an inline, styled "you don't have permission" message instead.

**Proposed improvement:** Replace the thrown `Error()` with the same inline-message return pattern
used elsewhere (e.g. `patients/page.tsx`'s 403 handling).

**Screens/components affected:** the 3 files above.

**User benefit:** pathologists/technologists hitting a permission boundary on a case see a clear,
consistent message instead of what looks like a broken app.

**Responsiveness impact:** none.

**Risk:** **Low.** 3 files, mechanical, matches an existing proven pattern exactly.

**Dependencies:** none.

**Acceptance criteria:** all 3 routes render the same inline-message shape as every other gated
page in the app on a 403.

**Verification:** trigger a 403 on each of the 3 routes (a session without the required role) and
screenshot the result.

---

### UI-009 — Levey-Jennings QC chart: fix color-only severity marker

**Problem/evidence:** `levey-jennings-chart.tsx:213-241` — each point's severity (warning vs.
rejection) is distinguished primarily by color; a static legend below pairs color+text, but the
in-chart points themselves don't. This is the one flagged exception to the app's otherwise
consistent "never color alone" rule (`01-audit.md` §7).

**Proposed improvement:** Add a shape or stroke-pattern distinction per severity (e.g. filled
circle for rejection, outlined/hatched for warning) alongside the existing color, so the chart
itself — not just the legend below it — carries the distinction accessibly.

**Screens/components affected:** `apps/web/app/(app)/control-lots/[id]/chart/levey-jennings-chart.tsx`.

**User benefit:** lab managers/QA reviewing QC charts get an unambiguous severity read directly
from the chart, including for color-blind users — relevant because a QC rejection blocks result
release, so misreading severity has a real downstream effect.

**Responsiveness impact:** verify the chart's SVG scales correctly at tablet width — not
previously checked live.

**Risk:** **Low-Medium.** Isolated to one component, but SVG/chart code can be fiddly to adjust
without a live render to check against.

**Dependencies:** none.

**Acceptance criteria:** severity distinguishable from the chart alone (point shape/pattern), not
just the legend; existing rule-code annotations and legend untouched.

**Verification:** screenshot before/after with both severities present in sample data; check at
1366×768 and 1024×768.

**Status:** done — see UI-009's own Phase 4 report. Found two unplanned bugs while verifying
(both fixed in the same unit): `severityColor()` used `var(--color-*)` names that are never
actually emitted as real CSS custom properties under Tailwind v4's `@theme inline` (every marker
had rendered pure black, in both themes, since this function was written), and one of the three
marker colors fails WCAG's 3:1 non-text contrast minimum against the dark-mode surface. The color
fix for *this* chart landed as part of UI-009; the broader version of both findings — the same
`var(--color-*)` bug in a second component, and a real token fix for the contrast failure — is
scoped separately below as UI-020, not bundled into UI-009's own close-out.

---

### UI-020 — Fix `var(--color-*)` resolution bug + chart marker contrast (found during UI-009)

**Problem/evidence:** UI-009's own verification found that `levey-jennings-chart.tsx`'s
`severityColor()` used `var(--color-brand)`/`var(--color-warning)`/`var(--color-danger)` — names
that are never emitted as real CSS custom properties. Tailwind v4's `@theme inline` block
(`apps/web/app/globals.css`) only uses those `--color-*` names to generate utility classes (e.g.
`.bg-brand`); it never exposes them for arbitrary `var()` use elsewhere. Confirmed directly:
`getComputedStyle(document.documentElement).getPropertyValue('--color-brand')` is empty, while
`--accent` (the raw token, defined directly in `:root`/dark-mode blocks) resolves correctly.
A repo-wide grep for the same pattern found **6 more live instances, all in one file**,
`apps/web/app/(portal)/portal/results/trend-chart.tsx:114,121,123,132,134,135`
(`var(--color-border)`, `var(--color-brand)`, `var(--color-danger)`, `var(--color-warning)`) — used
by **two** real screens: the patient portal's own results page and the clinician's
patient-results page (`apps/web/app/(clinician)/clinician/patients/[patientId]/results/page.tsx`
imports the same `TrendChart`). Every marker on both charts has almost certainly been rendering
black (or invisible) in both themes since these components were written — not a regression, a
long-standing, previously-unverified defect. Separately: UI-009 also measured real non-text
contrast failures — the `accent` marker color (`#4F46E5`, the "in control"/normal state, the most
common one) measures only **2.85:1** against the dark-mode surface (`#131721`), below WCAG's 3:1
non-text minimum; `warning`/`danger` both pass in both themes.

**Proposed improvement:** Two parts:
1. Fix `trend-chart.tsx`'s 6 references the same way UI-009 already fixed
   `levey-jennings-chart.tsx` — swap `var(--color-border)`/`var(--color-brand)`/
   `var(--color-danger)`/`var(--color-warning)` for the raw token names
   (`var(--border)`/`var(--accent)`/`var(--danger)`/`var(--warning)`).
2. Add a new token, `--chart-in-control` (light: keep the current `--accent` value, `#4F46E5`,
   which already passes 6.29:1 there; dark: a lighter indigo chosen to clear 3:1 against
   `--surface`, e.g. in the `#818cf8`/indigo-400 family — exact value to be verified by
   computation before landing, not guessed) and use it specifically for the "in control"/normal
   marker on **both** charts, replacing the plain `--accent` reference there. `warning`/`danger`
   keep their existing values (both already pass in both themes) — this is a narrow, one-state fix,
   not a token-value change across the board.

**Screens/components affected:** `packages/ui/src/tokens.ts`, `apps/web/app/globals.css`,
`levey-jennings-chart.tsx` (swap its "in control" marker to the new token),
`trend-chart.tsx` (fix all 6 broken references, including its own "in control" marker).

**User benefit:** lab managers/QA reviewing either chart in dark mode get a genuinely visible,
WCAG-conformant "in control" marker instead of one that's borderline-invisible against the card
background; patients and clinicians viewing the portal's trend chart get working colors at all,
in either theme, for the first time.

**Responsiveness impact:** none — token/color-value change only.

**Risk:** **Low.** Same proven pattern as UI-009's own fix, applied to one more file; the new
token is additive, doesn't change any already-passing color.

**Dependencies:** none technically, but directly follows from UI-009's own findings — do not
start without re-reading UI-009's Phase 4 report for the exact verification method used there.

**Acceptance criteria:** all three marker colors (`--chart-in-control`, `warning`, `danger`)
measure ≥3:1 against `--surface` in **both** themes, computed and verified, not assumed; severity
still distinguishable from each chart alone via shape (grayscale-verified, same method UI-009
used — a `grayscale(100%)` CSS filter applied before the screenshot, not just eyeballing a normal
screenshot); before/after screenshots of **both** charts (Levey-Jennings and trend chart), in
both themes.

**Verification:** `getComputedStyle` resolution check on all `var()` references touched (the exact
method that caught UI-009's original bug — don't just trust that a CSS variable name "looks
right"); contrast computation for the new `--chart-in-control` dark value before choosing it, not
after; grayscale screenshot of both charts; `storybook-a11y` stays green (levey-jennings already
has a story; trend-chart does not yet — adding one may be a reasonable, small, in-scope addition
to actually verify this fix the same way UI-009 did, rather than relying on live-app verification
that's still blocked).

---

### UI-010 — Dashboard "attention band" + STAT emphasis (Direction B rollout) — **PARTIALLY BLOCKED, backend dependency found this revision**

**Problem/evidence:** No at-a-glance urgency summary exists today — STAT/critical/overdue items
are only visible by scanning table rows one at a time (`01-audit.md` §6, `02-design-standard.md`
§2).

**Stop-and-report finding (per constraint, checked this revision rather than assumed):** the 3
attention-band counts mocked in Phase 2 (STAT-pending, critical-unacknowledged, TAT-at-risk) are
**not all safely derivable from existing endpoints as real totals**. Checked directly against the
API source (read-only):
- `apps/api/src/worklist/worklist.controller.ts:107-109,294` — the worklist response's `counts`
  object (pending/inProgress/verified) **is** a real, separate aggregate query
  (`loadCounts(tx)`), safe to use as a total. But it only breaks down by **stage**, not by
  priority or SLA status — there is no `counts.stat` or `counts.atRisk` field. The `items` array
  in the same response is explicitly `.limit(WORKLIST_RESULT_LIMIT)`-capped
  (`worklist.controller.ts:294`), so counting STAT/at-risk items from `items` client-side would
  **silently undercount** once a tenant has more pending work than that limit — exactly the
  "partial counts shown as totals" failure mode flagged as unacceptable.
- `apps/api/src/critical-notification/critical-notification.controller.ts:142` — a plain
  `@Get()` list endpoint, no accompanying count/total field found.

**This needs a decision, not a silent frontend workaround:**
1. **Request a backend change** (new aggregate fields on `/v1/worklist`'s `counts` object and/or
   on the critical-notifications endpoint) — the correct long-term fix, but out of scope for this
   frontend-only initiative per its own constraints; would need its own Implementation Proposal.
2. **Ship a reduced version of this unit now**: keep the already-safe stage-based StatCards and
   the STAT-row visual accent on whatever page of results is currently loaded (clearly not claimed
   as a total), but drop the 3 numeric attention-band counts until the backend support exists.
3. **Defer UI-010 entirely** until a backend proposal for the count fields is approved elsewhere.

Recommend **option 2** — it keeps the real, already-proven-valuable part of Direction B (visual
STAT emphasis) without the integrity problem, and leaves the numeric counts as a clearly-scoped
follow-up once backend support exists. Needs owner confirmation before implementation starts.

**Screens/components affected:** `apps/web/app/(app)/page.tsx`, `worklist-view.tsx`,
`packages/ui/src/components/stat-card.tsx`.

**User benefit:** (for the reduced scope) every role landing on the dashboard sees which rows are
STAT at a glance; the full "2-second urgency summary" from prompt §6 is only fully met once the
backend aggregate exists.

**Responsiveness impact:** attention/accent elements need their own tablet/phone layout — not
addressed by the desktop-width mockup alone.

**Risk:** **Medium**, and contingent entirely on the owner's choice above.

**Dependencies:** UI-001 (contrast-safe tokens), UI-004 (table should already handle narrow widths
first). **New:** a decision on the backend-aggregate question before implementation.

**Acceptance criteria:** whatever counts/indicators ship are provably accurate against the full
dataset, never a paginated subset; no visual indicator implies a total that isn't actually one; new
visual elements still pair color with text.

**Verification:** if real counts ship, verify against a known seeded dataset larger than
`WORKLIST_RESULT_LIMIT` specifically, to prove the undercount failure mode doesn't occur; screenshot
at all 5 viewports.

---

### UI-011 — Command palette: federated search across patients/orders/cases (frontend-only)

**Problem/evidence:** The Ctrl/Cmd+K command palette is a labeled "Coming soon" stub — no search
logic exists (`command-palette.tsx:13-15,50-64`). Prompt §6 explicitly asks for global search.

**Proposed improvement:** **Frontend-only** federated search — on query, call the 3 existing,
already-authenticated read endpoints these screens already use
(`GET /v1/patients?q=`, `GET /v1/orders?q=`, `GET /v1/cases?q=`) in parallel, merge and
label results by type, and render them in the palette. No new backend endpoint needed.

**Behavior when an endpoint 403s (defined this revision):** a 403 from any one of the 3 parallel
calls means that session's role can't see that entity type at all — a normal, expected outcome for
some roles, not a failure. Treat it as "this category returned zero results" and omit it silently
from the merged list; only show a real error state if **all three** calls fail, or if a non-403
error occurs on any one (that's a genuine failure worth surfacing). Don't block the other two
categories' results waiting on a third that was never going to succeed for this role.

**Documented/discoverable shortcuts (folded in from the workflow-efficiency addendum above):**
once this palette is functional, it's the natural home for a visible shortcuts reference (e.g. a
"?" row inside the palette itself listing available shortcuts) — currently Ctrl/Cmd+K is the only
shortcut in the entire app and nothing documents it inside the product itself.

**Screens/components affected:** `apps/web/app/(app)/_components/command-palette.tsx`.

**User benefit:** every internal role gets the cross-entity search the prompt asked for, without
needing to know which screen to search from first; roles with partial access get a clean,
role-appropriate result set rather than an error.

**Responsiveness impact:** verify the palette's own overlay behaves at tablet/phone widths (not
previously checked).

**Risk:** **Medium-High.** The biggest net-new logic in this roadmap — budget real review time,
and confirm with the owner that reusing these 3 endpoints (rather than requesting a real unified
backend endpoint later) is acceptable before building.

**Dependencies:** none technically, but flag to the owner before starting.

**Acceptance criteria:** Ctrl/Cmd+K opens, typing returns matching patients/orders/cases within a
reasonable debounce window, results clearly labeled by type and link to the right screen, a 403 on
one category degrades gracefully (not a visible error), loading/empty/all-failed states handled,
keyboard-navigable (arrow keys + Enter), Escape closes, a shortcuts reference is discoverable from
inside the palette.

**Verification:** manual test against seeded data covering all 3 entity types, plus a role known to
lack access to one category (confirm graceful degradation); keyboard-only pass; screenshot at all
viewports; confirm no behavior change to the 3 existing per-screen search boxes.

---

### UI-012 — Theme toggle reachable from `(clinician)` and `(portal)`

**Problem/evidence:** `ThemeToggle` only renders inside `(app)/_components/top-bar.tsx`. Clinician
and patient-portal users can never manually switch theme — only the OS default ever applies.

**Proposed improvement:** Add the same toggle (and a minimal top bar if one doesn't already exist)
to `(clinician)/layout.tsx` and `(portal)/layout.tsx`.

**Screens/components affected:** `(clinician)/layout.tsx`, `(portal)/layout.tsx`.

**User benefit:** external clinician/patient users get the same theme control internal staff
already have.

**Responsiveness impact:** verify the added toggle doesn't crowd an already-tight portal/clinician
header at phone width.

**Risk:** **Low.** Reuses an existing, already-working mechanism; just extending its reach.

**Dependencies:** none.

**Acceptance criteria:** toggle present and functional on all `(clinician)`/`(portal)` pages; no
layout crowding at 390×844.

**Verification:** screenshot each portal's pages before/after at desktop and phone width.

---

### UI-014 — Storybook/axe coverage for Badge, Card, DropdownMenu, Popover

**Problem/evidence:** 4 of 17 components get zero Storybook/axe coverage, direct or transitive —
`storybook-a11y`'s own comment ("6 design-system primitives") is already stale against the real
7-story/17-component count. `DropdownMenu` backs every dropdown in the app's top bar.

**Proposed improvement:** Add a `.stories.tsx` file for each of the 4, matching the existing
story pattern closely enough that `storybook-a11y`'s existing `checkA11y` pass picks them up
automatically — no CI config change needed.

**Screens/components affected:** `packages/ui/src/components/{badge,card,dropdown-menu,popover}.stories.tsx`
(new files).

**User benefit:** indirect — closes a real gap in the one automated a11y gate this project has.

**Responsiveness impact:** none.

**Risk:** **Low.** Additive, no production code change.

**Dependencies:** none.

**Acceptance criteria:** all 4 components have stories; `storybook-a11y` CI job picks them up and
passes; update the job's stale "6 primitives" comment to reflect the real count.

**Verification:** run `pnpm --filter @lis/ui test-storybook` locally before pushing; confirm CI
job's story count in its own log output increases by 4.

---

## Suggested sequencing (not a hard dependency chain beyond what's noted per-unit)

1. **UI-001, UI-002** (foundation — tokens incl. dark mode, missing primitives)
2. **UI-013** (test safety net — pending new-devDependency approval)
3. **UI-015** (visual-regression safety net — pending a real baseline; stop-and-report if Docker/
   virtualization still isn't available when this starts)
4. **UI-016, UI-017** (clinical-safety gaps found this revision — verify/finalize confirmation,
   amended-result marking). **Flagged for owner attention: these were found during this revision,
   not part of the original roadmap approval, and arguably belong before UI-001 by the roadmap's
   own clinical-safety-first ordering principle. The explicit instruction accompanying this
   revision's approval was to begin implementation with UI-001 specifically — proceeding that way
   below, but naming the tension here rather than silently resolving it.**
5. UI-004 (the proven live bug, now including the sidebar-breakpoint fix)
6. UI-003, UI-008, UI-014, UI-018 (consistency/efficiency sweep, parallelizable)
7. UI-006, UI-007 (error/loading boundaries, incl. production-mode re-verification)
8. UI-009, UI-012 (small, isolated fixes)
9. UI-010 (reduced scope per the finding above, pending owner confirmation of which option)
10. UI-005, UI-011 (the two largest/highest-risk units — last, each needs explicit owner go/no-go)

---

## Pending live verification

Work completed against Storybook/static builds only, still owed a real check once Docker/
virtualization is available on this machine (same blocker documented throughout Phase 1):

- **UI-001's 13 `apps/web` page-level call sites** (results grid, case forms, billing/admin
  confirmation banners — the full list is in UI-001's own unit above) — verified correct at the
  CSS-variable/token level and via Storybook for the 3 design-system components with stories
  (`StatusPill`, `SusceptibilityBadge`, `StatCard`), but never seen rendered live in the real app.
  Needs a real before/after screenshot pass, **both themes**, once the app runs.
- **UI-014's Tab/Shift+Tab focus trace, repeated against the real top-bar user menu**
  (`apps/web/app/(app)/_components/top-bar.tsx`) — the Playwright activeElement trace that
  justified disabling `aria-hidden-focus` on `dropdown-menu.stories.tsx`'s `Open` story was run
  against that isolated story, not the real app. Same Radix defaults, same expected result, but
  unconfirmed outside Storybook's iframe context — re-run the identical trace against the live
  top-bar menu before treating this as fully closed, not just scoped-and-documented.
- **Units that cannot start at all until this is resolved**: UI-015 (visual regression needs a
  real baseline, not a mock — stop-and-report if still blocked when it's reached), UI-003
  (26-screen migration needs real before/after screenshots, not just component-level ones), UI-004
  (DataTable/sidebar fix needs live viewport testing to confirm the clipping bug is actually
  resolved, not just that the code changed).

---

## Non-UI follow-ups (found during UI work, out of this roadmap's own scope)

Issues discovered while verifying a UI unit that aren't themselves UI/UX problems — reported for
tracking, not proposed as roadmap units here.

- **`apps/web/lib/format-currency.ts`'s `formatMoneyCents` passes no explicit locale to
  `Intl.NumberFormat`** (`new Intl.NumberFormat(undefined, { style: 'currency', currency: code })`
  — the first, locale, argument is `undefined`). This is very likely why `pnpm test` failed 15
  tests in `format-currency.spec.ts` during the UI-001/002/013/014 merge verification on this
  machine: `Intl.NumberFormat` falls back to the JS runtime's own default locale when none is
  given, and that default (and the ICU currency-symbol data behind it) can legitimately differ
  between environments — confirmed failures were e.g. `"US$10.50"` vs. the test's expected
  `"$10.50"`, `"KES 1,500.00"` vs. expected `"KSh 1,500.00"`, consistent with a locale/ICU-data
  mismatch between this Windows machine's Node build and whatever environment (presumably Linux
  CI) the test's expected strings were originally written against — not a logic bug in the
  function itself. Passing an explicit locale (e.g. `'en-US'`, or a real configurable one if this
  app ever needs to support more than one) would make the output deterministic across
  environments instead of depending on the runtime's own default. Not fixed here — report only,
  per instruction; this is a backend/shared-lib correctness question, not a UI/UX one.

---

**Approved**, with the amendments above incorporated. Beginning Phase 4 with **UI-001** on branch
`ui/UI-001-status-text-tokens`, per explicit instruction — see the sequencing note on UI-016/017
above for the one open tension worth a decision when convenient, not a blocker to starting now.
