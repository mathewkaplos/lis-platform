'use client';

import { useActionState, useState } from 'react';
import {
  ANALYTE_BOUND_FIELD_TYPES,
  TEMPLATE_FIELD_TYPES,
  conditionNodeSchema,
  type ReportTemplateDefinition,
  type TemplateFieldDefinition,
  type TemplateFieldType,
  type TemplateSectionDefinition,
} from '@lis/domain';
import { Button, Card, CardContent, CardHeader, CardTitle, Checkbox, FormField, Input } from '@lis/ui';
import { publishReportTemplateVersion, saveReportTemplate } from './actions';
import { ReportTemplatePreview, type PreviewAnalyteOption } from './preview';
import { publishVersionInitialState, saveTemplateInitialState } from './types';

const SELECT_CLASSNAME =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
const TEXTAREA_CLASSNAME =
  'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 font-mono';

// Table/richText fields can never carry a visibilityCondition
// (report-template-guardrails.ts's own rejection) -- the control simply
// isn't rendered for those two types, giving fast client-side feedback by
// construction rather than by a separate check (proposal AC #3).
const CONDITIONABLE_TYPES: readonly TemplateFieldType[] = ['numeric', 'coded', 'referenceRangeDisplay'];

function emptyField(): TemplateFieldDefinition {
  return { key: '', label: '', type: 'numeric', analyteBinding: undefined };
}

