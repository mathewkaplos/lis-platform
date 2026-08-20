import { z } from "zod";

/**
 * ADR-0029's ConditionNode shape -- the JSON condition tree the workflow
 * engine (apps/api/src/workflow) and FEAT-047's report designer both reuse
 * verbatim for a template field's own `visibilityCondition`. Moved here from
 * apps/api/src/workflow/workflow-types.ts + workflow-schemas.ts as part of
 * FEAT-047 so apps/web can validate a condition client-side against the same
 * schema instance apps/api enforces server-side (the "one schema, three
 * consumers" discipline every other cross-app form in this repo follows).
 * `evaluateCondition` itself moved here too as part of issue #642 (proposal
 * §5.1, docs/plans/task-642-synoptic-protocol-recording.md) -- it is a pure,
 * total function with no apps/api-only dependency beyond this same
 * ConditionNode/isConditionLeaf, so apps/web's synoptic protocol renderer can
 * live-evaluate a `visibilityCondition` with the literal same implementation
 * apps/api's own recorder uses authoritatively, rather than a hand-copied
 * duplicate that could drift. `apps/api/src/workflow/workflow-condition-evaluator.ts`
 * re-exports it unchanged for every existing caller. The publish-time
 * allow-list check (`findUnallowedFields`) stays server-only there -- it has
 * no apps/web caller and no reason to move.
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

/**
 * FEAT-029 (ADR-0029): a pure, total function over a JSON tree and a plain
 * context object -- no parser, no `eval`/`Function`, no I/O, no loops other
 * than the tree's own finite nesting. Safe by construction, not by
 * sandboxing.
 */
export function evaluateCondition(
  node: ConditionNode,
  context: Record<string, unknown>,
): boolean {
  if ("and" in node) {
    return node.and.every((child) => evaluateCondition(child, context));
  }
  if ("or" in node) {
    return node.or.some((child) => evaluateCondition(child, context));
  }
  if ("not" in node) {
    return !evaluateCondition(node.not, context);
  }

  const actual = context[node.field];
  switch (node.op) {
    case "eq":
      return actual === node.value;
    case "neq":
      return actual !== node.value;
    case "gt":
      return (
        typeof actual === "number" &&
        typeof node.value === "number" &&
        actual > node.value
      );
    case "gte":
      return (
        typeof actual === "number" &&
        typeof node.value === "number" &&
        actual >= node.value
      );
    case "lt":
      return (
        typeof actual === "number" &&
        typeof node.value === "number" &&
        actual < node.value
      );
    case "lte":
      return (
        typeof actual === "number" &&
        typeof node.value === "number" &&
        actual <= node.value
      );
    case "in":
      return Array.isArray(node.value) && node.value.includes(actual);
    case "includes":
      return Array.isArray(actual) && actual.includes(node.value);
  }
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
