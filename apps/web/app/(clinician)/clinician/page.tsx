import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { ClinicianPatientsTable } from './patients-table';
import { CriticalAckForm } from './critical-ack-form';

/**
 * FEAT-038's Doctor Dashboard (KB-33's "§3.8" Stitch screen, proposal §2):
 * the clinician's own related patients (`GET /v1/patients`, already
 * own-patient-scoped since FEAT-040) and their own related patients'
 * pending criticals (`GET /v1/critical-notifications`, newly scoped this
 * task) -- the two real entry points KB-33 names ("track status" /
 * "acknowledge with documented read-back") plus a "place an order" link per
 * patient.
 */
export default async function ClinicianDashboardPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [
    { data: patients, response: patientsResponse },
    { data: criticals, response: criticalsResponse },
  ] = await Promise.all([
    client.GET('/v1/clinician/patients'),
    client.GET('/v1/critical-notifications', {
      params: { query: { status: 'pending' } },
    }),
  ]);

  if (patientsResponse.status === 403) {
    throw new Error('You do not have permission to view your patients.');
  }
  if (!patientsResponse.ok || !patients) {
    throw new Error('Something went wrong loading your patients. Please try again.');
  }
  if (!criticalsResponse.ok || !criticals) {
    throw new Error('Something went wrong loading criticals. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Unacknowledged criticals</CardTitle>
        </CardHeader>
        <CardContent>
          {criticals.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No unacknowledged criticals for your patients.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {criticals.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
                  <div className="flex items-center justify-between text-sm">
                    <Badge variant="destructive">Escalation level {c.escalationLevel}</Badge>
                    <span className="text-text-secondary">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <CriticalAckForm notificationId={c.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your patients</CardTitle>
        </CardHeader>
        <CardContent>
          <ClinicianPatientsTable patients={patients} />
        </CardContent>
      </Card>
    </div>
  );
}
