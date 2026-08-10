import { getSession } from '@/auth/get-session';
import { hasQaRole } from '@/auth/roles';
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
  const isQa = hasQaRole(session);

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data: catalog, response } = await client.GET('/v1/catalog');
  if (!response.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
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
      {isQa ? (
        <CreateTestForm analyteOptions={analyteOptions} />
      ) : (
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to add tests.
        </p>
      )}
    </div>
  );
}
