import Link from 'next/link';
import { Badge } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

/**
 * FEAT-047 (docs/plans/feat-047-visual-report-designer-v1.md). One row per
 * test with a template (draft/published version badges), mirroring
 * `admin/tests/page.tsx`'s own `hasQaRole`-gated, server-fetched-list
 * shape -- but read-only here (no gating needed: browsing which tests have
 * templates is informational, matching `GET /v1/report-templates`'s own
 * ungated read, `report-template.controller.ts`'s header comment). The
 * per-test designer route (`[testDefinitionId]/page.tsx`) is where the
 * `qa`-only write actions live.
 */
export default async function ReportTemplatesAdminPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const [
    { data: catalog, response: catalogResponse },
    { data: templates, response: templatesResponse },
  ] = await Promise.all([client.GET('/v1/catalog'), client.GET('/v1/report-templates')]);
  if (!catalogResponse.ok || !catalog) {
    throw new Error('Something went wrong loading the test catalog. Please try again.');
  }
  if (!templatesResponse.ok || !templates) {
    throw new Error('Something went wrong loading report templates. Please try again.');
  }

  const templateByTestId = new Map(templates.templates.map((t) => [t.testDefinitionId, t]));

  const rows = catalog.tests
    .map((test) => {
      const template = templateByTestId.get(test.id);
      const publishedVersion = template?.versions.find((v) => v.status === 'published');
      const draftVersion = template?.versions
        .filter((v) => v.status === 'draft')
        .reduce<(typeof template.versions)[number] | undefined>(
          (latest, version) => (!latest || version.version > latest.version ? version : latest),
          undefined,
        );
      return { test, publishedVersion, draftVersion };
    })
    .sort((a, b) => a.test.displayName.localeCompare(b.test.displayName));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Report templates</h1>
        <p className="mt-1 text-sm text-text-secondary">
          One report layout per test, versioned. Pick a test to design or edit its template.
        </p>
      </div>
      <div className="flex flex-col divide-y divide-border rounded-md border border-border">
        {rows.map(({ test, publishedVersion, draftVersion }) => (
          <Link
            key={test.id}
            href={`/admin/report-templates/${test.id}`}
            className="flex items-center justify-between gap-4 p-3 text-sm hover:bg-accent"
          >
            <div>
              <span className="font-medium text-foreground">{test.displayName}</span>{' '}
              <span className="text-text-secondary">({test.code})</span>
            </div>
            <div className="flex gap-2">
              {publishedVersion ? (
                <Badge variant="outline">published v{publishedVersion.version}</Badge>
              ) : null}
              {draftVersion ? <Badge variant="secondary">draft v{draftVersion.version}</Badge> : null}
              {!publishedVersion && !draftVersion ? (
                <Badge variant="outline">no template</Badge>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
