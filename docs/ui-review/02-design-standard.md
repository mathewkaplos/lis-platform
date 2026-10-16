# Phase 2 — Target Standard & Design Foundations

**Date:** 2026-10-16. Builds on `01-audit.md` (approved). Mockups in `docs/ui-review/mockups/`.

---

## 1. Gap analysis vs. §5 (devices) and §6 (UX standard)

| §5/§6 requirement | Current state | Gap |
|---|---|---|
| No horizontal page scroll at 1366×768 | Not independently re-verified live this session (Docker still blocked) | Needs a live pass; nothing in the audit suggests a problem at this width specifically |
| Wide tables degrade deliberately (column priority / sticky key columns / horizontal scroll inside the table / card view on phone) | `DataTable`'s own code comment says this scope was deliberately deferred — no mechanism exists | **Confirmed live in this phase's own mockup**: rendering the real sidebar+table structure at 768px tablet width clips the TAT column off-screen (`mockups/direction-b-elevate--tablet-768x1024.png`). Every dense worklist in the app (orders, patients, cases, results-entry, QC violations, critical notifications) shares this one component, so it fails identically everywhere it's used. |
| Touch targets ≥44×44px on tablet/phone | Button component's smallest size (`icon-xs`) was not measured against 44px in the audit | Needs a live measurement pass; flagging as unverified, not assumed-fine |
| Critical info (IDs, STAT, status) visible at every breakpoint | STAT/status render as text+color badges inline in table cells | At tablet width, STAT badges are still visible (confirmed in the screenshot above) but the far-right TAT column — which carries the overdue/at-risk urgency signal — is exactly what gets clipped. The information that most needs to survive narrow viewports is currently the least protected. |
| 200% zoom at 1366×768 | Not testable without a live app | Outstanding |
| Keyboard-first entry, visible focus, documented shortcuts | Audit confirmed real but partial: `DataTable` row activation (Tab + Enter/Space) and results-grid Enter-to-advance both work; no 2D arrow-key grid navigation anywhere; only one documented shortcut exists (Ctrl/Cmd+K), and it opens a stub | Shortcuts aren't discoverable (no shortcuts reference anywhere in the UI); the one shortcut that exists does nothing yet |
| Global search for patient/specimen/accession | None — Cmd/Ctrl+K opens a labeled "Coming soon" stub | Full gap, not partial |
| Consistent color-blind-safe status/priority (color+icon+text) | Compliant almost everywhere per the audit's `StatusPill`/`Badge`/`SlaIndicator` review; one flagged exception (Levey-Jennings per-point chart markers) | Narrow, already-scoped gap |
| System feedback: loading/empty/error states on every major screen | Audit found the dashboard (highest-traffic screen) and 8 of the 18 `(app)` pages have **no** loading/error boundary at all; several others deliberately removed `loading.tsx` for a documented framework bug | Real, broad gap — see `01-audit.md` §6 |
| One typography/spacing/icon scale, one component behavior set | Mostly true (`lucide-react` only, consistent type scale) with 2 concrete exceptions: no `Select`/`Textarea` primitive (≈22 copies of raw styling) and 3 raw `<table>` usages | Narrow, already-scoped gap |
| WCAG 2.2 AA minimum | 3 real token-level contrast failures affecting live clinical/status text (`warning`, `success`, `textMuted`); CI a11y gate covers 7 of 17 components | Real, token-level gap — fixable in one place (§3 below) |

**Net read:** this is not a system with no foundation — FEAT-010 already gave it a real token set, a working dark-mode mechanism, consistent icon usage, and (mostly) compliant status coloring. The gaps cluster in exactly three places: **(1) responsive table/shell behavior** (completely unaddressed, not partially), **(2) a handful of token values that fail contrast at actual text sizes**, and **(3) missing error/loading coverage on high-traffic screens**. This argues directly against a rewrite and for a **targeted, prioritized extension** — consistent with the roadmap ordering this phase proposes in §4 below and will be detailed in Phase 3.

## 2. Design direction

Two directions, both built on the **existing** token set and component structure (no rewrite) — they differ only in how much visual emphasis is added on top, not in the underlying system. Both independently fix the §1/§7 contrast failures, since that's a correctness fix, not a style choice.

Mockups render the real dashboard/worklist screen (`apps/web/app/(app)/page.tsx` + `worklist-view.tsx` + `sidebar.tsx` + `top-bar.tsx`, faithfully reproduced from the actual code and CSS tokens) at 1366×768 and 768×1024 tablet.

### Direction A — Refine
`mockups/direction-a-refine--1366x768.png`, `mockups/direction-a-refine--tablet-768x1024.png`

Keeps the current visual language almost exactly as-is: same ring-based active-state indicator on StatCards, same table header treatment, same sidebar. Only changes: the 3 contrast-safe token values (§3), minor alignment/spacing tidy-ups. Lowest risk, fastest to ship, least visually distinctive.

