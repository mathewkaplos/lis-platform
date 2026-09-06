import { getSession } from '@/auth/get-session';
import { hasPathologistRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { NotificationsTable, type NotificationRow } from './notifications-table';

/**
 * Issue #809. The in-app worklist for the real, tested critical-value
 * notification/escalation/read-back backend (FEAT-021, TASK-065/066) --
 * confirmed live this pass that the backend fires correctly on a critical
 * result's finalization, but had zero browser UI anywhere to see or
 * acknowledge one. Deliberately minimal, mirroring `qc-violations/page.tsx`'s
 * own "unresolved-only queue" framing file-for-file: an unacknowledged
 * queue with an Acknowledge action, not a full alerting dashboard.
 *
 * `verify` is the capability that gates acknowledgment server-side
 * (`CriticalAcknowledgeService`, ADR-0016) -- `hasPathologistRole` here only
 * decides whether this screen shows the control that would call it, same
 * `isVerifier` precedent `orders/[id]/results/page.tsx` already established
 * for the identical role/capability pairing.
 */
export default async function CriticalNotificationsPage() {
  const session = await getSession();
  const canAcknowledge = hasPathologistRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    // Issue #758: a thrown Error's message is redacted by Next.js in a real production
    // build (see `frontend-design` Skill entry #12) -- return inline instead.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Your session has expired — please log in again.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  const { data: pending, response: pendingResponse } = await client.GET('/v1/critical-notifications', {
    params: { query: { status: 'pending' } },
  });
  const { data: escalated, response: escalatedResponse } = await client.GET('/v1/critical-notifications', {
    params: { query: { status: 'escalated' } },
  });
  if (!pendingResponse.ok || !pending || !escalatedResponse.ok || !escalated) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading critical notifications. Please try again.
        </p>
      </div>
    );
  }

  const rows: NotificationRow[] = [...pending, ...escalated]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((n) => ({
      id: n.id,
      status: n.status,
      escalationLevel: n.escalationLevel,
      createdAt: n.createdAt,
      patientName:
        n.patientFirstName && n.patientLastName ? `${n.patientFirstName} ${n.patientLastName}` : null,
      patientMrn: n.patientMrn,
      analyteDisplay: n.analyteDisplay,
      valueNum: n.valueNum,
      unit: n.unit,
      flags: n.flags ?? [],
      orderId: n.orderId,
    }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Critical notifications</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Pending and escalated critical-value alerts. Acknowledging records the read-back Constitution
          Law #3 requires.
        </p>
      </div>
      <NotificationsTable canAcknowledge={canAcknowledge} initialRows={rows} />
    </div>
  );
}
