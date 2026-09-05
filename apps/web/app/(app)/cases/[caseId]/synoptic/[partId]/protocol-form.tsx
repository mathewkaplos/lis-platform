'use client';

import { useActionState, useMemo, useState, type FormEvent } from 'react';
import {
  evaluateCondition,
  makeInstanceResponseKey,
  requirementLabel,
  type ConditionNode,
  type SynopticElement,
} from '@lis/domain';
import { Button, FormField } from '@lis/ui';
import { recordSynopticResponse } from './actions';
import { formatResultValue } from './format-result-value';
import { countRequiredProgress } from './progress-count';
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
// Issue #666: this instance's own descendant answers (composite keys ending
// in `@instanceKey`), stripped back to plain element keys and merged over
// the top-level context -- lets a descendant's visibilityCondition
// reference a sibling within the same instance exactly like a non-repeating
// field references a top-level sibling (mirrors the recorder's own
// mergedContext, synoptic-response-recorder.ts).
function buildInstanceContext(
  topContext: Record<string, unknown>,
  values: Record<string, ResponseValue>,
  instanceKey: string,
): Record<string, unknown> {
  const suffix = `@${instanceKey}`;
  const local: Record<string, unknown> = { ...topContext };
  for (const [key, value] of Object.entries(values)) {
    if (key.endsWith(suffix)) {
      local[key.slice(0, -suffix.length)] = value;
    }
  }
  return local;
}

