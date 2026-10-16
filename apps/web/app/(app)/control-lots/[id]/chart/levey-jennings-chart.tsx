'use client';

import { Badge, DataTable, type DataTableColumn } from '@lis/ui';

/**
 * TASK-069 (FEAT-019, Stitch §14.2/§14.4). Mirrors TASK-068's own
 * `QcChartResult` shape exactly (`@lis/sdk`'s generated `QcChartDto_Output`)
 * -- kept as a local, narrow prop type rather than importing the SDK type
 * directly, matching `results-grid.tsx`'s own `ResultRow`/`PriorResult`
 * precedent of a page-local shape decoupled from the wire type.
 */
export interface ChartViolation {
  ruleCode: '1_2s' | '1_3s' | '2_2s' | 'r_4s' | '4_1s' | '10x';
  severity: 'warning' | 'rejection';
}

export interface ChartPoint {
  id: string;
  value: number;
  zScore: number;
  producedAt: string | null;
  createdAt: string;
  violations: ChartViolation[];
}

export interface LeveyJenningsChartProps {
  targetMean: number;
  targetSd: number;
  points: ChartPoint[];
}

const RULE_LABELS: Record<ChartViolation['ruleCode'], string> = {
  '1_2s': '1-2s',
  '1_3s': '1-3s',
  '2_2s': '2-2s',
  r_4s: 'R-4s',
  '4_1s': '4-1s',
  '10x': '10x',
};

function pointSeverity(point: ChartPoint): 'none' | 'warning' | 'rejection' {
  if (point.violations.some((v) => v.severity === 'rejection')) return 'rejection';
  if (point.violations.some((v) => v.severity === 'warning')) return 'warning';
  return 'none';
}

