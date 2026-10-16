// Design tokens transcribed from the Google Stitch Prompt Library §0.
// Source of truth and rationale: docs/design.md.

export const colorLight = {
  background: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#E7E9EE",
  textPrimary: "#0F1729",
  textSecondary: "#5B6472",
  // Was #8A93A2 (~3.1:1 on this theme's background/surface) -- fails WCAG AA
  // for real text at any size. Darkened to pass 4.5:1; see docs/design.md.
  textMuted: "#475569",
  // On-text-safe variants of colorSemantic.warning/success below (#D97706 /
  // #16A34A measure ~3.0-3.3:1 as text color -- fine for borders/chip
  // backgrounds/icons, which only need 3:1, but fail for readable text).
  // Use these, never the base semantic token, whenever warning/success text
  // actually needs to be read. See docs/design.md and
  // docs/ui-review/01-audit.md §7 for the measured ratios.
  warningText: "#92400E",
  successText: "#15803D",
  // UI-020 (docs/ui-review/03-roadmap.md): the "in control"/normal marker color on both chart
  // components (Levey-Jennings, trend chart). Same value as colorAccent.DEFAULT in light mode
  // (already passes 6.29:1 against this theme's --surface) -- a distinct token exists so dark
  // mode can diverge (below) without touching the shared --accent brand color used everywhere
  // else (buttons, links, focus rings).
  chartInControl: "#4F46E5",
} as const;

export const colorDark = {
  background: "#0B0E14",
  surface: "#131721",
  surfaceRaised: "#1A202C",
  border: "#232A36",
  textPrimary: "#E6E9EF",
  textSecondary: "#9AA4B2",
  // No dark-mode value existed for this before -- globals.css's dark block
  // never overrode it, so the light value stayed in effect against a
  // near-black background (~2:1, worse than the light-mode failure). New.
  textMuted: "#94A3B8",
  // Same reasoning as colorLight.warningText/successText above, lightened
  // instead of darkened for legibility against the dark background/surface.
  warningText: "#FBBF24",
  successText: "#4ADE80",
  // UI-020: #4F46E5 (the light-mode value, same as --accent) measures only 2.85:1 against this
  // theme's --surface (#131721) -- fails WCAG's 3:1 non-text minimum, confirmed by computation
  // during UI-009's own verification. Lightened to indigo-400 (#818cf8, ~6.01:1), same hue
  // family as the brand accent, not an arbitrary color swap.
  chartInControl: "#818CF8",
} as const;

export const colorAccent = {
  DEFAULT: "#4F46E5",
  hover: "#4338CA",
} as const;

export const colorSemantic = {
  success: "#16A34A",
  warning: "#D97706",
  danger: "#DC2626",
  info: "#2563EB",
  ai: "#7C3AED",
  // Theme-invariant (never overridden in dark mode), same pattern `danger`
  // above already follows -- for a solid chip background with white text on
  // top, e.g. StatCard's positive-delta chip. NOT the same thing as
  // colorLight/colorDark.successText: that one deliberately lightens in dark
  // mode so success-colored *text* stays readable against a dark surface,
  // which would make white text on this *background* fail badly (~1.7:1,
  // confirmed by hand) if the two were conflated under one token -- caught
  // during UI-001's own verification screenshot, not theoretical.
  successSolid: "#15803D",
} as const;

export const typography = {
  fontSans:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontMono:
    '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  scale: {
    xs: "12px",
    sm: "13px",
    base: "14px",
    md: "16px",
    lg: "20px",
    xl: "24px",
    xxl: "30px",
  },
  bodySize: "14px",
  tableCellSize: "13px",
} as const;

export const spacing = {
  base: "4px",
  scale: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
    xxl: "32px",
  },
} as const;

export const radius = {
  card: "8px",
  button: "8px",
  input: "6px",
  chip: "6px",
  modal: "12px",
  slideOver: "12px",
  full: "9999px",
} as const;

export const elevation = {
  card: "0 1px 2px rgba(16, 24, 40, .06)",
  overlay: "0 4px 12px rgba(16, 24, 40, .12)",
} as const;

export const tokens = {
  light: colorLight,
  dark: colorDark,
  accent: colorAccent,
  semantic: colorSemantic,
  typography,
  spacing,
  radius,
  elevation,
} as const;
