/**
 * UI-021 (docs/ui-review/03-roadmap.md): shared by trend-chart.tsx and levey-jennings-chart.tsx
 * (both in apps/web) so they reuse the identical circle/triangle/diamond shapes and colors
 * instead of re-deriving them -- severity is never color alone (docs/design.md's own rule):
 * distinct shapes, not just color, survive grayscale/color-blind viewing and a printed/
 * photocopied chart. Lives in packages/ui rather than apps/web/lib since it's presentation-only
 * (no app-specific data shape) and both consumers are themselves apps/web screens, matching this
 * package's existing "shared design-system primitive" scope.
 */
export type ChartSeverity = "none" | "warning" | "rejection";

// UI-020 (docs/ui-review/03-roadmap.md): 'none' uses --chart-in-control, not --accent directly
// -- --accent measures only ~2.85:1 against the dark-mode surface (fails WCAG's 3:1 non-text
// minimum, confirmed by computation); --chart-in-control is the same value in light mode (still
// passes 6.29:1) but a lighter indigo in dark mode (~6.01:1).
export function chartSeverityColor(severity: ChartSeverity): string {
  if (severity === "rejection") return "var(--danger)";
  if (severity === "warning") return "var(--warning)";
  return "var(--chart-in-control)";
}

export function PointMarker({
  severity,
  cx,
  cy,
  r,
}: {
  severity: ChartSeverity;
  cx: number;
  cy: number;
  r: number;
}) {
  const fill = chartSeverityColor(severity);
  const common = { fill, stroke: "var(--surface)", strokeWidth: 1.5 };

  if (severity === "warning") {
    // Upward triangle, roughly equal visual weight to the circle/diamond at the same r.
    const points = [
      [cx, cy - r * 1.15],
      [cx - r, cy + r * 0.75],
      [cx + r, cy + r * 0.75],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(" ");
    return <polygon points={points} {...common} />;
  }

  if (severity === "rejection") {
    // Diamond (rotated square).
    const points = [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(" ");
    return <polygon points={points} {...common} />;
  }

  return <circle cx={cx} cy={cy} r={r} {...common} />;
}
