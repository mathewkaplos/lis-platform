import { z } from "zod";

/**
 * TASK-043 (FEAT-012) scope (docs/plans/feat-012-order-entry.md's TASK-043
 * revision): the order builder's catalog picker needs a real source of
 * available tests/panels -- no earlier task ever exposed
 * packages/db/src/schema/test-catalog.ts's tables via the API. Single
 * source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1), same as patient.ts/order.ts.
 */
export const catalogTestSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
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
