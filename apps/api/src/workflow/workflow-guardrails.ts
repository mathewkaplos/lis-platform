import { findUnallowedFields } from './workflow-condition-evaluator';
import type { WorkflowRule } from './workflow-types';

// FEAT-029 proposal §5/ADR-0029: a denylist, not a general static analyzer.
// A command name here is rejected outright at publish time regardless of
// its rule's own `when` -- not "rejected unless the condition provably
// excludes criticals" (KB-25's own eventual target, needing real static
// analysis this phase does not attempt). FEAT-031 (auto-verification) is
// the feature that earns the right to register VerifyObservation and
// correspondingly relax this list, with its own proposal/ADR -- never by
// silently editing this array to unblock a rule.
const DENYLISTED_COMMANDS = ['VerifyObservation'] as const;

/**
 * Runs before a workflow_definition may ever reach `status: 'published'`
 * (WorkflowDefinitionService.publish, the only code path that sets that
 * status -- never bypassable by a direct write). Returns validation error
 * strings; empty array means the definition may publish.
 */
export function validateWorkflowDefinition(rules: WorkflowRule[]): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    if (
      (DENYLISTED_COMMANDS as readonly string[]).includes(rule.do.command)
    ) {
      errors.push(
        `Rule '${rule.id}': command '${rule.do.command}' is not yet permitted -- denylisted until its own feature/ADR reviews and registers it`,
      );
    }
    const unallowed = findUnallowedFields(rule.when);
    if (unallowed.length > 0) {
      errors.push(
        `Rule '${rule.id}': condition references field(s) not in the allow-list: ${unallowed.join(', ')}`,
      );
    }
  }
  return errors;
}