function ElementGroup({
  elements,
  parentId,
  context,
  values,
  onChange,
  onToggleMulti,
  sourceStandard,
  instances,
  onAddInstance,
  onRemoveInstance,
  instanceKey,
}: {
  elements: SynopticElement[];
  parentId: string | null;
  context: Record<string, unknown>;
  values: Record<string, ResponseValue>;
  onChange: (key: string, value: ResponseValue) => void;
  onToggleMulti: (key: string, optionValue: string, checked: boolean) => void;
  sourceStandard: string;
  instances: Record<string, string[]>;
  onAddInstance: (elementKey: string) => void;
  onRemoveInstance: (elementKey: string, instanceKey: string) => void;
  instanceKey?: string;
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

        // Issue #666: a repeatable element is a pure grouping header -- not
        // itself answerable -- whose children render once per instance,
        // each instance's answers addressed via a composite
        // `elementKey@instanceKey` (see makeInstanceResponseKey).
        if (element.repeatable) {
          const elementInstances = instances[element.key] ?? [];
          return (
            <div key={element.id} className="flex flex-col gap-3 border-l-2 border-border pl-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{element.label}</span>
                <Button type="button" variant="secondary" onClick={() => onAddInstance(element.key)}>
                  Add {element.label}
                </Button>
              </div>
              {elementInstances.map((instKey, index) => (
                <div key={instKey} className="flex flex-col gap-3 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase text-text-secondary">
                      {element.label} {index + 1}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveInstance(element.key, instKey)}
                    >
                      Remove
                    </Button>
                  </div>
                  <ElementGroup
                    elements={elements}
                    parentId={element.id}
                    context={buildInstanceContext(context, values, instKey)}
                    values={values}
                    onChange={onChange}
                    onToggleMulti={onToggleMulti}
                    sourceStandard={sourceStandard}
                    instances={instances}
                    onAddInstance={onAddInstance}
                    onRemoveInstance={onRemoveInstance}
                    instanceKey={instKey}
                  />
                </div>
              ))}
            </div>
          );
        }

        const compositeKey = instanceKey ? makeInstanceResponseKey(element.key, instanceKey) : element.key;
        const scopedOnChange = instanceKey
          ? (key: string, value: ResponseValue) => onChange(makeInstanceResponseKey(key, instanceKey), value)
          : onChange;
        const scopedOnToggleMulti = instanceKey
          ? (key: string, optionValue: string, checked: boolean) =>
              onToggleMulti(makeInstanceResponseKey(key, instanceKey), optionValue, checked)
          : onToggleMulti;

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
              value={values[compositeKey]}
              onChange={scopedOnChange}
              onToggleMulti={scopedOnToggleMulti}
              sourceStandard={sourceStandard}
            />
            {hasChildren ? (
              <ElementGroup
                elements={elements}
                parentId={element.id}
                context={context}
                values={values}
                onChange={onChange}
                onToggleMulti={onToggleMulti}
                sourceStandard={sourceStandard}
                instances={instances}
                onAddInstance={onAddInstance}
                onRemoveInstance={onRemoveInstance}
                instanceKey={instanceKey}
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
  sourceStandard,
}: {
  element: SynopticElement;
  value: ResponseValue | undefined;
  onChange: (key: string, value: ResponseValue) => void;
  onToggleMulti: (key: string, optionValue: string, checked: boolean) => void;
  sourceStandard: string;
}) {
  // Issue #664: 'required' and 'conditional' both enforce at submit time
  // (§5: a label distinction, not a new validation branch) -- only
  // 'recommended' renders with no asterisk. 'conditional' additionally
  // shows its own source-standard-aware tier label, since "required only
  // sometimes" is worth surfacing to whoever is filling the form in.
  const enforced = element.requirement !== 'recommended';
  const tierHint =
    element.requirement === 'conditional'
      ? ` (${requirementLabel(sourceStandard, element.requirement)})`
      : '';

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
          {enforced ? (
            <span className="text-danger" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
          {tierHint ? <span className="text-text-secondary">{tierHint}</span> : null}
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
      label={`${element.label}${tierHint}`}
      required={enforced}
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
  specimenId,
  synopticProtocolVersionId,
  elements,
  sourceStandard,
}: {
  caseId: string;
  orderedTestId: string;
  // Issue #674: the specimen (part) this recording belongs to.
  specimenId: string;
  synopticProtocolVersionId: string;
  elements: SynopticElement[];
  sourceStandard: string;
}) {
  const [state, formAction, pending] = useActionState(
    recordSynopticResponse,
    recordSynopticResponseInitialState,
  );
  const [values, setValues] = useState<Record<string, ResponseValue>>({});
  // Issue #666: repeatable element key -> ordered list of client-generated
  // instanceKeys (see makeInstanceResponseKey/parseInstanceResponseKey in
  // packages/domain -- continuity across re-recordings is by this
  // structural key, not by identity-field value, an explicit MVP limitation
  // documented in docs/plans/task-666-synoptic-repeating-groups.md).
  const [instances, setInstances] = useState<Record<string, string[]>>({});

  const context = useMemo(() => values as Record<string, unknown>, [values]);
  const elementByKey = useMemo(() => new Map(elements.map((e) => [e.key, e])), [elements]);
  // Issue #803: "what's left to fill in" / "what's blocking sign-out" had no
  // answer on this form beyond scrolling the whole list looking for
  // asterisks -- this is the smallest fix, a live count above the fields.
  const progress = useMemo(() => countRequiredProgress(elements, context), [elements, context]);

  function handleAddInstance(elementKey: string) {
    setInstances((prev) => ({
      ...prev,
      [elementKey]: [...(prev[elementKey] ?? []), crypto.randomUUID()],
    }));
  }

  function handleRemoveInstance(elementKey: string, instanceKey: string) {
    setInstances((prev) => ({
      ...prev,
      [elementKey]: (prev[elementKey] ?? []).filter((key) => key !== instanceKey),
    }));
    setValues((prev) => {
      const suffix = `@${instanceKey}`;
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.endsWith(suffix)) delete next[key];
      }
      return next;
    });
  }

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

  // Issue #666: `rawKey` may be a plain element key or a composite
  // `elementKey@instanceKey` -- resolves the underlying element and, for a
  // composite key, evaluates visibility against that instance's own merged
  // context (mirrors the recorder's own per-instance validation).
  function isVisibleForKey(rawKey: string): boolean {
    const atIndex = rawKey.indexOf('@');
    const baseKey = atIndex === -1 ? rawKey : rawKey.slice(0, atIndex);
    const instanceKey = atIndex === -1 ? null : rawKey.slice(atIndex + 1);
    const element = elementByKey.get(baseKey);
    if (!element || !element.visibilityCondition) return true;
    const evalContext = instanceKey ? buildInstanceContext(context, values, instanceKey) : context;
    return evaluateCondition(element.visibilityCondition as ConditionNode, evalContext);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Only currently-visible elements are submitted -- a value entered
    // while an element was visible, then hidden again by a later answer
    // change, must not be sent (proposal §3.3's own worked trace).
    const responses = Object.entries(values)
      .filter(([key]) => isVisibleForKey(key))
      .map(([key, value]) => ({ elementKey: key, value }));

    formAction({ caseId, orderedTestId, specimenId, synopticProtocolVersionId, responses });
  }

  if (state.status === 'done' && state.result) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">Synoptic protocol recorded.</p>
        <ul className="flex flex-col gap-1 text-sm text-text-secondary">
          {state.result.results.map((entry) => (
            <li key={entry.observationId}>
              {entry.elementLabel}: {formatResultValue(entry, elementByKey)}
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
      <p className="text-sm text-text-secondary">
        {progress.answered} of {progress.total} required fields answered
      </p>
      <ElementGroup
        elements={elements}
        parentId={null}
        context={context}
        values={values}
        onChange={handleChange}
        onToggleMulti={handleToggleMulti}
        sourceStandard={sourceStandard}
        instances={instances}
        onAddInstance={handleAddInstance}
        onRemoveInstance={handleRemoveInstance}
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Recording…' : 'Record synoptic protocol'}
      </Button>
    </form>
  );
}
