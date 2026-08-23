import { describe, expect, it } from 'vitest';
import { resultEntrySchema } from './observation';

/**
 * `resultEntrySchema` is a discriminated union (exactly one typed value
 * field required per `dataType`) plus a cross-branch refine
 * (`notesAiOriginated`/`notesAiDisposition` must travel together, ordinal
 * branch only, FEAT-042) -- real, non-obvious logic mirroring a DB CHECK
 * constraint at the request-validation layer, and the kind of rule that's
 * easy to silently break in a future edit to this file.
 */
describe('resultEntrySchema', () => {
  describe('quantity branch', () => {
    it('accepts a numeric valueNum', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'quantity', valueNum: 5.4 }).success).toBe(
        true,
      );
    });
    it('rejects a missing valueNum', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'quantity' }).success).toBe(false);
    });
    it('rejects a non-numeric valueNum', () => {
      expect(
        resultEntrySchema.safeParse({ dataType: 'quantity', valueNum: 'five' }).success,
      ).toBe(false);
    });
  });

  describe('coded branch', () => {
    it('accepts a non-empty valueCode', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'coded', valueCode: 'POS' }).success).toBe(
        true,
      );
    });
    it('rejects an empty valueCode', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'coded', valueCode: '' }).success).toBe(
        false,
      );
    });
  });

  describe('text branch', () => {
    it('accepts a non-empty valueText', () => {
      expect(
        resultEntrySchema.safeParse({ dataType: 'text', valueText: 'no growth' }).success,
      ).toBe(true);
    });
    it('rejects an empty valueText', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'text', valueText: '' }).success).toBe(
        false,
      );
    });
  });

  describe('ordinal branch', () => {
    it('accepts a valid grade with no AI-notes fields at all', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'ordinal', valueCode: '2+' }).success).toBe(
        true,
      );
    });

    it('rejects a grade outside the fixed morphology-grade vocabulary', () => {
      expect(resultEntrySchema.safeParse({ dataType: 'ordinal', valueCode: '4+' }).success).toBe(
        false,
      );
    });

    it('accepts notesAiOriginated and notesAiDisposition set together', () => {
      const result = resultEntrySchema.safeParse({
        dataType: 'ordinal',
        valueCode: '1+',
        notes: 'accepted the AI-suggested grade as-is',
        notesAiOriginated: true,
        notesAiDisposition: 'accepted',
      });
      expect(result.success).toBe(true);
    });

    it('accepts neither notesAiOriginated nor notesAiDisposition set -- "not at all" is valid', () => {
      const result = resultEntrySchema.safeParse({
        dataType: 'ordinal',
        valueCode: '1+',
        notes: 'a plain manual note',
      });
      expect(result.success).toBe(true);
    });

    it('rejects notesAiOriginated set without notesAiDisposition', () => {
      const result = resultEntrySchema.safeParse({
        dataType: 'ordinal',
        valueCode: '1+',
        notesAiOriginated: true,
      });
      expect(result.success).toBe(false);
    });

    it('rejects notesAiDisposition set without notesAiOriginated', () => {
      const result = resultEntrySchema.safeParse({
        dataType: 'ordinal',
        valueCode: '1+',
        notesAiDisposition: 'edited',
      });
      expect(result.success).toBe(false);
    });

    it('rejects notesAiOriginated explicitly false paired with a set notesAiDisposition -- Boolean(false) !== Boolean("edited")', () => {
      const result = resultEntrySchema.safeParse({
        dataType: 'ordinal',
        valueCode: '1+',
        notesAiOriginated: false,
        notesAiDisposition: 'edited',
      });
      expect(result.success).toBe(false);
    });
  });

  it('rejects a dataType outside the four modeled branches', () => {
    expect(
      resultEntrySchema.safeParse({ dataType: 'boolean', valueNum: 1 }).success,
    ).toBe(false);
  });

  it('rejects a body with no dataType at all', () => {
    expect(resultEntrySchema.safeParse({ valueNum: 5 }).success).toBe(false);
  });
});
