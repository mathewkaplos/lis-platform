'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Catalog } from '@lis/domain';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  FormField,
  Input,
  Label,
} from '@lis/ui';
import { createOrder } from './actions';
import { createOrderInitialState } from './types';

/**
 * TASK-043 (FEAT-012 proposal §5). Catalog search is client-side text
 * filtering, not a server round trip -- real catalogs at this milestone are
 * small (the seeded CMP panel has 14 tests). No discipline grouping,
 * favorites, or recently-ordered (none has a backing column/table). No
 * duplicate-active-order warning, "save draft", or "print labels" (proposal
 * §5 -- none has supporting AC/data).
 */
export function OrderBuilderForm({ patientId, catalog }: { patientId: string; catalog: Catalog }) {
  const [state, formAction, pending] = useActionState(createOrder, createOrderInitialState);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [selectedPanelIds, setSelectedPanelIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  const testsById = useMemo(() => new Map(catalog.tests.map((t) => [t.id, t])), [catalog.tests]);

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredPanels = catalog.panels.filter(
    (p) =>
      p.displayName.toLowerCase().includes(normalizedFilter) ||
      p.code.toLowerCase().includes(normalizedFilter),
  );
  const filteredTests = catalog.tests.filter(
    (t) =>
      t.displayName.toLowerCase().includes(normalizedFilter) ||
      t.code.toLowerCase().includes(normalizedFilter),
  );

  function togglePanel(panelId: string) {
    setSelectedPanelIds((prev) => {
      const next = new Set(prev);
      if (next.has(panelId)) {
        next.delete(panelId);
      } else {
        next.add(panelId);
      }
      return next;
    });
  }

  function toggleTest(testId: string) {
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(testId)) {
        next.delete(testId);
      } else {
        next.add(testId);
      }
      return next;
    });
  }

  // Client-side preview only -- the server independently expands panels and
  // dedupes for real (order.controller.ts §5); this is just what the
  // summary list shows before submit.
  const summaryTestIds = useMemo(() => {
    const ids = new Set(selectedTestIds);
    for (const panelId of selectedPanelIds) {
      const panel = catalog.panels.find((p) => p.id === panelId);
      panel?.testDefinitionIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [selectedTestIds, selectedPanelIds, catalog.panels]);

  if (state.status === 'created') {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Order placed</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">
            {state.createdTestCount} {state.createdTestCount === 1 ? 'test' : 'tests'} ordered.
          </p>
          <Button asChild className="w-fit">
            <Link href={`/patients/${patientId}`}>Back to patient</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasSelection = summaryTestIds.size > 0;
  const catalogIsEmpty = catalog.tests.length === 0 && catalog.panels.length === 0;

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="testDefinitionIds" value={JSON.stringify([...selectedTestIds])} />
      <input type="hidden" name="panelIds" value={JSON.stringify([...selectedPanelIds])} />

      <Card>
        <CardHeader>
          <CardTitle>Test catalog</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input
            type="search"
            placeholder="Filter by name or code"
            aria-label="Filter catalog"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          {catalogIsEmpty ? (
            <p className="text-sm text-text-secondary">
              No tests or panels are configured for this tenant yet.
            </p>
          ) : (
            <>
              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">Panels</h3>
                {filteredPanels.length === 0 ? (
                  <p className="text-sm text-text-secondary">No panels match this filter.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {filteredPanels.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`panel-${p.id}`}
                          checked={selectedPanelIds.has(p.id)}
                          onCheckedChange={() => togglePanel(p.id)}
                        />
                        <Label htmlFor={`panel-${p.id}`} className="flex-1 cursor-pointer">
                          {p.displayName}{' '}
                          <span className="font-mono text-xs text-text-secondary">{p.code}</span>
                        </Label>
                        <Badge variant="outline">{p.testDefinitionIds.length} tests</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium text-foreground">Individual tests</h3>
                {filteredTests.length === 0 ? (
                  <p className="text-sm text-text-secondary">No tests match this filter.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {filteredTests.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`test-${t.id}`}
                          checked={selectedTestIds.has(t.id)}
                          onCheckedChange={() => toggleTest(t.id)}
                        />
                        <Label htmlFor={`test-${t.id}`} className="flex-1 cursor-pointer">
                          {t.displayName}{' '}
                          <span className="font-mono text-xs text-text-secondary">{t.code}</span>
                        </Label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Order summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.status === 'error' && state.formError ? (
            <p role="alert" className="text-sm text-danger">
              {state.formError}
            </p>
          ) : null}

          <FormField id="priority" label="Priority">
            <select
              id="priority"
              name="priority"
              defaultValue="routine"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="routine">Routine</option>
              <option value="stat">STAT</option>
            </select>
          </FormField>

          {hasSelection ? (
            <ul className="flex flex-col gap-1 text-sm text-foreground">
              {[...summaryTestIds].map((id) => (
                <li key={id}>{testsById.get(id)?.displayName ?? id}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">No tests selected yet.</p>
          )}

          <Button type="submit" disabled={pending || !hasSelection}>
            {pending
              ? 'Placing order…'
              : `Place order${hasSelection ? ` (${summaryTestIds.size})` : ''}`}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
