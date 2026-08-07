'use client';

import { useRouter } from 'next/navigation';
import { FilterBar, type FilterChip } from '@lis/ui';

/**
 * TASK-062 (FEAT-017 revision): `FilterBar`'s first real consumer anywhere
 * in `apps/web` (proposal finding #2 -- previously used only in its own
 * Storybook story). A small client island purely to own `onRemove`/
 * `onClearAll`'s callback shape; the worklist page itself stays a Server
 * Component (§10 Q4, approved) driven by URL `searchParams`.
 */
export function ActiveFilters({
  stage,
  priority,
  createdFrom,
  createdTo,
}: {
  stage?: string;
  priority?: string;
  createdFrom?: string;
  createdTo?: string;
}) {
  const router = useRouter();

  const filters: FilterChip[] = [];
  if (priority) filters.push({ id: 'priority', label: `Priority: ${priority}` });
  if (createdFrom) filters.push({ id: 'createdFrom', label: `From: ${createdFrom}` });
  if (createdTo) filters.push({ id: 'createdTo', label: `To: ${createdTo}` });

  if (filters.length === 0) return null;

  function navigate(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { stage, priority, createdFrom, createdTo, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  }

  return (
    <FilterBar
      filters={filters}
      onRemove={(id) => navigate({ [id]: undefined })}
      onClearAll={() =>
        navigate({ priority: undefined, createdFrom: undefined, createdTo: undefined })
      }
    />
  );
}
