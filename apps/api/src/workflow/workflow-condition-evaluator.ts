import {
  ALLOWED_FIELDS,
  isConditionLeaf,
  type ConditionNode,
} from './workflow-types';

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
  if ('and' in node) {
    return node.and.every((child) => evaluateCondition(child, context));
  }
  if ('or' in node) {
    return node.or.some((child) => evaluateCondition(child, context));
  }
  if ('not' in node) {
    return !evaluateCondition(node.not, context);
  }

  const actual = context[node.field];
  switch (node.op) {
    case 'eq':
      return actual === node.value;
    case 'neq':
      return actual !== node.value;
    case 'gt':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual > node.value
      );
    case 'gte':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual >= node.value
      );
    case 'lt':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual < node.value
      );
    case 'lte':
      return (
        typeof actual === 'number' &&
        typeof node.value === 'number' &&
        actual <= node.value
      );
    case 'in':
      return Array.isArray(node.value) && node.value.includes(actual);
    case 'includes':
      return Array.isArray(actual) && actual.includes(node.value);
  }
}

/**
 * Publish-time check (called by WorkflowDefinitionService, never at
 * evaluation time): every leaf's `field` must be in the allow-list.
 * Returns the list of unknown fields found (empty = valid).
 */
export function findUnallowedFields(node: ConditionNode): string[] {
  if ('and' in node) {
    return node.and.flatMap(findUnallowedFields);
  }
  if ('or' in node) {
    return node.or.flatMap(findUnallowedFields);
  }
  if ('not' in node) {
    return findUnallowedFields(node.not);
  }
  if (isConditionLeaf(node)) {
    return (ALLOWED_FIELDS as readonly string[]).includes(node.field)
      ? []
      : [node.field];
  }
  return [];
}
