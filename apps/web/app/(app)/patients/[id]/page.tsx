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
 * in the current roadmap), no "Merge" action, no alerts (`patient_alert` has
 * no read API despite existing in the schema since TASK-038). See this
 * feature's own Implementation Proposal (docs/plans/feat-011-patient-
 * management.md, TASK-041 revision §5) for the full reasoning.
 *
 * Issue #747 (docs/plans/task-747-patient-demographic-editing.md): the
 * "Edit" action below is this screen's own correction path -- previously
 * absent entirely; `PUT /v1/patients/:id` is the first patient-mutation
 * route besides create.
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
 *
 * Deliberately no `loading.tsx` in this route (nor its `/edit` child, which
 * shares this segment's Suspense boundary). Confirmed live 2026-08-26
 * (pilot-readiness audit): with `next dev --webpack` on Next 16.2.12, a
 * route-level `loading.tsx` Suspense boundary here reproducibly never
 * resolves on the client -- same defect already found and fixed on
 * `/patients` and `/orders` (see those routes' `page.tsx` comments and
 * `docs/pilot/PILOT-USER-GUIDE.md` §7/§8/§9). Re-add one only after
 * confirming this reproduces (or doesn't) on `next build && next start` or
 * Turbopack.
 */
export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const { data: patient, response } = await client.GET('/v1/patients/{id}', {
    params: { path: { id } },
  });
  if (response.status === 404) {
    notFound();
  }
  if (!response.ok || !patient) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading this patient. Please try again.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {patient.firstName} {patient.lastName}
            <Badge variant="outline">{SEX_LABEL[patient.sex] ?? patient.sex}</Badge>
          </CardTitle>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/patients/${id}/edit`}>Edit</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/orders/new?patientId=${id}`}>New order</Link>
            </Button>
          </div>
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
