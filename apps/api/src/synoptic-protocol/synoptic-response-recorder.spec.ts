import { describe, expect, it } from 'vitest';
import { evaluateCondition } from '../workflow/workflow-condition-evaluator';
import type { ConditionNode } from '@lis/domain';

/**
 * FEAT-058 (proposal §8): the visibility-condition-gates-requiredness logic
 * `assembleAndPersistSynopticResponse` uses is a direct application of the
 * already-tested `evaluateCondition` (FEAT-029/047) -- covered here at the
 * unit level for the exact shapes the real seeded elements use
 * (db/seed/synoptic-protocol-colorectal.sql's own
 * `plane_of_mesorectal_excision`/`response_to_neoadjuvant_therapy`
 * conditions), rather than re-testing `evaluateCondition` itself.
 */
describe('synoptic element visibility-condition shapes', () => {
  const rectalOnly: ConditionNode = {
    field: 'tumor_site',
    op: 'in',
    value: ['rectum', 'rectosigmoid'],
  };

  it('a rectal-only element is visible (required) when tumor_site is rectal', () => {
    expect(evaluateCondition(rectalOnly, { tumor_site: 'rectum' })).toBe(true);
    expect(evaluateCondition(rectalOnly, { tumor_site: 'rectosigmoid' })).toBe(
      true,
    );
  });

  it('a rectal-only element is hidden (not required) for a non-rectal tumor site', () => {
    expect(evaluateCondition(rectalOnly, { tumor_site: 'sigmoid_colon' })).toBe(
      false,
    );
    expect(evaluateCondition(rectalOnly, {})).toBe(false);
  });

  const neoadjuvantGiven: ConditionNode = {
    field: 'neoadjuvant_therapy',
    op: 'eq',
    value: 'given',
  };

  it('response-to-neoadjuvant-therapy is only visible when neoadjuvant_therapy was given', () => {
    expect(
      evaluateCondition(neoadjuvantGiven, { neoadjuvant_therapy: 'given' }),
    ).toBe(true);
    expect(
      evaluateCondition(neoadjuvantGiven, {
        neoadjuvant_therapy: 'not_given',
      }),
    ).toBe(false);
  });
});
