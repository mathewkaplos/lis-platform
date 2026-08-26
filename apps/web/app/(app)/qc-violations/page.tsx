import { getSession } from '@/auth/get-session';
import { hasQaRole } from '@/auth/roles';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { ViolationsTable, type ViolationRow } from './violations-table';

/**
 * TASK-070 (FEAT-020, ADR-0019, proposal §10 Q2). The minimal violation-list
 * screen this feature's own resolve action needs a way to be reached from --
 * folding in issue #381 (no control-lot list/QC dashboard screen existed
 * before this). Deliberately minimal: an unresolved-only queue with a
 * Resolve button, not a full QC dashboard (ADR-0019's own explicit framing) --
 * no filters, no history view, no per-lot drill-down beyond a link to the
 * existing Levey-Jennings chart (TASK-069).
 *
 * Analyte display names are resolved client-side against `/v1/catalog`,
 * fetched alongside the violation list here -- the same "no joined display
 * name in the API response" precedent `control-lots/[id]/chart/page.tsx`
 * already established, reused rather than duplicated into a second endpoint.
 */
export default async function QcViolationsPage() {
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

  const [{ data: violations, response: violationsResponse }, { data: catalog, response: catalogResponse }] =
    await Promise.all([
      client.GET('/v1/qc-rule-violations', { params: { query: { resolved: 'false' } } }),
      client.GET('/v1/catalog'),
    ]);
  if (!violationsResponse.ok || !violations) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p role="alert" className="text-sm text-text-secondary">
          Something went wrong loading QC violations. Please try again.
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

  const analytesById = new Map(
    catalog.tests.flatMap((test) => test.analytes).map((analyte) => [analyte.id, analyte]),
  );

  const rows: ViolationRow[] = violations.map((violation) => ({
    id: violation.id,
    controlLotId: violation.controlLotId,
    analyteId: violation.analyteId,
    analyteDisplay: analytesById.get(violation.analyteId)?.display ?? 'Unknown analyte',
    ruleCode: violation.ruleCode,
    severity: violation.severity,
    detectedAt: violation.detectedAt,
  }));

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">QC violations</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Unresolved Westgard rule violations. A rejection-severity violation blocks patient result
          release for its analyte until resolved (ADR-0019).
        </p>
      </div>
      <ViolationsTable isQa={isQa} initialRows={rows} />
    </div>
  );
}
