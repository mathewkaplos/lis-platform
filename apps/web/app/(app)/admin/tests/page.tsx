import { getSession } from '@/auth/get-session';
import { hasCatalogManagementRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { CreateTestForm, type AnalyteOption } from './create-test-form';

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). A simpler, create-only
 * screen (proposal §2) — no filterable table of its own, since `GET
 * /v1/catalog` already lists every existing test; this screen's own job is
 * only the literal AC's "add a new test," binding one or more already-
 * existing analytes (analyte creation is out of scope, §10 Q1). Panel
 * creation/editing is not built here either — not named in the literal AC.
 */
export default async function AdminTestsPage() {
  const session = await getSession();
  const canManageCatalog = hasCatalogManagementRole(session);

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

  // Issue #765: the tenant's own currency setting, not a hardcoded USD --
  // GET /v1/org-settings is gated only by AnyRoleGuard (any authenticated
  // role), so this never adds a new permission requirement to this page.
  const { data: orgSettings } = await client.GET('/v1/org-settings');

  const { data: catalog, response } = await client.GET('/v1/catalog');
  if (!response.ok || !catalog) {
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
    .map((analyte) => ({ id: analyte.id, display: analyte.display, code: analyte.code }))
    .sort((a, b) => a.display.localeCompare(b.display));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Add a test</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Binds one or more existing analytes into a new orderable test. {catalog.tests.length}{' '}
          test(s) already configured.
        </p>
      </div>
      {canManageCatalog ? (
        <CreateTestForm analyteOptions={analyteOptions} currency={orgSettings?.currency ?? null} />
      ) : (
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to add tests.
        </p>
      )}
    </div>
  );
}