// Chart geometry, in a fixed logical coordinate space scaled to fit any
// container via the SVG's own viewBox (`width="100%"`, no fixed pixel size).
const CHART_WIDTH = 720;
const CHART_HEIGHT = 320;
const MARGIN = { top: 16, right: 24, bottom: 32, left: 48 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
// Bands are drawn at exactly ±1/2/3 SD (KB-27's own "mean ± 1/2/3 SD"); the
// vertical range extends a half-SD beyond the widest band actually needed,
// so an out-of-range point is never clipped at the plot's own edge.
const BAND_LIMIT = 3;

// UI-009 (docs/ui-review/03-roadmap.md): found live while verifying this file's own shape fix
// below -- `--color-brand`/`--color-warning`/`--color-danger` (the names used here before this
// fix) are never actually emitted as real CSS custom properties. Tailwind v4's `@theme inline`
// block (apps/web/app/globals.css) only uses those `--color-*` names to generate utility classes
// (e.g. `.bg-brand`) -- it does not expose them for arbitrary `var()` use elsewhere, confirmed
// directly: `getComputedStyle(document.documentElement).getPropertyValue('--color-brand')` is
// empty, while `--accent` (the raw token, defined directly in :root/dark-mode blocks, not
// through @theme inline) resolves correctly. Every marker on this chart has been rendering
// black, in both themes, since this function was written -- not something this task introduced,
// caught only because UI-009 added the first real rendered verification of this component.
// UI-020 (docs/ui-review/03-roadmap.md): 'none' uses --chart-in-control, not --accent directly
// -- --accent measures only ~2.85:1 against the dark-mode surface (fails WCAG's 3:1 non-text
// minimum, confirmed by computation during UI-009's own verification); --chart-in-control is the
// same value in light mode (still passes 6.29:1) but a lighter indigo in dark mode (~6.01:1).
function severityColor(severity: 'none' | 'warning' | 'rejection'): string {
  if (severity === 'rejection') return 'var(--danger)';
  if (severity === 'warning') return 'var(--warning)';
  return 'var(--chart-in-control)';
}

/**
 * UI-009 (docs/ui-review/03-roadmap.md): severity was previously color-only at the point level
 * (same radius for warning/rejection, only the fill color differed) -- the one flagged exception
 * to this app's "never color alone" rule (docs/design.md). Distinct shapes, not just color,
 * survive grayscale/color-blind viewing and a photocopied/printed chart: circle (in control,
 * unchanged), triangle (warning), diamond (rejection) -- a conventional severity-shape mapping,
 * not invented here. Legend below mirrors the same shapes.
 */
function PointMarker({
  severity,
  cx,
  cy,
  r,
}: {
  severity: 'none' | 'warning' | 'rejection';
  cx: number;
  cy: number;
  r: number;
}) {
  const fill = severityColor(severity);
  const common = { fill, stroke: 'var(--surface)', strokeWidth: 1.5 };

  if (severity === 'warning') {
    // Upward triangle, roughly equal visual weight to the circle/diamond at the same r.
    const points = [
      [cx, cy - r * 1.15],
      [cx - r, cy + r * 0.75],
      [cx + r, cy + r * 0.75],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
    return <polygon points={points} {...common} />;
  }

  if (severity === 'rejection') {
    // Diamond (rotated square).
    const points = [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
    return <polygon points={points} {...common} />;
  }

  return <circle cx={cx} cy={cy} r={r} {...common} />;
}

/**
 * The classic Levey-Jennings plot: mean center line, shaded ±1/2/3 SD bands,
 * control points connected in run order, out-of-range points colored by
 * violation severity and annotated with the fired rule code(s) (Stitch
 * §14.4). Points are evenly spaced by run order, not by real elapsed time --
 * the standard L-J convention (KB-27's own chart never claims a time-scaled
 * x-axis) -- `producedAt` is still shown per-point in the table below for
 * anyone who needs the real timestamp.
 *
 * No level selector, no date range, no multi-level stacking: TASK-068's own
 * endpoint is scoped to a single control lot, and this task's own AC is
 * "correctly plots"/"visibly flagged," not a full QC dashboard -- a
 * deliberate narrowing, not an oversight (KB-27's fuller charting vision is
 * FEAT-020/a future QC dashboard's scope, not this task's).
 *
 * `role="img"` with a single summarizing label: the `DataTable` rendered
 * alongside is the real accessible, keyboard-navigable data source (Stitch
 * §14.4's own "a11y (data-table alternative)" requirement) -- the SVG's
 * internal text/shapes are not independently exposed to a screen reader.
 */
export function LeveyJenningsChart({ targetMean, targetSd, points }: LeveyJenningsChartProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-1 rounded-md border border-border bg-surface text-center">
        <p className="text-sm text-text-secondary">No QC results yet for this control lot.</p>
        <p className="text-xs text-text-muted">
          A Levey-Jennings chart appears once QC results are recorded.
        </p>
      </div>
    );
  }

  const maxAbsZ = Math.max(BAND_LIMIT, ...points.map((p) => Math.abs(p.zScore)));
  const zRange = maxAbsZ + 0.5;

  function yForZ(z: number): number {
    return MARGIN.top + PLOT_HEIGHT * (1 - (z + zRange) / (zRange * 2));
  }
  function xForIndex(index: number): number {
    if (points.length === 1) return MARGIN.left + PLOT_WIDTH / 2;
    return MARGIN.left + (PLOT_WIDTH * index) / (points.length - 1);
  }

  const bandLevels = [-3, -2, -1, 0, 1, 2, 3] as const;
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xForIndex(i)} ${yForZ(p.zScore)}`).join(' ');
  const violationCount = points.filter((p) => p.violations.length > 0).length;

  const columns: DataTableColumn<ChartPoint>[] = [
    {
      id: 'producedAt',
      header: 'When',
      cell: (row) =>
        row.producedAt ? new Date(row.producedAt).toLocaleString() : new Date(row.createdAt).toLocaleString(),
      sortable: true,
      sortValue: (row) => row.producedAt ?? row.createdAt,
    },
    { id: 'value', header: 'Value', cell: (row) => row.value.toFixed(3), align: 'right' },
    { id: 'target', header: 'Target', cell: () => targetMean.toFixed(3), align: 'right' },
    { id: 'sd', header: 'SD', cell: () => targetSd.toFixed(3), align: 'right' },
    {
      id: 'zScore',
      header: 'Z-score',
      cell: (row) => row.zScore.toFixed(2),
      align: 'right',
      sortable: true,
      sortValue: (row) => row.zScore,
    },
    {
      id: 'rules',
      header: 'Rules triggered',
      cell: (row) =>
        row.violations.length === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.violations.map((v) => (
              <Badge
                key={v.ruleCode}
                variant={v.severity === 'rejection' ? 'destructive' : 'outline'}
                className={v.severity === 'warning' ? 'border-warning/40 text-warning-text' : undefined}
              >
                {RULE_LABELS[v.ruleCode]}
              </Badge>
            ))}
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          width="100%"
          className="h-auto w-full"
          role="img"
          aria-label={`Levey-Jennings chart: ${points.length} control result${points.length === 1 ? '' : 's'}, ${violationCount} with a Westgard rule violation. See the table below for exact values.`}
        >
          {/* Shaded ±1/2/3 SD bands, darkest closest to ±3 SD. */}
          {[3, 2, 1].map((band) => (
            <rect
              key={band}
              x={MARGIN.left}
              y={yForZ(band)}
              width={PLOT_WIDTH}
              height={yForZ(band - 1) - yForZ(band)}
              className="fill-text-muted"
              opacity={0.05 + (3 - band) * 0.03}
            />
          ))}
          {[-1, -2, -3].map((band) => (
            <rect
              key={band}
              x={MARGIN.left}
              y={yForZ(band + 1)}
              width={PLOT_WIDTH}
              height={yForZ(band) - yForZ(band + 1)}
              className="fill-text-muted"
              opacity={0.05 + (3 + band) * 0.03}
            />
          ))}

          {/* Grid lines + Y-axis labels. */}
          {bandLevels.map((z) => (
            <g key={z}>
              <line
                x1={MARGIN.left}
                x2={CHART_WIDTH - MARGIN.right}
                y1={yForZ(z)}
                y2={yForZ(z)}
                className="stroke-border"
                strokeWidth={z === 0 ? 1.5 : 1}
                strokeDasharray={z === 0 ? undefined : '4 3'}
              />
              <text
                x={MARGIN.left - 8}
                y={yForZ(z)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-text-secondary text-[10px]"
              >
                {z === 0 ? 'Mean' : `${z > 0 ? '+' : ''}${z} SD`}
              </text>
            </g>
          ))}

          {/* Connecting line + points. */}
          <path d={linePath} fill="none" className="stroke-brand" strokeWidth={1.5} />
          {points.map((point, index) => {
            const severity = pointSeverity(point);
            const cx = xForIndex(index);
            const cy = yForZ(point.zScore);
            return (
              <g key={point.id}>
                <PointMarker severity={severity} cx={cx} cy={cy} r={severity === 'none' ? 4 : 6} />
                {point.violations.length > 0 ? (
                  <text
                    x={cx}
                    y={cy - 10}
                    textAnchor="middle"
                    className="text-[9px] font-medium"
                    fill={severityColor(severity)}
                  >
                    {point.violations.map((v) => RULE_LABELS[v.ruleCode]).join(', ')}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <PointMarker severity="none" cx={5} cy={5} r={4} />
            </svg>
            In control
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <PointMarker severity="warning" cx={6} cy={6} r={5} />
            </svg>
            Warning (1-2s)
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <PointMarker severity="rejection" cx={6} cy={6} r={5} />
            </svg>
            Rejection
          </span>
        </div>
      </div>

      <DataTable columns={columns} data={points} getRowId={(row) => row.id} />
    </div>
  );
}
