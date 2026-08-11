import { z } from "zod";

/**
 * ADR-0029's ConditionNode shape -- the JSON condition tree the workflow
 * engine (apps/api/src/workflow) and FEAT-047's report designer both reuse
 * verbatim for a template field's own `visibilityCondition`. Moved here from
 * apps/api/src/workflow/workflow-types.ts + workflow-schemas.ts as part of
 * FEAT-047 so apps/web can validate a condition client-side against the same
 * schema instance apps/api enforces server-side (the "one schema, three
 * consumers" discipline every other cross-app form in this repo follows).
 * The tree-walking evaluator (`evaluateCondition`) and the publish-time
 * allow-list check (`findUnallowedFields`) stay server-only in
 * apps/api/src/workflow/workflow-condition-evaluator.ts -- only the shape
 * moved, not the server-only logic that operates on it.
 */
export const CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "includes",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export interface ConditionLeaf {
  field: string;
  op: ConditionOp;
  value: unknown;
}

export type ConditionNode =
  | { and: ConditionNode[] }
  | { or: ConditionNode[] }
  | { not: ConditionNode }
  | ConditionLeaf;

export function isConditionLeaf(node: ConditionNode): node is ConditionLeaf {
  return "field" in node;
}

const conditionOpSchema = z.enum(CONDITION_OPS);

const conditionLeafSchema = z.object({
  field: z.string().min(1),
  op: conditionOpSchema,
  value: z.unknown(),
});

// Recursive schema -- z.lazy() is required since ConditionNode references
// itself (and/or/not each contain more ConditionNodes).
export const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(conditionNodeSchema).min(1) }),
    z.object({ or: z.array(conditionNodeSchema).min(1) }),
    z.object({ not: conditionNodeSchema }),
    conditionLeafSchema,
  ]),
);
