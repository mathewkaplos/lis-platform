import { getSession } from '@/auth/get-session';
import { hasPathologistRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import {
  SpecimenProcessingQcTable,
  type CaseOption,
  type SpecimenProcessingBatchRow,
} from './specimen-processing-qc-table';

/**
 * FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md,
 * issue #795). A filterable list of recorded batches plus a "Record batch"
 * form, mirroring `admin/reference-ranges/page.tsx`'s own list+SlideOver-form
 * shape. `record_processing_qc` (`pathologist`-only) is the real enforcement
 * point (`apps/api`'s own `CapabilityGuard`); `hasPathologistRole()` here
 * only decides whether the "Record batch" control renders at all.
 *
 * The case picker offers every case `GET /v1/cases` already returns (default
 * excludes `signed_out`/`amended`, matching that route's own established
 * "active work" default) -- no second, QC-specific case-eligibility concept
 * exists yet.
 */
export default async function SpecimenProcessingQcPage() {
  const session = await getSession();
  const isPathologist = hasPathologistRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    // Issue #758: a thrown Error's message is redacted by Next.js in a real
    // production build (see `frontend-design` Skill entry #12) -- return
    // inline instead.
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Your session has expired — please log in again.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  const [{ data: batches, response: batchesResponse }, { data: cases, response: casesResponse }] =
    await Promise.all([
      client.GET('/v1/specimen-processing-batches', { params: { query: {} } }),
      client.GET('/v1/cases', { params: { query: {} } }),
    ]);
  if (batchesResponse.status === 403) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view specimen-processing QC batches.
        </p>
      </div>
    );
  }
  if (!batchesResponse.ok || !batches) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading specimen-processing QC batches. Please try again.
        </p>
      </div>
    );
  }
  if (!casesResponse.ok || !cases) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading cases. Please try again.
        </p>
      </div>
    );
  }

  const caseOptions: CaseOption[] = cases.items.map((c) => ({
    id: c.id,
    accessionNumber: c.accessionNumber,
    patientName: c.patientName,
  }));

  const rows: SpecimenProcessingBatchRow[] = batches;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Specimen-processing QC</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Batch-level tissue processing, microtomy, and H&amp;E staining quality review — fixation,
          section thickness, staining quality, and specimen orientation, evaluated by the reviewing
          pathologist for the cases a batch covers.
        </p>
      </div>
      <SpecimenProcessingQcTable
        isPathologist={isPathologist}
        initialRows={rows}
        caseOptions={caseOptions}
      />
    </div>
  );
}
