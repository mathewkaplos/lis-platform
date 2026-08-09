'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, DataTable } from '@lis/ui';
import type { WorklistItem } from '@lis/domain';
import { formatDuration } from '@/lib/format-duration';
import { bulkAssignToMe, bulkCancelSelected } from './worklist-actions';

const STATUS_VARIANT: Record<string, 'outline' | 'secondary' | 'default'> = {
  ordered: 'outline',
  received: 'outline',
  in_process: 'default',
  resulted: 'secondary',
  cancelled: 'outline',
  rejected: 'outline',
};

const PRIORITY_VARIANT: Record<string, 'outline' | 'destructive'> = {
  routine: 'outline',
  stat: 'destructive',
};

/**
 * TASK-062 (FEAT-017 revision, §10 Q2, approved): row-click destination is
 * status-conditional, not one fixed target -- `ENTERABLE_ORDERED_TEST_STATUSES`
 * (apps/api/src/observation/observation.controller.ts) only accepts
 * 'received'/'in_process' for result entry, so a plain 'ordered' row (not
 * yet received) has no results screen to usefully land on yet.
 */
function destinationFor(item: WorklistItem): string {
  switch (item.status) {
    case 'received':
    case 'in_process':
      return `/orders/${item.orderId}/results`;
    case 'resulted':
      return `/orders/${item.orderId}/report/${item.id}`;
    default:
      return `/orders/${item.orderId}`;
  }
}

/**
 * FEAT-022 Part 2 (proposal §2/§3): `on_track` renders as plain text, not a
 * Badge -- matches `StatusPill`'s own minimal treatment of the "normal"
 * case (`frontend-design` entry #1's spirit: color/emphasis is reserved for
 * the states that actually need attention). `at_risk`/`overdue` use the
 * same amber/red semantic tokens (`--warning`/`--danger`) the rest of this
 * app's flag/status coloring already uses, not a new palette.
 */
function SlaIndicator({ item }: { item: WorklistItem }) {
  const duration = formatDuration(item.ageMinutes);
  if (item.slaStatus === 'overdue') {
    return (
      <Badge variant="destructive" className="tabular-nums">
        {duration} overdue
      </Badge>
    );
  }
  if (item.slaStatus === 'at_risk') {
    return (
      <Badge variant="outline" className="border-warning/30 bg-warning/10 tabular-nums text-warning">
        {duration} at risk
      </Badge>
    );
  }
  return <span className="tabular-nums">{duration}</span>;
}

/**
 * FEAT-022 Part 2 (ADR-0024 decision 2): the only three honest states --
 * no directory exists to resolve a third party's uuid to a real name.
 */
function AssigneeCell({ assignedUserId, currentUserId }: { assignedUserId: string | null; currentUserId?: string }) {
  if (assignedUserId === null) {
    return <span className="text-text-secondary">—</span>;
  }
  if (assignedUserId === currentUserId) {
    return <Badge variant="secondary">You</Badge>;
  }
  return (
    <span
      className="text-text-secondary"
      title="Assigned to another user -- no user directory exists yet to show a name (ADR-0024)"
    >
      Assigned
    </span>
  );
}

/**
 * TASK-062: thin client island around `DataTable`, mirroring
 * `orders-table.tsx`'s exact shape -- exists only to own status-conditional
 * row-click navigation (§10 Q2), the literal "two clicks or fewer" AC path
 * for a 'received'/'in_process' row.
 *
 * FEAT-022 Part 2: adds bulk-select (`canManageOrders`-gated, hidden
 * entirely for a non-`technologist` session, same "hidden not disabled"
 * precedent `isVerifier` already established), an Assignee column, and an
 * SLA-colored TAT indicator. Local state patch on a successful bulk action
 * (proposal §1 finding #4) -- mirrors `violations-table.tsx`'s own
 * `setRows`-filter/update precedent, not a full `router.refresh()`.
 */
