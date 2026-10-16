---
name: lis-ui
description: Clinical UI rules for this Laboratory Information System's frontend (apps/web, packages/ui) — design tokens, component conventions, status/priority color patterns, confirmation patterns for destructive clinical actions, responsive rules, and protected paths. Load this before writing or reviewing ANY apps/web or packages/ui change — new screens, component edits, styling, forms, tables, dialogs, or anything touching colors/spacing/typography. Overrides generic style/accessibility skills (web-design-guidelines, the WCAG accessibility skill) wherever they conflict with the clinical-specific rules below, since those skills know nothing about this app's safety requirements. Also load this when deciding whether a UI change needs a Select/Textarea primitive, when touching DataTable, or when writing a reject/acknowledge/sign-out/finalize confirmation flow.
---

# LIS UI rules

This project already has a real design-token system (FEAT-010) and a working component
library (`packages/ui`) — the job is extending and fixing it, not replacing it. Everything
below reflects actual, verified findings from `docs/ui-review/01-audit.md` and
`docs/ui-review/02-design-standard.md` (2026-10-16) — read those for the full reasoning behind
any rule here that seems surprising.

## 1. Where tokens live, and why they drift

Three places have to agree, by hand — there's no generator yet:
`packages/ui/src/tokens.ts` (source of truth) → `apps/web/app/globals.css` (the CSS variable
bridge Tailwind actually reads) → `docs/design.md` (the human-readable spec). If you change a
token value, change it in all three or the doc silently stops describing reality — this already
happened once (the doc says the UI font is Inter; the app has shipped Geist for a while).

Categories: color (light/dark + a fixed brand accent + semantic success/warning/danger/info/ai),
a 7-step type scale (12/13/14/16/20/24/30px; body 14px, table cells 13px), a 5-step spacing scale
(4px base, 8/12/16/24/32), radius (6px inputs/chips, 8px cards/buttons, 12px modals, full pill),
and exactly two elevation values (a 1px-border card shadow, a slightly deeper overlay shadow).
**No heavy drop shadows, no gradients, ever** — the whole point of this system is calm and
scannable over a 12-hour shift, not visual flourish.

## 2. Contrast — don't use a semantic token as text color without checking first

`colorSemantic.warning` (`#d97706`) and `colorSemantic.success` (`#16a34a`) look fine as borders,
chip backgrounds, or icon fills (they clear the 3:1 non-text bar) but **fail WCAG AA as actual
text color** — real contrast ratios of ~3.0–3.3:1 against both white and the app background,
confirmed by direct computation against the token hex values. This isn't theoretical: it's
currently live on the results grid's "Saved — held on a QC violation" message and a dozen other
confirmation strings across the app.

When a semantic color needs to be **read**, not just glanced at: use `--warning-text` (`#92400e`)
or `--success-text` (`#15803d`) instead of the base token. `--text-muted` (`#8a93a2`, ~3.1:1) has
the same problem for body copy — use `#475569` there. (`stat-card.tsx` already independently
invented the `success`→darker-green fix for itself; the point of naming these as real tokens is so
nobody has to rediscover that fix a third time.)

## 3. Component conventions

All 17 components live in `packages/ui/src/components/` — shadcn/ui "new-york" style on Radix
primitives, `lucide-react` icons only (never add a second icon library; it'll show up in a grep
and look like an accident). Import `Table`/`DataTable`, `Input`, `Button`, `Card`, `Badge`, etc.
from `@lis/ui` — don't hand-roll a raw `<table>`, don't copy `Input`'s className string onto a
bare `<input>`, don't build a custom modal. `Sheet`/`SlideOver`/`Popover`/`DropdownMenu` already
cover every overlay need and carry real Radix accessibility (focus trap, `role="dialog"`,
focus-return-on-close) for free — a hand-rolled modal would have to reimplement all of that from
scratch to be safe.

**No `Select` or `Textarea` primitive exists yet.** If a screen needs one, build it once in
`packages/ui`, reusing `Input`'s existing treatment (`border-input`, `radius-input`, the
focus-ring classes) — don't add a 23rd copy of the same raw style string. Check
`packages/ui/src/components/input.tsx` first; the new component should look like a sibling of it,
not a reinvention.

## 4. DataTable has no responsive story yet — know this before you ship a new table

