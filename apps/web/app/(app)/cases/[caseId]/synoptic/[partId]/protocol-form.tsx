'use client';

import { useActionState, useMemo, useState, type FormEvent } from 'react';
import { evaluateCondition, type ConditionNode, type SynopticElement } from '@lis/domain';
import { Button, FormField } from '@lis/ui';
import { recordSynopticResponse } from './actions';
import { recordSynopticResponseInitialState } from './types';

type ResponseValue = string | number | string[];

/**
 * Issue #642 (proposal §3.2/§3.3). A generic protocol renderer: walks
 * whatever `parentElementId` tree the backend returns, live-evaluating each
 * element's own `visibilityCondition` (the exact same `evaluateCondition`
 * apps/api's recorder uses authoritatively -- proposal §5.1) against the
 * in-progress answers. None of the three real seeded protocols use
 * grouping today (every element is a sibling, proposal §3.2's own direct
 * finding from the seed SQL) -- `ElementGroup` still recurses generically so
 * a future grouped protocol version renders correctly with no code change.
 */
function ElementGroup({
  elements,
  parentId,
  context,
  values,
  onChange,
  onToggleMulti,
}: {
  elements: SynopticElement[];
  parentId: string | null;
  context: Record<string, unknown>;
  values: Record<string, ResponseValue>;
  onChange: (key: string, value: ResponseValue) => void;
  onToggleMulti: (key: string, optionValue: string, checked: boolean) => void;
}) {
  const children = elements
    .filter((e) => e.parentElementId === parentId)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="flex flex-col gap-4">
      {children.map((element) => {
        const hasChildren = elements.some((e) => e.parentElementId === element.id);
        const visible = element.visibilityCondition
          ? evaluateCondition(element.visibilityCondition as ConditionNode, context)
          : true;
        if (!visible) return null;

        // Issue #663: an element with children (e.g. margin_distance_mm,
        // parent of margin_distance_mm_precision) is still itself a real,
        // answerable field -- render its own control *and* recurse into its
        // children below it, rather than treating "has children" as "this
        // is a pure grouping header with nothing of its own to answer"
        // (the only shape any of the first five seeded protocols needed
        // until this issue's own precision-qualifier sibling).
        return (
          <div key={element.id} className={hasChildren ? 'flex flex-col gap-3 border-l-2 border-border pl-4' : undefined}>
            <FieldControl
              element={element}
              value={values[element.key]}
              onChange={onChange}
              onToggleMulti={onToggleMulti}
            />
            {hasChildren ? (
              <ElementGroup
                elements={elements}
                parentId={element.id}
                context={context}
                values={values}
                onChange={onChange}
                onToggleMulti={onToggleMulti}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function FieldControl({
  element,
  value,
  onChange,
  onToggleMulti,
}: {
  element: SynopticElement;
  value: ResponseValue | undefined;
  onChange: (key: string, value: ResponseValue) => void;
  onToggleMulti: (key: string, optionValue: string, checked: boolean) => void;
}) {
  // issue #645: a coded_multi element renders as a checkbox group, not a
  // <select> -- FormField's own single-child-element contract
  // (`children: React.ReactElement`) doesn't fit a group of checkboxes, so
  // this branch renders its own label instead of going through FormField.
  if (element.dataType === 'coded_multi') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-col gap-1.5" id={`element-${element.key}`}>
        <span className="text-sm font-medium text-foreground">
          {element.label}
          {element.requirement === 'required' ? (
            <span className="text-danger" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </span>
        <div className="flex flex-col gap-1">
          {element.responseOptions.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(e) => onToggleMulti(element.key, option.value, e.target.checked)}
              />
              {option.display}
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <FormField
      id={`element-${element.key}`}
      label={element.label}
      required={element.requirement === 'required'}
    >
      {element.dataType === 'coded' ? (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(element.key, e.target.value)}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">— Select —</option>
          {element.responseOptions.map((option) => (
            <option key={option.id} value={option.value}>
              {option.display}
            </option>
          ))}
        </select>
      ) : element.dataType === 'quantity' ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) =>
              onChange(element.key, e.target.value === '' ? '' : Number(e.target.value))
            }
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {element.unitDisplay ? (
            <span className="text-sm text-text-secondary">{element.unitDisplay}</span>
          ) : null}
        </div>
      ) : (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(element.key, e.target.value)}
          className="rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      )}
    </FormField>
  );
}

export function ProtocolForm({
  caseId,
  orderedTestId,
  synopticProtocolVersionId,
  elements,
}: {
  caseId: string;
  orderedTestId: string;
  synopticProtocolVersionId: string;
  elements: SynopticElement[];
}) {
  const [state, formAction, pending] = useActionState(
    recordSynopticResponse,
    recordSynopticResponseInitialState,
  );
  const [values, setValues] = useState<Record<string, ResponseValue>>({});

  const context = useMemo(() => values as Record<string, unknown>, [values]);

  function handleChange(key: string, value: ResponseValue) {
    setValues((prev) => {
      const next = { ...prev };
      if (value === '') {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }

  // issue #645: toggles one option in a coded_multi element's own selected
  // array. Deletes the key entirely once the last selection is unchecked,
  // matching handleChange's own "empty means unanswered" convention.
  function handleToggleMulti(key: string, optionValue: string, checked: boolean) {
    setValues((prev) => {
      const current = Array.isArray(prev[key]) ? (prev[key] as string[]) : [];
      const nextSelected = checked
        ? [...current, optionValue]
        : current.filter((v) => v !== optionValue);
      const next = { ...prev };
      if (nextSelected.length === 0) {
        delete next[key];
      } else {
        next[key] = nextSelected;
      }
      return next;
    });
  }

  function isVisible(element: SynopticElement): boolean {
    return element.visibilityCondition
      ? evaluateCondition(element.visibilityCondition as ConditionNode, context)
      : true;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Only currently-visible elements are submitted -- a value entered
    // while an element was visible, then hidden again by a later answer
    // change, must not be sent (proposal §3.3's own worked trace).
    const responses = elements
      .filter((element) => element.key in values && isVisible(element))
      .map((element) => ({ elementKey: element.key, value: values[element.key] }));

    formAction({ caseId, orderedTestId, synopticProtocolVersionId, responses });
  }

  if (state.status === 'done' && state.result) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">Synoptic protocol recorded.</p>
        <ul className="flex flex-col gap-1 text-sm text-text-secondary">
          {state.result.results.map((entry) => (
            <li key={entry.observationId}>
              {entry.elementLabel}: {Array.isArray(entry.value) ? entry.value.join(', ') : entry.value}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {state.status === 'error' && state.formError ? (
        <p role="alert" className="text-sm text-danger">
          {state.formError}
        </p>
      ) : null}
      <ElementGroup
        elements={elements}
        parentId={null}
        context={context}
        values={values}
        onChange={handleChange}
        onToggleMulti={handleToggleMulti}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Recording…' : 'Record synoptic protocol'}
      </Button>
    </form>
  );
}
