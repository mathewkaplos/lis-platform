import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';
import { StatCard } from '@lis/ui';
import { TrendChart } from './trend-chart';

/**
 * FEAT-039's own AC: "a patient can view their own verified results and
 * trends, gated by the configured release policy." Consumes
 * `GET /v1/portal/results` directly -- the API itself is the actual
 * enforcement point (own-identity resolution + release-policy gate, KB-10's
 * "server decides"); this page only renders whatever it returns.
 */
export default async function PortalResultsPage() {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.GET('/v1/portal/results');
  // Issue #751: a thrown Error's message is redacted by Next.js in a real
  // production build (confirmed live via CI, not assumed) -- return early
  // instead, matching admin/users/page.tsx's own proven pattern.
  if (response.status === 403) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-1 rounded-md border border-border bg-surface text-center">
        <p role="alert" className="text-sm text-text-secondary">
          You do not have permission to view results.
        </p>
      </div>
    );
  }
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading your results. Please try again.');
  }

  if (data.analytes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-1 rounded-md border border-border bg-surface text-center">
        <p className="text-sm text-text-secondary">No results are available yet.</p>
        <p className="text-xs text-text-muted">
          Results appear here once they&apos;ve been verified and released.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.analytes.map((a) => (
          <StatCard
            key={a.analyteId}
            label={a.analyteDisplay}
            value={`${a.latest.value} ${a.latest.unit}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-8">
        {data.analytes.map((a) => (
          <section key={a.analyteId} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-foreground">{a.analyteDisplay}</h2>
            <TrendChart analyteDisplay={a.analyteDisplay} points={a.trend} />
          </section>
        ))}
      </div>
    </div>
  );
}