`packages/ui/src/components/data-table.tsx` has no column-priority, sticky-column, or
card-view-on-phone behavior. This isn't hypothetical: rendering the real dashboard at 768px
tablet width (see `docs/ui-review/mockups/direction-b-elevate--tablet-768x1024.png`) visibly
clips the TAT column off-screen, because the fixed sidebar and the undegraded table are both
fighting for the same narrow viewport. Every dense worklist in the app (orders, patients, cases,
results-entry, QC violations, critical notifications) shares this one component — if you're
fixing table responsiveness, fix it in `DataTable` itself, once. Don't patch around it in a single
screen; that just adds an inconsistency on top of the original gap.

## 5. Status, priority, and clinical-value color — this one is non-negotiable

Straight from `docs/design.md`: **clinical result status is never color alone** — always color +
a letter flag or word + an icon. This is a patient-safety rule, not a style preference (a
color-blind tech missing a flagged critical value is the failure mode this exists to prevent).

- `StatusPill` is for clinical result flags (N/H/L/HH/LL/A) only — don't reach for it outside that
  context, and don't invent a second status-flag component.
- `Badge` (`variant="destructive"`/`"outline"`) is for STAT/routine priority — a deliberately
  different component from `StatusPill`. They look similar; don't conflate them when extending a
  screen, or you'll blur the one visual distinction between "how urgent" and "what the result
  means."
- `SusceptibilityBadge` (S/I/R) is deliberately separate from `StatusPill`, not an extension of
  it — antibiogram interpretation is a different clinical concept from a result flag, and merging
  them would make both harder to read correctly.

## 6. Confirming destructive/irreversible clinical actions

Specimen rejection, critical-value acknowledgment, case sign-out/amend, and finalizing a result
under a QC or critical hold all need to show exactly what's being committed and require a
deliberate second step — never a plain `window.confirm()`, never a single click. Follow the
patterns already shipped, don't invent a new one:

- **Two-step reveal-then-confirm** (`apps/web/app/(app)/reception/reception-form.tsx:158-176`):
  the first click reveals the required reason field and does not submit; a second, explicit click
  submits.
- **Required free-text read-back**, not a bare button (critical-value acknowledgment) — the
  person has to actually type something confirming what they saw, not just click past it.
- **Server-enforced step-up re-authentication** for case sign-out/amend — the most irreversible
  actions get a real auth challenge, not just a UI dialog that a script could click through.

If a new destructive action doesn't fit one of these three shapes, that's a real design decision
(which safeguard does this action actually need?), not a UI-polish question — flag it rather than
defaulting to the lightest-weight option.

## 7. Responsive targets

Design and test against: bench desktop 1366×768 and 1920×1080, tablet 1024×768 landscape and
768×1024 portrait, phone 390×844. Treat Tailwind's `lg` breakpoint (1024px, the default — nothing
custom here) as the **explicit minimum target** for dense worklist/results screens; bench desktop
clears it comfortably, reception tablets in landscape sit right at the line. No horizontal page
scroll — if a table is too wide, that's an internal-scroll or column-priority problem for
`DataTable` to solve (§4), not a page-level overflow. Touch targets ≥44×44px on tablet/phone;
desktop can be denser.

## 8. Protected paths

Mirrors `.claude/settings.json`'s `permissions.deny` (kept in sync by hand — a skill can't read
settings.json). Never edit these without an approved Implementation Proposal in `docs/plans/`,
even if a UI task seems to brush up against them:

```
apps/api/**  apps/gateway/**  apps/interop/**
packages/domain/**  packages/sdk/**  packages/config/**
db/**  infra/**
apps/web/auth/**  apps/web/app/api/**  apps/web/proxy.ts  apps/web/lib/api-client.ts
every package.json and lockfile
```

If a UI change seems to need one of these to move, stop and say so rather than working around it —
that's very likely a sign the change is bigger than it looked.

## 9. Every UI change ships with evidence

Before calling a UI change done: before/after screenshots at every viewport in §7, plus a
keyboard-only pass on any workflow the change touches. A change that "looks right" in one preview
isn't verified — the whole reason this project tracks viewport classes explicitly is that a fix
at 1366px has repeatedly turned out to break at 768px (see §4). No screenshots, no keyboard check,
not done.
