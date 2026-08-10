/**
 * FEAT-032 (docs/plans/feat-032-template-engine-config-driven-versioned.md
 * finding #4). `report_template_version.definition`'s persisted shape.
 * Deliberately covers only the 5 field types that shape #4 scoped this
 * proposal to -- the exact set FEAT-016's own already-shipped
 * `ChemistryReportInput`/`ChemistryReportAnalyteResult` needs generalized.
 *
 * The patient/specimen/order/verifier header and verification footer stay
 * fixed structural chrome, rendered identically regardless of template (see
 * `report-render.ts`'s own header comment) -- no field type here models
 * "patient info"; only the results-body content is template-driven. A
 * template's own `sections`/`fields` tree governs that body only.
 */

export const TEMPLATE_FIELD_TYPES = [
  'numeric',
  'coded',
  'richText',
  'table',
  'referenceRangeDisplay',
] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

// Types requiring KB-12's own binding guardrail ("any field representing a
// measurable/codeable clinical datum must declare an analyte binding") --
// enforced at publish time by report-template-guardrails.ts, never at
// evaluation/render time.
export const ANALYTE_BOUND_FIELD_TYPES: readonly TemplateFieldType[] = [
  'numeric',
  'coded',
  'referenceRangeDisplay',
];

// The context a field's own `visibilityCondition` may check: its own bound
// analyte's resolved result (finding #2: reuses `evaluateCondition`
// unmodified from apps/api/src/workflow/workflow-condition-evaluator.ts,
// only the allow-list differs). Deliberately narrower than KB-12's own
// cross-field example ("show Organisms only if Culture = positive") --
// cross-field conditions are out of scope (§5), same narrowing as the
// deferred field types. Mirrors `ChemistryReportAnalyteResult`'s own shape,
// the same "allow-list mirrors the real payload shape" precedent
// `workflow-types.ts`'s own `ALLOWED_FIELDS` already established for
// `ObservationResult`.
export const TEMPLATE_ALLOWED_FIELDS = [
  'analyteName',
  'unit',
  'flags',
  'isCritical',
] as const;
export type TemplateAllowedField = (typeof TEMPLATE_ALLOWED_FIELDS)[number];

export interface TemplateFieldDefinition {
  key: string;
  label: string;
  type: TemplateFieldType;
  /** Required (guardrail-enforced) for 'numeric'/'coded'; the bound
   * analyte's id. */
  analyteBinding?: string;
  /** 'table' only: the ordered set of analyte ids whose resolved results
   * become this field's rows -- the direct generalization of the old fixed
   * layout's single results table. */
  analyteBindings?: string[];
  /** 'richText' only: static authored content (KB-12's own "narrative,
   * additive" framing) -- not bound to any analyte. */
  content?: string;
  /** Evaluated against this field's own bound analyte's resolved result
   * (or, for 'table'/'richText' fields with no single binding, always
   * visible -- conditional visibility only applies to a field with exactly
   * one analyte binding). Reuses ADR-0029's ConditionNode shape verbatim. */
  visibilityCondition?: import('../workflow/workflow-types').ConditionNode;
}

export interface TemplateSectionDefinition {
  title: string;
  fields: TemplateFieldDefinition[];
}

export interface ReportTemplateDefinition {
  sections: TemplateSectionDefinition[];
}
