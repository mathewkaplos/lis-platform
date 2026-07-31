// Design tokens transcribed from the Google Stitch Prompt Library §0.
// Source of truth and rationale: docs/design.md.

export const colorLight = {
  background: "#F7F8FA",
  surface: "#FFFFFF",
  border: "#E7E9EE",
  textPrimary: "#0F1729",
  textSecondary: "#5B6472",
  textMuted: "#8A93A2",
} as const;

export const colorDark = {
  background: "#0B0E14",
  surface: "#131721",
  surfaceRaised: "#1A202C",
  border: "#232A36",
  textPrimary: "#E6E9EF",
  textSecondary: "#9AA4B2",
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
