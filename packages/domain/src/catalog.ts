import { z } from "zod";

/**
 * TASK-043 (FEAT-012) scope (docs/plans/feat-012-order-entry.md's TASK-043
 * revision): the order builder's catalog picker needs a real source of
 * available tests/panels -- no earlier task ever exposed
 * packages/db/src/schema/test-catalog.ts's tables via the API. Single
 * source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1), same as patient.ts/order.ts.
 */
/**
 * TASK-052 (FEAT-014 revision, §10 Q1, resolved 2026-08-06): the result-
 * entry grid's own prerequisite -- no earlier task exposed `test_analyte`
 * via the API. `dataType` is `observation`'s own full 10-value vocabulary
 * (KB-14), not TASK-051's narrower 3-value request-side restriction -- this
 * describes what the catalog *has*, not what any one write path accepts.
 */
/**
 * TASK-053 (FEAT-014 revision §2): `code` is the analyte's own LOINC code
 * (resolved via `codeSystemValue`, same join shape already used for `unit`)
 * -- the only way the frontend can recognize "this row is calculated"
 * (`@lis/domain`'s `isCalculatedAnalyteCode`) without a new schema flag.
 */
export const catalogAnalyteSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  display: z.string(),
  dataType: z.string(),
  unit: z.string().nullable(),
  /** FEAT-035 addition: the analyte's own `defaultUnitId` (real id, not
   * just `unit`'s already-resolved display string) -- the admin reference-
   * range form needs a real unit id to submit to `POST /v1/reference-
   * ranges`, and no other route exposes one. Reusing this
   * already-fetched-everywhere endpoint, not a new `GET /v1/units` route
   * (matching `qc-violations/page.tsx`'s own "resolved client-side against
   * /v1/catalog... reused rather than duplicated into a second endpoint"
   * precedent). */
  unitId: z.uuid().nullable(),
});
export type CatalogAnalyte = z.infer<typeof catalogAnalyteSchema>;

export const catalogTestSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
  analytes: z.array(catalogAnalyteSchema),
});
export type CatalogTest = z.infer<typeof catalogTestSchema>;

export const catalogPanelSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
  testDefinitionIds: z.array(z.uuid()),
});
export type CatalogPanel = z.infer<typeof catalogPanelSchema>;

export const catalogSchema = z.object({
  tests: z.array(catalogTestSchema),
  panels: z.array(catalogPanelSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

/** Reference/catalog data, not operational data -- a generous fixed ceiling,
 * not ADR-0013 §4's deferred-pagination concern re-litigated (proposal §5).
 * No server-side search: the builder filters this client-side. */
export const CATALOG_RESULT_LIMIT = 500;

/**
 * FEAT-035 (docs/plans/feat-035-admin-catalog-ui.md). `analyteIds` is the
 * set of already-existing global `analyte` rows to bind via `test_analyte`
 * -- analyte *creation* is explicitly out of this feature's own scope (§10
 * Q1, resolved: descoped), so this schema only ever references existing
 * ids. `.min(1)`: proposal §6's own risk -- a zero-analyte test could never
 * produce a report (`report-assembly.ts`'s own existing guard), so this is
 * rejected at creation time, not left for a downstream consumer to catch.
 */
export const testDefinitionCreateSchema = z.object({
  code: z.string().min(1),
  displayName: z.string().min(1),
  analyteIds: z.array(z.uuid()).min(1),
});
export type TestDefinitionCreateInput = z.infer<
  typeof testDefinitionCreateSchema
>;

export const testDefinitionResultSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
  analyteIds: z.array(z.uuid()),
});
export type TestDefinitionResult = z.infer<typeof testDefinitionResultSchema>;

/**
 * Mirrors `reference_range`'s own columns (`packages/db/src/schema/
 * reference-range.ts`, KB-15's multi-dimensional model) -- `analyteId`/
 * `unitId`/`rangeType` required, every other dimension optional exactly as
 * the DB schema already allows (`sex: null` = any, etc.). `effectiveFrom`
 * is optional -- the DB column's own `defaultNow()` applies when omitted.
 * §10 Q3 (resolved: add-only): no `effectiveTo` in the *create* schema --
 * ending/archiving an existing range is deliberately not this feature's
 * scope.
 */
export const referenceRangeCreateSchema = z.object({
  analyteId: z.uuid(),
  unitId: z.uuid(),
  sex: z.enum(['M', 'F']).optional(),
  ageLowDays: z.number().int().optional(),
  ageHighDays: z.number().int().optional(),
  condition: z.string().optional(),
  method: z.string().optional(),
  specimenType: z.string().optional(),
  population: z.string().optional(),
  rangeType: z.string().min(1),
  low: z.number().optional(),
  high: z.number().optional(),
  textualRange: z.string().optional(),
  interpretationWhenIn: z.string().optional(),
  priority: z.number().int().optional(),
  source: z.string().optional(),
  effectiveFrom: z.iso.datetime().optional(),
});
export type ReferenceRangeCreateInput = z.infer<
  typeof referenceRangeCreateSchema
>;

export const referenceRangeResultSchema = z.object({
  id: z.uuid(),
  analyteId: z.uuid(),
  analyteDisplay: z.string(),
  unitId: z.uuid(),
  unitDisplay: z.string().nullable(),
  sex: z.string().nullable(),
  ageLowDays: z.number().nullable(),
  ageHighDays: z.number().nullable(),
  condition: z.string().nullable(),
  method: z.string().nullable(),
  specimenType: z.string().nullable(),
  population: z.string().nullable(),
  rangeType: z.string(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  textualRange: z.string().nullable(),
  interpretationWhenIn: z.string().nullable(),
  priority: z.number(),
  source: z.string().nullable(),
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReferenceRangeResult = z.infer<typeof referenceRangeResultSchema>;

export const referenceRangeListSchema = z.object({
  ranges: z.array(referenceRangeResultSchema),
});
export type ReferenceRangeList = z.infer<typeof referenceRangeListSchema>;
