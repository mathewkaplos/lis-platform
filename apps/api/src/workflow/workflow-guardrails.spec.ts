import { validateWorkflowDefinition } from './workflow-guardrails';
import type { WorkflowRule } from './workflow-types';

function rule(overrides: Partial<WorkflowRule> = {}): WorkflowRule {
  return {
    id: 'rule-1',
    on: 'ObservationVerified',
    when: { field: 'flags', op: 'includes', value: 'HH' },
    do: { command: 'LogEvent' },
    ...overrides,
  };
}

describe('validateWorkflowDefinition', () => {
  it('accepts an ordinary rule with an allow-listed field and a non-denylisted command', () => {
    expect(validateWorkflowDefinition([rule()])).toEqual([]);
  });

  it('rejects a rule naming a denylisted command, regardless of its own when clause', () => {
    const errors = validateWorkflowDefinition([
      rule({ do: { command: 'VerifyObservation' } }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('VerifyObservation');
  });

  it('rejects a rule whose condition references a field not in the allow-list', () => {
    const errors = validateWorkflowDefinition([
      rule({ when: { field: 'patientAgeYears', op: 'gt', value: 65 } }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('patientAgeYears');
  });

  it('collects errors across multiple rules, not just the first', () => {
    const errors = validateWorkflowDefinition([
      rule({ id: 'a', do: { command: 'VerifyObservation' } }),
      rule({ id: 'b', when: { field: 'unknownField', op: 'eq', value: 1 } }),
    ]);
    expect(errors).toHaveLength(2);
  });
});
