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
| `text-muted` | `#8A93A2` | muted text |

### Dark mode
| Token | Value | Use |
|---|---|---|
| `background` | `#0B0E14` | app background |
| `surface` | `#131721` | elevated surface |
| `surface-raised` | `#1A202C` | higher surface |
| `border` | `#232A36` | borders |
| `text-primary` | `#E6E9EF` | primary text |
| `text-secondary` | `#9AA4B2` | secondary text |

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

**Non-negotiable per §0:** clinical result status is never color alone — always paired with a
letter flag (N/H/L/HH/LL/A) and an icon. Normal = neutral text; H/L = amber text + subtle amber
chip; HH/LL = red text + solid red chip + a small alert dot.

## Typography

- UI font: Inter (clean geometric sans fallback stack).
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
