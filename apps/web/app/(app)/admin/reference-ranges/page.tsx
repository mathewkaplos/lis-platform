import { getSession } from '@/auth/get-session';
import { hasQaRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { ReferenceRangesTable, type AnalyteOption, type ReferenceRangeRow } from './reference-ranges-table';

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). §20.4-shaped: a
 * filterable, data-dense table of `reference_range` rows plus an "Add
 * range" form. Add-only (§10 Q3) — no edit/archive action exists on this
 * screen. `manage_catalog` (`qa`-only) is the real enforcement point
 * (`apps/api`'s own `CapabilityGuard`); `hasQaRole()` here only decides
 * whether the "Add range" control renders at all, mirroring
 * `qc-violations/page.tsx`'s own identical `isQa` framing.
 *
 * Analyte options (id/display/unitId) come from the already-fetched
 * `/v1/catalog` — no second endpoint (same reuse precedent
 * `qc-violations/page.tsx` already established for analyte display names).
 * `unitId` is `CatalogAnalyte`'s own FEAT-035 addition (the analyte's
 * `defaultUnitId`) — the create form submits that unit id automatically
 * for the selected analyte, since no unit-picker UI exists in this
 * proposal's scope (every analyte has exactly one canonical unit).
 */
export default async function ReferenceRangesAdminPage() {
  const session = await getSession();
  const isQa = hasQaRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [{ data: ranges, response: rangesResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([client.GET('/v1/reference-ranges'), client.GET('/v1/catalog')]);
  if (!rangesResponse.ok || !ranges) {
    throw new Error('Something went wrong loading reference ranges. Please try again.');
  }
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
  }

  const analyteOptions: AnalyteOption[] = catalog.tests
    .flatMap((test) => test.analytes)
    .filter((analyte, index, all) => all.findIndex((a) => a.id === analyte.id) === index)
    .map((analyte) => ({
      id: analyte.id,
      display: analyte.display,
      unitId: analyte.unitId,
      unitDisplay: analyte.unit,
    }))
    .sort((a, b) => a.display.localeCompare(b.display));

  const rows: ReferenceRangeRow[] = ranges.ranges;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reference ranges</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Analyte reference ranges, versioned by effective date (KB-15). Adding a new range never
          edits or ends an existing one.
        </p>
      </div>
      <ReferenceRangesTable isQa={isQa} initialRows={rows} analyteOptions={analyteOptions} />
    </div>
  );
}