function emptySection(): TemplateSectionDefinition {
  return { title: '', fields: [emptyField()] };
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/**
 * FEAT-047 (docs/plans/feat-047-visual-report-designer-v1.md; ADR-0042).
 * The section/field canvas's own local-state tree -- nothing is persisted
 * until "Save," which submits the whole tree as one JSON `definition`
 * hidden field (§5's own "no update-draft endpoint" design). Reordering is
 * up/down buttons, not a drag-and-drop library -- ADR-0042's "structured
 * canvas" scope, and the only reorder mechanism that's keyboard-operable
 * for free (proposal §8's own manual test plan requires keyboard-only
 * add-and-reorder).
 */
export function ReportTemplateDesigner({
  testDefinitionId,
  templateId: initialTemplateId,
  initialDefinition,
  analyteOptions,
}: {
  testDefinitionId: string;
  templateId: string | null;
  initialDefinition: ReportTemplateDefinition;
  analyteOptions: PreviewAnalyteOption[];
}) {
  const [definition, setDefinition] = useState<ReportTemplateDefinition>(initialDefinition);
  const [templateId, setTemplateId] = useState<string | null>(initialTemplateId);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [conditionErrors, setConditionErrors] = useState<Record<string, string>>({});

  const [saveState, saveAction, savePending] = useActionState(
    saveReportTemplate,
    saveTemplateInitialState,
  );
  const [publishState, publishAction, publishPending] = useActionState(
    publishReportTemplateVersion,
    publishVersionInitialState,
  );

  // React's documented "adjust state during render when a dependency
  // changes" pattern (reference-ranges-table.tsx's own precedent) -- picks
  // up the new templateId/versionId the instant a save/publish succeeds, no
  // extra effect-triggered render pass.
  const [prevSaveState, setPrevSaveState] = useState(saveState);
  if (saveState !== prevSaveState) {
    setPrevSaveState(saveState);
    if (saveState.status === 'saved') {
      if (saveState.savedTemplate) {
        setTemplateId(saveState.savedTemplate.id);
        const latest = saveState.savedTemplate.versions.at(-1);
        setVersionId(latest?.id ?? null);
      } else if (saveState.savedVersion) {
        setVersionId(saveState.savedVersion.id);
      }
    }
  }
  const [prevPublishState, setPrevPublishState] = useState(publishState);
  if (publishState !== prevPublishState) {
    setPrevPublishState(publishState);
  }

  function updateSection(index: number, patch: Partial<TemplateSectionDefinition>) {
    setDefinition((prev) => ({
      sections: prev.sections.map((section, i) => (i === index ? { ...section, ...patch } : section)),
    }));
  }

  function addSection() {
    setDefinition((prev) => ({ sections: [...prev.sections, emptySection()] }));
  }

  function removeSection(index: number) {
    setDefinition((prev) => ({ sections: prev.sections.filter((_, i) => i !== index) }));
  }

  function moveSection(index: number, direction: -1 | 1) {
    setDefinition((prev) => ({ sections: moveItem(prev.sections, index, direction) }));
  }

  function updateField(
    sectionIndex: number,
    fieldIndex: number,
    patch: Partial<TemplateFieldDefinition>,
  ) {
    setDefinition((prev) => ({
      sections: prev.sections.map((section, si) => {
        if (si !== sectionIndex) return section;
        return {
          ...section,
          fields: section.fields.map((field, fi) => (fi === fieldIndex ? { ...field, ...patch } : field)),
        };
      }),
    }));
  }

  function changeFieldType(sectionIndex: number, fieldIndex: number, type: TemplateFieldType) {
    // Reset type-specific properties on change -- keeps stale, no-longer-
    // relevant data (e.g. an old analyteBinding after switching to
    // richText) out of the submitted definition, rather than relying on
    // the server to silently ignore it.
    updateField(sectionIndex, fieldIndex, {
      type,
      analyteBinding: undefined,
      analyteBindings: undefined,
      content: undefined,
      visibilityCondition: undefined,
    });
  }

  function addField(sectionIndex: number) {
    setDefinition((prev) => ({
      sections: prev.sections.map((section, i) =>
        i === sectionIndex ? { ...section, fields: [...section.fields, emptyField()] } : section,
      ),
    }));
  }

  function removeField(sectionIndex: number, fieldIndex: number) {
    setDefinition((prev) => ({
      sections: prev.sections.map((section, i) =>
        i === sectionIndex
          ? { ...section, fields: section.fields.filter((_, fi) => fi !== fieldIndex) }
          : section,
      ),
    }));
  }

  function moveField(sectionIndex: number, fieldIndex: number, direction: -1 | 1) {
    setDefinition((prev) => ({
      sections: prev.sections.map((section, i) =>
        i === sectionIndex ? { ...section, fields: moveItem(section.fields, fieldIndex, direction) } : section,
      ),
    }));
  }

  function toggleTableAnalyte(sectionIndex: number, fieldIndex: number, analyteId: string, checked: boolean) {
    const section = definition.sections[sectionIndex];
    const field = section.fields[fieldIndex];
    const current = field.analyteBindings ?? [];
    const next = checked ? [...current, analyteId] : current.filter((id) => id !== analyteId);
    updateField(sectionIndex, fieldIndex, { analyteBindings: next });
  }

  function updateVisibilityCondition(sectionIndex: number, fieldIndex: number, raw: string) {
    const errorKey = `${sectionIndex}-${fieldIndex}`;
    if (raw.trim().length === 0) {
      updateField(sectionIndex, fieldIndex, { visibilityCondition: undefined });
      setConditionErrors((prev) => withoutKey(prev, errorKey));
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      setConditionErrors((prev) => ({ ...prev, [errorKey]: 'Not valid JSON.' }));
      return;
    }
    const parsed = conditionNodeSchema.safeParse(parsedJson);
    if (!parsed.success) {
      setConditionErrors((prev) => ({ ...prev, [errorKey]: 'Does not match the condition-tree shape.' }));
      return;
    }
    setConditionErrors((prev) => withoutKey(prev, errorKey));
    updateField(sectionIndex, fieldIndex, { visibilityCondition: parsed.data });
  }

  // Fast client-side feedback for the one guardrail rule cheap enough to
  // mirror here without duplicating the server's own tree-walk (proposal
  // AC #3) -- an analyte-bound field type with no binding selected. The
  // out-of-set-analyte half of that guardrail is prevented by construction
  // (the picker below only ever lists `analyteOptions`, this test's own
  // bound set); the server (`report-template-guardrails.ts`) stays the
  // real, non-bypassable check either way.
  const missingBindingCount = definition.sections
    .flatMap((section) => section.fields)
    .filter(
      (field) =>
        ANALYTE_BOUND_FIELD_TYPES.includes(field.type) && !field.analyteBinding,
    ).length;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        {saveState.status === 'error' && saveState.formError ? (
          <p role="alert" className="text-sm text-danger">
            {saveState.formError}
          </p>
        ) : null}
        {saveState.status === 'saved' ? (
          <p role="status" className="text-sm text-success">
            Saved as version {saveState.savedTemplate?.versions.at(-1)?.version ?? saveState.savedVersion?.version}.
          </p>
        ) : null}
        {publishState.status === 'error' && publishState.formError ? (
          <p role="alert" className="text-sm text-danger">
            {publishState.formError}
          </p>
        ) : null}
        {publishState.status === 'published' ? (
          <p role="status" className="text-sm text-success">
            Published version {publishState.publishedVersion?.version}.
          </p>
        ) : null}
        {missingBindingCount > 0 ? (
          <p role="alert" className="text-sm text-danger">
            {missingBindingCount} field(s) still need an analyte binding before this can be
            published.
          </p>
        ) : null}
        {Object.keys(conditionErrors).length > 0 ? (
          <p role="alert" className="text-sm text-danger">
            One or more visibility conditions are invalid — fix them before saving.
          </p>
        ) : null}

        {definition.sections.map((section, sectionIndex) => (
          <Card key={sectionIndex}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <div className="flex-1">
                <FormField id={`section-${sectionIndex}-title`} label="Section title" required>
                  <Input
                    value={section.title}
                    onChange={(e) => updateSection(sectionIndex, { title: e.target.value })}
                    placeholder="e.g. Chemistry results"
                  />
                </FormField>
              </div>
              <div className="flex gap-1 pt-6">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Move section up"
                  disabled={sectionIndex === 0}
                  onClick={() => moveSection(sectionIndex, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Move section down"
                  disabled={sectionIndex === definition.sections.length - 1}
                  onClick={() => moveSection(sectionIndex, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Remove section"
                  disabled={definition.sections.length === 1}
                  onClick={() => removeSection(sectionIndex)}
                >
                  ✕
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {section.fields.map((field, fieldIndex) => {
                const errorKey = `${sectionIndex}-${fieldIndex}`;
                return (
                  <div
                    key={fieldIndex}
                    className="flex flex-col gap-3 rounded-md border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid flex-1 grid-cols-2 gap-3">
                        <FormField id={`${errorKey}-key`} label="Key" required>
                          <Input
                            value={field.key}
                            onChange={(e) => updateField(sectionIndex, fieldIndex, { key: e.target.value })}
                            placeholder="e.g. glucose"
                          />
                        </FormField>
                        <FormField id={`${errorKey}-label`} label="Label" required>
                          <Input
                            value={field.label}
                            onChange={(e) => updateField(sectionIndex, fieldIndex, { label: e.target.value })}
                            placeholder="e.g. Glucose"
                          />
                        </FormField>
                      </div>
                      <div className="flex gap-1 pt-6">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label="Move field up"
                          disabled={fieldIndex === 0}
                          onClick={() => moveField(sectionIndex, fieldIndex, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label="Move field down"
                          disabled={fieldIndex === section.fields.length - 1}
                          onClick={() => moveField(sectionIndex, fieldIndex, 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label="Remove field"
                          disabled={section.fields.length === 1}
                          onClick={() => removeField(sectionIndex, fieldIndex)}
                        >
                          ✕
                        </Button>
                      </div>
                    </div>

                    <FormField id={`${errorKey}-type`} label="Type" required>
                      <select
                        id={`${errorKey}-type`}
                        value={field.type}
                        onChange={(e) =>
                          changeFieldType(sectionIndex, fieldIndex, e.target.value as TemplateFieldType)
                        }
                        className={SELECT_CLASSNAME}
                      >
                        {TEMPLATE_FIELD_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </FormField>

                    {ANALYTE_BOUND_FIELD_TYPES.includes(field.type) ? (
                      <FormField
                        id={`${errorKey}-analyteBinding`}
                        label="Bound analyte"
                        required
                        errorText={!field.analyteBinding ? 'Required for this field type.' : undefined}
                      >
                        <select
                          id={`${errorKey}-analyteBinding`}
                          value={field.analyteBinding ?? ''}
                          onChange={(e) =>
                            updateField(sectionIndex, fieldIndex, {
                              analyteBinding: e.target.value || undefined,
                            })
                          }
                          className={SELECT_CLASSNAME}
                        >
                          <option value="">Select an analyte…</option>
                          {analyteOptions.map((analyte) => (
                            <option key={analyte.id} value={analyte.id}>
                              {analyte.display}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    ) : null}

                    {field.type === 'table' ? (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium text-foreground">
                          Bound analytes <span className="text-danger">*</span>
                        </span>
                        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-md border border-input p-3">
                          {analyteOptions.map((analyte) => (
                            <label key={analyte.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={(field.analyteBindings ?? []).includes(analyte.id)}
                                onCheckedChange={(checked) =>
                                  toggleTableAnalyte(sectionIndex, fieldIndex, analyte.id, checked === true)
                                }
                              />
                              <span>{analyte.display}</span>
                            </label>
                          ))}
                        </div>
                        {(field.analyteBindings ?? []).length === 0 ? (
                          <p className="text-xs text-danger">At least one analyte is required.</p>
                        ) : null}
                      </div>
                    ) : null}

                    {field.type === 'richText' ? (
                      <FormField id={`${errorKey}-content`} label="Content">
                        <textarea
                          id={`${errorKey}-content`}
                          value={field.content ?? ''}
                          onChange={(e) =>
                            updateField(sectionIndex, fieldIndex, { content: e.target.value })
                          }
                          rows={3}
                          className={TEXTAREA_CLASSNAME}
                        />
                      </FormField>
                    ) : null}

                    {CONDITIONABLE_TYPES.includes(field.type) ? (
                      <FormField
                        id={`${errorKey}-condition`}
                        label="Visibility condition (JSON, optional)"
                        helperText='e.g. {"field":"isCritical","op":"eq","value":true}'
                        errorText={conditionErrors[errorKey]}
                      >
                        <textarea
                          // `key` (not just `id`) includes the field's own
                          // committed condition -- fields have no stable
                          // identity across a reorder (index-keyed rows,
                          // ADR-0042's own "no library" scope), so an
                          // uncontrolled defaultValue would otherwise keep
                          // showing the *previous* occupant's stale text
                          // after a move-up/move-down swap even though the
                          // underlying data moved correctly. This key
                          // forces a fresh mount (and a fresh defaultValue
                          // read) whenever the field now at this position
                          // has a different condition than what's on
                          // screen.
                          key={`${errorKey}-${JSON.stringify(field.visibilityCondition ?? null)}`}
                          id={`${errorKey}-condition`}
                          defaultValue={
                            field.visibilityCondition
                              ? JSON.stringify(field.visibilityCondition, null, 2)
                              : ''
                          }
                          onBlur={(e) => updateVisibilityCondition(sectionIndex, fieldIndex, e.target.value)}
                          rows={3}
                          className={TEXTAREA_CLASSNAME}
                        />
                      </FormField>
                    ) : null}
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={() => addField(sectionIndex)}>
                Add field
              </Button>
            </CardContent>
          </Card>
        ))}

        <Button type="button" variant="outline" onClick={addSection}>
          Add section
        </Button>

        <div className="flex gap-2">
          <form action={saveAction}>
            <input type="hidden" name="testDefinitionId" value={testDefinitionId} />
            <input type="hidden" name="templateId" value={templateId ?? ''} />
            <input type="hidden" name="definition" value={JSON.stringify(definition)} />
            <Button
              type="submit"
              disabled={savePending || Object.keys(conditionErrors).length > 0}
            >
              {savePending ? 'Saving…' : 'Save as new version'}
            </Button>
          </form>
          <form action={publishAction}>
            <input type="hidden" name="templateId" value={templateId ?? ''} />
            <input type="hidden" name="versionId" value={versionId ?? ''} />
            <Button type="submit" variant="outline" disabled={publishPending || !versionId}>
              {publishPending ? 'Publishing…' : 'Publish'}
            </Button>
          </form>
        </div>
      </div>

      <div className="flex-1">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportTemplatePreview definition={definition} analyteOptions={analyteOptions} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
