import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button, Card, CardContent, CardHeader, CardTitle, StatCard } from '@lis/ui';
import { getValidAccessToken } from '@/auth/access-token';
import { getSession } from '@/auth/get-session';
import { hasTechnologistRole } from '@/auth/roles';
import { createLisApiClient } from '@/lib/api-client';
import { ActiveFilters } from './active-filters';
import { WorklistView } from './worklist-view';

// FEAT-048 (ADR-0043): `labelKey` looks up the tab's label in the
// `Dashboard` message namespace -- 'all'/'pending'/'inProgress'/'verified'.
const STAGE_TABS = [
  { key: undefined, labelKey: 'all' },
  { key: 'pending', labelKey: 'pending' },
  { key: 'in_progress', labelKey: 'inProgress' },
  { key: 'verified', labelKey: 'verified' },
] as const;

/**
 * TASK-062 (FEAT-017 revision, docs/plans/feat-017-minimal-worklist.md):
 * replaces the placeholder "Signed in" screen -- the technologist's real
 * home screen, per FEAT-017's own issue text and §10 Q1 (approved). Server
 * Component driven by URL `searchParams` (§10 Q4, approved), same
 * convention as `orders/page.tsx`/`patients/page.tsx`. The 3 `StatCard`s
 * double as stage-tab controls (proposal §5) -- `GET /v1/worklist`'s own
 * `counts` field, always computed against the tenant's full active set
 * regardless of the current filter (TASK-061 proposal §10 Q1).
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    stage?: string;
    priority?: string;
    createdFrom?: string;
    createdTo?: string;
  }>;
}) {
  const { stage, priority, createdFrom, createdTo } = await searchParams;
  const normalizedStage = stage
    ? (stage as 'pending' | 'in_progress' | 'verified')
    : undefined;
  const normalizedPriority = priority ? (priority as 'routine' | 'stat') : undefined;

  const [t, format] = await Promise.all([getTranslations('Dashboard'), getFormatter()]);
  const [accessToken, session] = await Promise.all([getValidAccessToken(), getSession()]);
  if (!accessToken) {
    throw new Error('Your session has expired — please log in again.');
  }
  const client = createLisApiClient(accessToken);
  // FEAT-022 Part 2: gates the bulk-select checkboxes/bulk-action bar
  // entirely -- manage_orders (the real API-level gate on both bulk routes)
  // is granted only to `technologist`, matching `isVerifier`'s own "hidden
  // entirely, not just disabled" precedent (TASK-057 §10 Q3).
  const canManageOrders = hasTechnologistRole(session);

  const { data, response } = await client.GET('/v1/worklist', {
    params: {
      query: {
        stage: normalizedStage,
        priority: normalizedPriority,
        createdFrom: createdFrom ? `${createdFrom}T00:00:00.000Z` : undefined,
        createdTo: createdTo ? `${createdTo}T23:59:59.999Z` : undefined,
      },
    },
  });
  if (!response.ok || !data) {
    throw new Error('Something went wrong loading the worklist. Please try again.');
  }

  function filterHref(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const merged = { stage, priority, createdFrom, createdTo, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/?${qs}` : '/';
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-foreground">{t('title')}</h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link
          href={filterHref({ stage: 'pending' })}
          aria-label={`Filter to ${t('pending')}, ${data.counts.pending} items`}
          className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label={t('pending')}
            value={format.number(data.counts.pending)}
            className={normalizedStage === 'pending' ? 'ring-2 ring-ring' : undefined}
          />
        </Link>
        <Link
          href={filterHref({ stage: 'in_progress' })}
          aria-label={`Filter to ${t('inProgress')}, ${data.counts.inProgress} items`}
          className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label={t('inProgress')}
            value={format.number(data.counts.inProgress)}
            className={normalizedStage === 'in_progress' ? 'ring-2 ring-ring' : undefined}
          />
        </Link>
        <Link
          href={filterHref({ stage: 'verified' })}
          aria-label={`Filter to ${t('verified')}, ${data.counts.verified} items`}
          className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatCard
            label={t('verified')}
            value={format.number(data.counts.verified)}
            className={normalizedStage === 'verified' ? 'ring-2 ring-ring' : undefined}
          />
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Worklist stage">
        {STAGE_TABS.map((tab) => (
          <Button
            key={tab.labelKey}
            asChild
            variant={normalizedStage === tab.key ? 'default' : 'outline'}
            size="sm"
          >
            <Link
              href={filterHref({ stage: tab.key })}
              role="tab"
              aria-selected={normalizedStage === tab.key}
            >
              {t(tab.labelKey)}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('filters')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form className="flex flex-wrap items-end gap-3" action="/">
            {stage ? <input type="hidden" name="stage" value={stage} /> : null}
            <label className="flex flex-col gap-1 text-sm">
              {t('priority')}
              <select
                name="priority"
                defaultValue={priority ?? ''}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="">{t('any')}</option>
                <option value="routine">{t('routine')}</option>
                <option value="stat">{t('stat')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('from')}
              <input
                type="date"
                name="createdFrom"
                defaultValue={createdFrom}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('to')}
              <input
                type="date"
                name="createdTo"
                defaultValue={createdTo}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </label>
            <Button type="submit">{t('apply')}</Button>
          </form>
          <ActiveFilters
            stage={stage}
            priority={priority}
            createdFrom={createdFrom}
            createdTo={createdTo}
          />
        </CardContent>
      </Card>

      <WorklistView
        items={data.items}
        canManageOrders={canManageOrders}
        currentUserId={session?.sub}
      />
    </div>
  );
}
