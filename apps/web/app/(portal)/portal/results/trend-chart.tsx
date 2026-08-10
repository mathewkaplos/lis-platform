'use client';

import { DataTable, StatusPill, type DataTableColumn, type ResultFlag } from '@lis/ui';

export interface TrendPoint {
  observationId: string;
  producedAt: string;
  value: string;
  unit: string;
  flags: string[];
  referenceRangeText: string;
  isCritical: boolean;
}

export interface TrendChartProps {
  analyteDisplay: string;
  points: TrendPoint[];
}

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const MARGIN = { top: 16, right: 24, bottom: 32, left: 48 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

function flagTone(flags: string[]): 'default' | 'warning' | 'danger' {
  if (flags.includes('HH') || flags.includes('LL')) return 'danger';
  if (flags.includes('H') || flags.includes('L')) return 'warning';
  return 'default';
}

/**
 * FEAT-039 (proposal §10 Q2, resolved): hand-rolled inline SVG, no charting
 * library -- mirrors `levey-jennings-chart.tsx`'s own established precedent
 * (fixed logical viewBox, `width="100%"` scaling, `role="img"` with a
 * `DataTable` alongside as the real accessible/keyboard-navigable data
 * source, per that component's own a11y reasoning). Materially simpler
 * than that chart: a plain value-over-time line, no z-score/Westgard
 * violation annotation -- this task's own AC is "view results and trends,"
 * not a QC-grade chart.
 */
export function TrendChart({ analyteDisplay, points }: TrendChartProps) {
  if (points.length === 0) {
    return null;
  }

  const numericValues = points
    .map((p) => Number(p.value))
    .filter((v) => !Number.isNaN(v));
  const minValue = Math.min(...numericValues);
  const maxValue = Math.max(...numericValues);
  const padding = (maxValue - minValue) * 0.15 || 1;
  const yMin = minValue - padding;
  const yMax = maxValue + padding;

  function yFor(value: number): number {
    if (yMax === yMin) return MARGIN.top + PLOT_HEIGHT / 2;
    return MARGIN.top + PLOT_HEIGHT * (1 - (value - yMin) / (yMax - yMin));
  }
  function xFor(index: number): number {
    if (points.length === 1) return MARGIN.left + PLOT_WIDTH / 2;
    return MARGIN.left + (PLOT_WIDTH * index) / (points.length - 1);
  }

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(Number(p.value))}`)
    .join(' ');

  const columns: DataTableColumn<TrendPoint>[] = [
    {
      id: 'producedAt',
      header: 'When',
      cell: (row) => row.producedAt,
      sortable: true,
      sortValue: (row) => row.producedAt,
    },
    {
      id: 'value',
      header: 'Value',
      cell: (row) => `${row.value} ${row.unit}`,
      align: 'right',
    },
    { id: 'range', header: 'Reference range', cell: (row) => row.referenceRangeText },
    {
      id: 'flags',
      header: 'Flag',
      cell: (row) => (
        <div className="flex gap-1">
          {row.flags.length > 0 ? (
            row.flags.map((flag) => (
              <StatusPill key={flag} flag={flag as ResultFlag} />
            ))
          ) : (
            <StatusPill flag="N" />
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Trend chart for ${analyteDisplay}, ${points.length} result${points.length === 1 ? '' : 's'} over time`}
      >
        <line
          x1={MARGIN.left}
          y1={MARGIN.top}
          x2={MARGIN.left}
          y2={CHART_HEIGHT - MARGIN.bottom}
          stroke="var(--color-border)"
        />
        <line
          x1={MARGIN.left}
          y1={CHART_HEIGHT - MARGIN.bottom}
          x2={CHART_WIDTH - MARGIN.right}
          y2={CHART_HEIGHT - MARGIN.bottom}
          stroke="var(--color-border)"
        />
        <path d={linePath} fill="none" stroke="var(--color-brand)" strokeWidth={2} />
        {points.map((p, i) => (
          <circle
            key={p.observationId}
            cx={xFor(i)}
            cy={yFor(Number(p.value))}
            r={4}
            fill={
              p.isCritical
                ? 'var(--color-danger)'
                : flagTone(p.flags) === 'warning'
                  ? 'var(--color-warning)'
                  : 'var(--color-brand)'
            }
          />
        ))}
      </svg>
      <DataTable
        columns={columns}
        data={points}
        getRowId={(row) => row.observationId}
        emptyMessage="No results yet."
      />
    </div>
  );
}