export function WorklistView({
  items,
  canManageOrders,
  currentUserId,
}: {
  items: WorklistItem[];
  canManageOrders: boolean;
  currentUserId?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [banner, setBanner] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function runBulkAssign() {
    const ids = selectedRowIds;
    setBanner(null);
    startTransition(async () => {
      const outcome = await bulkAssignToMe(ids);
      if (outcome.status === 'error') {
        setBanner({ tone: 'error', message: outcome.error ?? 'Something went wrong.' });
        return;
      }
      const updated = new Set(outcome.updatedIds);
      setRows((prev) =>
        prev.map((row) => (updated.has(row.id) ? { ...row, assignedUserId: currentUserId ?? null } : row)),
      );
      setSelectedRowIds([]);
      setBanner({
        tone: 'success',
        message:
          outcome.notFoundIds.length > 0
            ? `Assigned ${outcome.updatedIds.length} to you — ${outcome.notFoundIds.length} could not be found.`
            : `Assigned ${outcome.updatedIds.length} to you.`,
      });
    });
  }

  function runBulkCancel() {
    const ids = selectedRowIds;
    setBanner(null);
    startTransition(async () => {
      const outcome = await bulkCancelSelected(ids);
      if (outcome.status === 'error') {
        setBanner({ tone: 'error', message: outcome.error ?? 'Something went wrong.' });
        return;
      }
      const cancelled = new Set(outcome.cancelledIds);
      setRows((prev) => prev.filter((row) => !cancelled.has(row.id)));
      setSelectedRowIds([]);
      setBanner({
        tone: outcome.ineligibleIds.length > 0 ? 'error' : 'success',
        message:
          outcome.ineligibleIds.length > 0
            ? `${outcome.cancelledIds.length} cancelled — ${outcome.ineligibleIds.length} skipped (already past the ordered stage).`
            : `${outcome.cancelledIds.length} cancelled.`,
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canManageOrders && selectedRowIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
          <span className="px-1 text-sm text-text-secondary">{selectedRowIds.length} selected</span>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={runBulkAssign}>
            Assign to me
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={runBulkCancel}>
            Cancel selected
          </Button>
        </div>
      ) : null}

      {banner ? (
        <div
          role="status"
          className={
            banner.tone === 'error'
              ? 'rounded-md border border-warning/30 bg-warning/10 p-2 text-sm text-warning'
              : 'rounded-md border border-success/30 bg-success/10 p-2 text-sm text-success'
          }
        >
          {banner.message}
        </div>
      ) : null}

      <DataTable
        columns={[
          {
            id: 'patient',
            header: 'Patient',
            cell: (row) => (
              <span>
                {row.patient.firstName} {row.patient.lastName}{' '}
                <span className="font-mono text-xs text-text-secondary">{row.patient.mrn}</span>
              </span>
            ),
          },
          {
            id: 'test',
            header: 'Test',
            cell: (row) => <span className="text-sm">{row.testDisplayName}</span>,
          },
          {
            id: 'priority',
            header: 'Priority',
            cell: (row) => (
              <Badge variant={PRIORITY_VARIANT[row.priority] ?? 'outline'}>{row.priority}</Badge>
            ),
          },
          {
            id: 'status',
            header: 'Status',
            cell: (row) => (
              <Badge variant={STATUS_VARIANT[row.status] ?? 'outline'}>{row.status}</Badge>
            ),
          },
          {
            id: 'assignee',
            header: 'Assignee',
            cell: (row) => <AssigneeCell assignedUserId={row.assignedUserId} currentUserId={currentUserId} />,
          },
          {
            id: 'tat',
            header: 'TAT',
            cell: (row) => <SlaIndicator item={row} />,
            sortable: true,
            sortValue: (row) => row.ageMinutes,
          },
        ]}
        data={rows}
        getRowId={(row) => row.id}
        selectedRowIds={canManageOrders ? selectedRowIds : undefined}
        onSelectedRowIdsChange={canManageOrders ? setSelectedRowIds : undefined}
        onRowClick={(row) => router.push(destinationFor(row))}
        emptyMessage="Nothing in this view."
      />
    </div>
  );
}
