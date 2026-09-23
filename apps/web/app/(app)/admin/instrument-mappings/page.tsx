import { getSession } from '@/auth/get-session';
import { hasCatalogManagementRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { InstrumentMappingsTable, type AnalyteOption, type InstrumentAnalyteMappingRow } from './instrument-mappings-table';

/**
 * Issue #812 (docs/plans/task-812-instrument-analyte-mapping-admin-ui.md).
 * `instrument_analyte_mapping` had no admin UI -- the only way to populate
 * it was a direct SQL `INSERT`. Mirrors `reference-ranges/page.tsx`'s own
 * shape exactly: `manage_catalog` (`qa`/`lab_admin`) is the real
 * enforcement point (`apps/api`'s `CapabilityGuard`); `isQa` here only
 * decides whether the "Add mapping" control renders.
 */
export default async function InstrumentMappingsAdminPage() {
  const session = await getSession();
  const isQa = hasCatalogManagementRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Your session has expired — please log in again.
        </p>
      </div>
    );
  }
  const client = createLisApiClient(accessToken);

  const [{ data: mappings, response: mappingsResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/instrument-analyte-mappings'),
      client.GET('/v1/catalog'),
    ]);
  if (!mappingsResponse.ok || !mappings) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading instrument mappings. Please try again.
        </p>
      </div>
    );
  }
  if (!catalogResponse.ok || !catalog) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading the test catalog. Please try again.
        </p>
      </div>
    );
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

  const rows: InstrumentAnalyteMappingRow[] = mappings.mappings;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Instrument-analyte mappings</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Translates an instrument&apos;s own channel code into an analyte/unit (FEAT-027/KB-29).
          Adding a new mapping never edits or archives an existing one.
        </p>
      </div>
      <InstrumentMappingsTable isQa={isQa} initialRows={rows} analyteOptions={analyteOptions} />
    </div>
  );
}
