import { notFound } from 'next/navigation';
import { getSession } from '@/auth/get-session';
import { hasQaRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { ReportTemplateDesigner } from './designer';
import type { PreviewAnalyteOption } from './preview';

/**
 * FEAT-047 (docs/plans/feat-047-visual-report-designer-v1.md). The designer
 * itself. No `GET /v1/report-templates/:id` route exists (the proposal's
 * own affected-files list adds no new routes) -- this page fetches the full
 * `GET /v1/report-templates` list server-side and finds the one entry
 * matching this test, the same "reuse an already-fetched-everywhere
 * endpoint rather than add a new one" precedent `admin/tests/page.tsx`'s
 * own header comment already established for `/v1/catalog`.
 *
 * The canvas seeds from the existing template's own latest version
 * (whatever its status) if one exists, or an empty definition if this test
 * has no template yet -- "Save" always creates a new version on top of
 * that starting point (§5's own "no update-draft endpoint" design), never
 * edits a version in place.
 */
export default async function ReportTemplateDesignerPage({
  params,
}: {
  params: Promise<{ testDefinitionId: string }>;
}) {
  const { testDefinitionId } = await params;
  const session = await getSession();
  const isQa = hasQaRole(session);

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

  const [
    { data: catalog, response: catalogResponse },
    { data: templates, response: templatesResponse },
  ] = await Promise.all([client.GET('/v1/catalog'), client.GET('/v1/report-templates')]);
  if (!catalogResponse.ok || !catalog) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading the test catalog. Please try again.
        </p>
      </div>
    );
  }
  if (!templatesResponse.ok || !templates) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading report templates. Please try again.
        </p>
      </div>
    );
  }

  const test = catalog.tests.find((t) => t.id === testDefinitionId);
  if (!test) {
    notFound();
  }

  const analyteOptions: PreviewAnalyteOption[] = test.analytes
    .map((analyte) => ({ id: analyte.id, display: analyte.display, unit: analyte.unit }))
    .sort((a, b) => a.display.localeCompare(b.display));

  const existingTemplate = templates.templates.find((t) => t.testDefinitionId === testDefinitionId);
  const latestVersion = existingTemplate?.versions.reduce<
    (typeof existingTemplate.versions)[number] | undefined
  >((latest, version) => (!latest || version.version > latest.version ? version : latest), undefined);

  if (!isQa) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to design report templates.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{test.displayName}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {existingTemplate
            ? `Editing on top of version ${latestVersion?.version} (${latestVersion?.status}).`
            : 'No report template exists yet for this test — design and save the first version.'}
        </p>
      </div>
      <ReportTemplateDesigner
        testDefinitionId={testDefinitionId}
        templateId={existingTemplate?.id ?? null}
        initialDefinition={latestVersion?.definition ?? { sections: [] }}
        analyteOptions={analyteOptions}
      />
    </div>
  );
}
