import { isConditionLeaf, type ConditionNode } from './workflow-types';

// issue #642 (proposal §5.1): the evaluator itself moved to @lis/domain so
// apps/web's synoptic protocol renderer can live-evaluate a
// `visibilityCondition` with the literal same implementation this module
// used to define locally, not a hand-copied duplicate that could drift.
// Re-exported here unchanged so every existing import in this module (and
// every other apps/api caller) stays correct with no call-site changes.
export { evaluateCondition } from '@lis/domain';

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
