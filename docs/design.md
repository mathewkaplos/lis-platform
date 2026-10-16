# Design Tokens — v1

Source of truth: `/mnt/d/LIS/research/Google-Stitch-Prompt-Library.md`, §0 (The Global Design
System). Every value below is transcribed from that spec, not independently redesigned — see
`docs/plans/feat-010-design-system-v1.md` §3/§5 for why. Consumed as code by
`packages/ui/tokens.ts`; wired into `apps/web/app/globals.css`.

## Color

### Light mode
| Token | Value | Use |
|---|---|---|
| `background` | `#F7F8FA` | app background |
| `surface` | `#FFFFFF` | card/surface |
| `border` | `#E7E9EE` | subtle borders |
| `text-primary` | `#0F1729` | primary text |
| `text-secondary` | `#5B6472` | secondary text |
| `text-muted` | `#475569` | muted text (corrected UI-001 -- was `#8A93A2`, ~3.1:1, failed WCAG AA) |

### Dark mode
| Token | Value | Use |
|---|---|---|
| `background` | `#0B0E14` | app background |
| `surface` | `#131721` | elevated surface |
| `surface-raised` | `#1A202C` | higher surface |
| `border` | `#232A36` | borders |
| `text-primary` | `#E6E9EF` | primary text |
| `text-secondary` | `#9AA4B2` | secondary text |
| `text-muted` | `#94A3B8` | muted text (new, UI-001 -- no dark value existed before; the light
  value stayed in effect against this near-black background, ~2:1, worse than the light-mode
  failure it was already carrying) |

### Accent (same in both themes)
| Token | Value |
|---|---|
| `accent` | `#4F46E5` (indigo) — primary actions, active nav, focus |
| `accent-hover` | `#4338CA` |

### Semantic (same in both themes)
| Token | Value | Use |
|---|---|---|
| `success` | `#16A34A` | normal / success |
| `warning` | `#D97706` | pending / H / L (amber) |
| `danger` | `#DC2626` | critical / HH / LL (red) |
| `info` | `#2563EB` | informational |
| `ai` | `#7C3AED` | AI/assistant surfaces |

**`warning`/`success` as text color (added, UI-001):** `#D97706`/`#16A34A` measure ~3.0-3.3:1
against both themes' background/surface -- fine for borders, chip backgrounds, and icon fills
(only need to clear 3:1), but fail WCAG AA (4.5:1) as readable text. Use the on-text-safe variants
below wherever warning/success text is actually meant to be read, never the base token:

| Token | Light | Dark | Use |
|---|---|---|---|
| `warning-text` | `#92400E` | `#FBBF24` | H/L result-flag text, QC-hold/at-risk status copy |
| `success-text` | `#15803D` | `#4ADE80` | confirmation text ("Finalized", "Saved", etc.) |
| `success-solid` | `#15803D` | `#15803D` (same -- never overridden in dark mode, same pattern
  as `danger`) | solid chip backgrounds with white text on top, e.g. `StatCard`'s positive-delta
  chip. **Not interchangeable with `success-text`**: that one lightens in dark mode so text stays
  readable against a dark surface, which would make white text on a solid chip fail badly
  (~1.7:1, confirmed by hand) if the two were conflated -- caught during UI-001's own
  verification screenshot, not theoretical. |

**Non-negotiable per §0:** clinical result status is never color alone — always paired with a
letter flag (N/H/L/HH/LL/A) and an icon. Normal = neutral text; H/L = amber text + subtle amber
chip; HH/LL = red text + solid red chip + a small alert dot.

## Typography

- UI font: Geist (clean geometric sans fallback stack). Corrected UI-001 -- this doc previously
  said Inter, which the app hasn't actually loaded since `apps/web/app/layout.tsx` switched to
  `next/font/google`'s Geist/Geist Mono; the doc had drifted from what's shipped, not the other
  way around.
- Monospace (tabular numerals, accession numbers, MRNs, barcodes): a monospace face with
  tabular/lining figures.
- Type scale: `12 / 13 / 14 / 16 / 20 / 24 / 30` px.
- Body text: 14px. Table cells: 13px.
- Titles: semibold, not bold-heavy.
- All numeric lab values, table numbers, and IDs use tabular/lining numerals so columns align.

## Spacing, radius, elevation

- Base grid: 4px. Rhythm: `8 / 12 / 16 / 24 / 32`.
- Radius: 8px cards/buttons, 6px inputs/chips, 12px modals/slide-overs, full (pill) on
  avatars/pills.
- Elevation is soft and low — no heavy drop shadows or gradients:
  - card: 1px border + `0 1px 2px rgba(16, 24, 40, .06)` (exact value from §0).
  - overlay: a visibly deeper but still soft shadow — §0 specifies this qualitatively only
    ("slightly deeper soft shadow"), not as an exact value; `0 4px 12px rgba(16, 24, 40, .12)`
    is this implementation's own reasonable interpretation, revisit if a rendered overlay looks
    wrong against the rest of the system.

## Dark mode mechanism

Two selectors both apply the dark token set: the `prefers-color-scheme: dark` media query
(today's only mechanism, OS-driven) and a `[data-theme="dark"]` attribute selector on `:root`
(forward-compatible — TASK-036 builds the actual manual Light/Dark/System toggle that sets this
attribute; this task only makes sure the tokens are ready for it).

## Accessibility

WCAG 2.2 AA is asserted by §0 but not independently verified by this task — TASK-037's axe CI
check is the actual proof, not this document.

## Reference screens

Not generated this task — see `docs/plans/feat-010-design-system-v1.md` §10 Q1 (resolved:
option (c), deferred as a follow-up pending issue #192).
