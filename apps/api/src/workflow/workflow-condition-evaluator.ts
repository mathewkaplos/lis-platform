import { isConditionLeaf, type ConditionNode } from './workflow-types';

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
 * evaluation time): every leaf's `field` must be in `allowedFields`.
 * Returns the list of unknown fields found (empty = valid).
 *
 * `allowedFields` is a parameter, not the hardcoded `ALLOWED_FIELDS` import
 * this function originally closed over (FEAT-029) -- widened by FEAT-032
 * (`report-template-guardrails.ts`'s own reuse, per that proposal's finding
 * #2: `evaluateCondition`'s execution logic and this function's own
 * tree-walk are both allow-list-agnostic; only the allow-list *contents*
 * differ between a workflow rule's event-payload fields and a template
 * field's resolved-analyte-result fields). Every existing call site
 * (`workflow-guardrails.ts`) passes `ALLOWED_FIELDS` explicitly now.
 */
export function findUnallowedFields(
  node: ConditionNode,
  allowedFields: readonly string[],
): string[] {
  if ('and' in node) {
    return node.and.flatMap((child) =>
      findUnallowedFields(child, allowedFields),
    );
  }
  if ('or' in node) {
    return node.or.flatMap((child) =>
      findUnallowedFields(child, allowedFields),
    );
  }
  if ('not' in node) {
    return findUnallowedFields(node.not, allowedFields);
  }
  if (isConditionLeaf(node)) {
    return allowedFields.includes(node.field) ? [] : [node.field];
  }
  return [];
}
