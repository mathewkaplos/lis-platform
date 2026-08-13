import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { ageOf, SEX_LABEL } from '../_lib/patient-display';
import { CopyChip } from './copy-chip';

/**
 * TASK-041 (FEAT-011): the patient profile screen. Overview content only --
 * no tabs (Timeline/Results/Documents/Billing/Notes all depend on features
 * that don't exist yet: FEAT-014 result entry, billing is unscoped anywhere
 * in the current roadmap), no inline-editable demographics or "Merge"
 * action (no supporting API -- TASK-039 built create/search/get only), no
 * alerts (`patient_alert` has no read API despite existing in the schema
 * since TASK-038). See this feature's own Implementation Proposal
 * (docs/plans/feat-011-patient-management.md, TASK-041 revision §5) for the
 * full reasoning.
 *
 * "New order" (TASK-043, FEAT-012 proposal §2/§5) is this screen's only
 * order-entry affordance -- the order builder itself has no standalone
 * patient search, entering exclusively via this link with `patientId`
 * pre-filled.
 *
 * A cross-tenant or nonexistent id surfaces the API's real 404 via
 * `notFound()`, matching `engineering/api-design` Skill entry #7 (RLS makes
 * the row structurally invisible -- a genuinely nonexistent id and a real
 * id belonging to another tenant are indistinguishable here, by design).
 */
export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }

  const client = createLisApiClient(accessToken);
  const { data: patient, response } = await client.GET('/v1/patients/{id}', {
    params: { path: { id } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !patient) {
    throw new Error('Something went wrong loading this patient. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {patient.firstName} {patient.lastName}
            <Badge variant="outline">{SEX_LABEL[patient.sex] ?? patient.sex}</Badge>
          </CardTitle>
          <Button asChild size="sm">
            <Link href={`/orders/new?patientId=${id}`}>New order</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-secondary">MRN</dt>
              <dd className="mt-1">
                <CopyChip value={patient.mrn} label="MRN" />
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">National ID</dt>
              <dd className="mt-1">
                {patient.nationalId ? (
                  <CopyChip value={patient.nationalId} label="National ID" />
                ) : (
                  <span className="text-foreground">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-text-secondary">Date of birth</dt>
              <dd className="mt-1 text-foreground">{patient.birthDate ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Age</dt>
              <dd className="mt-1 text-foreground">{ageOf(patient.birthDate)}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Phone</dt>
              <dd className="mt-1 text-foreground">{patient.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Email</dt>
              <dd className="mt-1 text-foreground">{patient.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Address</dt>
              <dd className="mt-1 text-foreground">{patient.address ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Next of kin</dt>
              <dd className="mt-1 text-foreground">
                {patient.nextOfKinName
                  ? `${patient.nextOfKinName}${patient.nextOfKinPhone ? ` (${patient.nextOfKinPhone})` : ''}`
                  : '—'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
