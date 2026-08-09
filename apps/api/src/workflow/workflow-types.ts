/**
 * FEAT-029 (ADR-0029). `WorkflowRule`/`ConditionNode` are the persisted
 * shape of `workflow_definition.rules` (jsonb) -- KB-25's own
 * trigger -> when -> do model, with `when` resolved to ADR-0029's fixed
 * JSON tree (never a parsed string).
 */

export const CONDITION_OPS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'includes',
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

// Explicit allow-list -- ADR-0029's own point: a field not in this list is
// rejected at publish time (the guardrail validator), never silently
// evaluated as undefined. Matches ObservationResult's own shape
// (packages/domain/src/observation.ts) since ObservationVerified is the
// one event this phase consumes.
export const ALLOWED_FIELDS = [
  'analyteId',
  'valueNum',
  'unit',
  'flags',
  'status',
  'source',
  'dataType',
] as const;
export type AllowedField = (typeof ALLOWED_FIELDS)[number];

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

export interface WorkflowRule {
  id: string;
  on: string; // event type, e.g. 'ObservationVerified'
  when: ConditionNode;
  do: { command: string; [key: string]: unknown };
}

export function isConditionLeaf(node: ConditionNode): node is ConditionLeaf {
  return 'field' in node;
}
