import { z } from "zod";
import { conditionNodeSchema, type ConditionNode } from "./conditions";

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
 *
 * Moved into `@lis/domain` from `apps/api/src/report-template/` (FEAT-047)
 * so the visual designer (`apps/web`) validates client-side against the same
 * schema instance `apps/api` enforces server-side -- the "one schema, three
 * consumers" discipline every other cross-app form in this repo follows.
 * The server-side guardrail (`report-template-guardrails.ts`, KB-12's
 * analyte-binding rule) stays apps/api-only -- it needs a live
 * `test_analyte` set from the database, not something a shared schema can
 * express.
 */

export const TEMPLATE_FIELD_TYPES = [
  "numeric",
  "coded",
  "richText",
  "table",
  "referenceRangeDisplay",
] as const;
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

// Types requiring KB-12's own binding guardrail ("any field representing a
// measurable/codeable clinical datum must declare an analyte binding") --
// enforced at publish time by apps/api's report-template-guardrails.ts,
// never at evaluation/render time.
export const ANALYTE_BOUND_FIELD_TYPES: readonly TemplateFieldType[] = [
  "numeric",
  "coded",
  "referenceRangeDisplay",
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
  "analyteName",
  "unit",
  "flags",
  "isCritical",
] as const;
export type TemplateAllowedField = (typeof TEMPLATE_ALLOWED_FIELDS)[number];

export const templateFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(TEMPLATE_FIELD_TYPES),
  analyteBinding: z.uuid().optional(),
  analyteBindings: z.array(z.uuid()).optional(),
  content: z.string().optional(),
  visibilityCondition: conditionNodeSchema.optional(),
});
export type TemplateFieldDefinition = z.infer<typeof templateFieldSchema>;

export const templateSectionSchema = z.object({
  title: z.string().min(1),
  fields: z.array(templateFieldSchema).min(1),
});
export type TemplateSectionDefinition = z.infer<typeof templateSectionSchema>;

export const reportTemplateDefinitionSchema = z.object({
  sections: z.array(templateSectionSchema).min(1),
});
export type ReportTemplateDefinition = z.infer<
  typeof reportTemplateDefinitionSchema
>;

export const reportTemplateCreateSchema = z.object({
  testDefinitionId: z.uuid(),
  definition: reportTemplateDefinitionSchema,
});
export type ReportTemplateCreateInput = z.infer<
  typeof reportTemplateCreateSchema
>;

export const reportTemplateVersionCreateSchema = z.object({
  definition: reportTemplateDefinitionSchema,
});
export type ReportTemplateVersionCreateInput = z.infer<
  typeof reportTemplateVersionCreateSchema
>;

/**
 * FEAT-047: response DTOs -- the controller previously returned plain
 * TS-inferred objects with no `@ZodResponse` (undocumented in the generated
 * OpenAPI schema, `content?: never`, the same gap FEAT-046 found and fixed
 * for its own routes). `status` mirrors `ck_report_template_version_status`
 * (`packages/db/src/schema/report-template.ts`).
 */
export const REPORT_TEMPLATE_VERSION_STATUSES = [
  "draft",
  "in_review",
  "published",
  "archived",
] as const;
export type ReportTemplateVersionStatus =
  (typeof REPORT_TEMPLATE_VERSION_STATUSES)[number];

export const reportTemplateVersionResultSchema = z.object({
  id: z.uuid(),
  reportTemplateId: z.uuid(),
  version: z.number().int(),
  status: z.enum(REPORT_TEMPLATE_VERSION_STATUSES),
  definition: reportTemplateDefinitionSchema,
  createdAt: z.iso.datetime(),
});
export type ReportTemplateVersionResult = z.infer<
  typeof reportTemplateVersionResultSchema
>;

export const reportTemplateResultSchema = z.object({
  id: z.uuid(),
  testDefinitionId: z.uuid(),
  createdAt: z.iso.datetime(),
  versions: z.array(reportTemplateVersionResultSchema),
});
export type ReportTemplateResult = z.infer<typeof reportTemplateResultSchema>;

export const reportTemplateListSchema = z.object({
  templates: z.array(reportTemplateResultSchema),
});
export type ReportTemplateList = z.infer<typeof reportTemplateListSchema>;

// Re-exported for callers that only need the condition-tree type alongside
// report-template types (e.g. the designer's JSON-mode condition editor).
export type { ConditionNode };
