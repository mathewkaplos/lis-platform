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
export const catalogAnalyteSchema = z.object({
  id: z.uuid(),
  display: z.string(),
  dataType: z.string(),
  unit: z.string().nullable(),
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
