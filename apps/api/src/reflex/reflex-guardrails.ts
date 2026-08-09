/**
 * FEAT-030 (ADR-0030). Pure cycle/depth guardrail check, kept separate from
 * `add-reflex-test.command.ts`'s own DB-walking so it's unit-testable
 * without a database (KB-25: "cascade depth is bounded and cycle-checked").
 */

export const MAX_REFLEX_DEPTH = 5;

export type ReflexGuardrailViolation = 'cycle' | 'depth';

/**
 * `ancestorTestDefinitionIds` is the triggering ordered_test's own lineage,
 * immediate parent first, walking up (never including the target itself).
 * Returns which guardrail would be violated by creating a new reflex
 * ordered_test for `targetTestDefinitionId`, or `null` if it's safe.
 */
export function checkReflexGuardrails(
  ancestorTestDefinitionIds: string[],
  targetTestDefinitionId: string,
  maxDepth: number = MAX_REFLEX_DEPTH,
): ReflexGuardrailViolation | null {
  if (ancestorTestDefinitionIds.includes(targetTestDefinitionId)) {
    return 'cycle';
  }
  if (ancestorTestDefinitionIds.length >= maxDepth) {
    return 'depth';
  }
  return null;
}