### Direction B — Elevate (recommended)
`mockups/direction-b-elevate--1366x768.png`, `mockups/direction-b-elevate--tablet-768x1024.png`

Same structure and tokens, with slightly more deliberate visual hierarchy:
- An **attention band** above the stat cards — STAT-pending / critical-unacknowledged / TAT-at-risk counts as color+text chips. Directly addresses prompt §6's "the most important item on each screen is obvious within 2 seconds" against a real gap: today, STAT/critical/overdue items are only visible by scanning table rows one at a time.
- A left-border accent (not just a focus ring) on the active StatCard, and the same accent as an inset bar on STAT table rows — reinforces the existing text+color badge, doesn't replace it (still never color-alone).
- Slightly heavier header type weight and a tinted table header background for stronger section separation.

**Recommendation: Direction B.** It costs almost nothing extra to build (same components, same tokens, a handful of new utility classes) and it directly answers one of the audit's own UX findings (STAT/critical visibility requires per-row scanning today) rather than being decoration. Direction A is the fallback if the owner wants to minimize visual change for this pass.

**Both directions share the same unresolved problem**, visible in both tablet screenshots: the fixed-width sidebar + undegraded table combination clips content at 768px regardless of which direction is chosen. That's a structural/component fix (§4), not a visual-direction choice — fixing it benefits both directions equally and should be prioritized independently of which direction is picked.

## 3. Proposed token changes

All additive or value-only changes to `packages/ui/src/tokens.ts` / `apps/web/app/globals.css` — no restructuring, no new token categories beyond what's listed.

| Token | Current | Proposed | Why |
|---|---|---|---|
| `--text-muted` (as text color) | `#8a93a2` (~3.1:1 on white) | `#475569` (~6.5:1, Tailwind slate-600 family) | Fails AA today at every use as real body copy (command palette, chart labels, portal results page). Keep `#8a93a2` available separately for genuinely decorative/disabled contexts if needed — don't delete it, just stop using it for readable text. |
| `warning` used as text | `#d97706` (~3.0–3.2:1) | New `--warning-text: #92400e` (~7:1), keep `--warning` (`#d97706`) for borders/chip backgrounds/icons where the 3:1 non-text bar already passes | `stat-card.tsx` already independently invented this exact pattern (a darker on-text variant) for `success` — generalizing it is cheaper than it looks, and fixes the clinically-relevant "held on a QC violation" status text in the results grid. |
| `success` used as text | `#16a34a` (~3.1–3.3:1) | New `--success-text: #15803d` (matches `stat-card.tsx`'s own already-chosen value — reuse it as a real token instead of a one-off local hex) | Same reasoning; also removes the one documented hex-bypass found in the audit by giving it a proper token home. |
| Font family doc | `tokens.ts`/`docs/design.md` say Inter; app renders Geist | Update `tokens.ts`/`docs/design.md` to say **Geist** (keep the font that's actually shipping — it's already loaded, tested, and no visual complaint was raised about it) | Cheaper and lower-risk than swapping the live font; the problem is the doc lying about reality, not the font choice itself. |
| New: `Select`/`Textarea` primitives | Don't exist | Add to `packages/ui`, reusing `Input`'s existing className (`radius-input`, `border-input`, focus-ring treatment) exactly as-is | Closes the ≈22-copy duplication found in the audit with a one-line import swap per file, no visual change to any of those 22 screens. |
| Breakpoints | Tailwind v4 defaults, never reviewed | Keep the defaults, but **make `lg` (1024px) the explicit minimum design target for dense worklist/results screens** (bench desktop 1366px clears it; reception tablets at 1024px landscape sit exactly on the line) | No value needs to change — Tailwind's defaults already roughly fit this project's device classes (§5). What's missing is a stated decision, not a different number. |

No change proposed to: color accent/brand, radius scale, spacing scale, elevation values, dark-mode mechanism, icon library — all audited as already consistent and functioning.

## 4. Structural fix flagged by this phase, not styling

The sidebar-clips-table problem visible in both tablet screenshots isn't a token or visual-direction issue — it needs either (a) a collapsible/narrower sidebar below `lg`, or (b) `DataTable` gaining real column-priority/horizontal-scroll-within-table behavior (prompt §5's own suggested fix), or both. This is exactly the kind of shared-component work the roadmap (Phase 3) should sequence first, since every dense screen in the app inherits whichever fix is chosen. Not resolved here — flagged for Phase 3 prioritization with live evidence attached.

## 5. `lis-ui` project skill

Created via `/skill-creator` at `.claude/skills/lis-ui/SKILL.md` — see that file for the full, encoded ruleset (tokens, component conventions, status/priority patterns, confirmation patterns, responsive rules, protected paths, and the before/after-screenshot requirement for every UI change).

---

**STOP.** Per the master prompt, waiting for review of this design standard before Phase 3 (prioritized roadmap).
