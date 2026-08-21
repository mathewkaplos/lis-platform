import { getSession } from '@/auth/get-session';
import { hasPatientManagementRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CreateReferringFacilityForm } from './create-referring-facility-form';
import { ReferringFacilitiesTable } from './referring-facilities-table';

/**
 * FEAT-066 (docs/plans/feat-066-patient-contact-referring-facility.md,
 * ADR-0053). A plain list + create-only form, mirroring `admin/tests/
 * page.tsx`'s own shape -- `referring_facility` has no edit/delete UI
 * either (proposal §2, "no new UI without a named requirement," matching
 * FEAT-063/064/065's own established precedent).
 *
 * TASK-699 (EPIC #697): the list itself moved into `ReferringFacilitiesTable`
 * (a `'use client'` component) -- `DataTable`'s `columns`/`getRowId` are
 * function props, which can't be constructed inline in this Server Component
 * and passed across the Server→Client boundary (see that file's own header
 * comment).
 */
export default async function AdminReferringFacilitiesPage() {
  const session = await getSession();
  const canManage = hasPatientManagementRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: facilities, response } = await client.GET('/v1/referring-facilities');
  if (!response.ok || !facilities) {
    throw new Error('Something went wrong loading referring facilities. Please try again.');
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Referring facilities</h1>
        <p className="mt-1 text-sm text-text-secondary">
          External facilities that send patients in -- selectable on order entry, and as the
          billed party when an invoice&apos;s payer is corporate. {facilities.length} configured.
        </p>
      </div>
      <ReferringFacilitiesTable rows={facilities} />
      {canManage ? (
        <CreateReferringFacilityForm />
      ) : (
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to add referring facilities.
        </p>
      )}
    </div>
  );
}
