import { evaluateCondition, type ConditionNode, type SynopticElement } from '@lis/domain';

/**
 * Issue #803: derives "N of M required elements answered" for the synoptic
 * form's own progress indicator -- a pure function so it's unit-testable
 * without a React/jsdom environment (apps/web's vitest config is plain
 * node today, see vitest.config.ts's own comment; format-result-value.ts
 * is the existing precedent for this same split).
 *
 * Mirrors ProtocolForm's own ElementGroup/isVisibleForKey rules exactly:
 * `requirement !== 'recommended'` is what FieldControl's own asterisk
 * already means (both 'required' and 'conditional' count), and only
 * currently-visible elements count -- an element hidden by its own
 * visibilityCondition must not count as "required," matching the form's
 * own submit-time filtering. Repeatable elements' own children are
 * excluded entirely, not counted per-instance: none of the seeded
 * protocols defines a minimum instance count today (issue #666's own
 * header comment), so counting one would invent a number the domain
 * model doesn't actually enforce -- see docs/plans/task-803-synoptic-form-
 * progress-indicator.md §5.
 */
export function countRequiredProgress(
  elements: SynopticElement[],
  values: Record<string, unknown>,
): { answered: number; total: number } {
  let total = 0;
  let answered = 0;

  function walk(parentId: string | null): void {
    for (const element of elements.filter((e) => e.parentElementId === parentId)) {
      if (element.repeatable) continue;

      const visible = element.visibilityCondition
        ? evaluateCondition(element.visibilityCondition as ConditionNode, values)
        : true;
      if (!visible) continue;

      if (element.requirement !== 'recommended') {
        total += 1;
        if (element.key in values) answered += 1;
      }

      walk(element.id);
    }
  }

  walk(null);
  return { answered, total };
}
