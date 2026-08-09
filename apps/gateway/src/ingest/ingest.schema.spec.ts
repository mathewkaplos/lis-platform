import { idempotencyKey, rawResultSchema } from './ingest.schema';

describe('idempotencyKey', () => {
  it('is stable for the same (instrument, specimen, analyte, run)', () => {
    const r = {
      instrumentId: 'ANALYZER-1',
      specimenId: 'SPEC-1',
      analyte: 'GLU',
      runId: 'RUN-1',
    };
    expect(idempotencyKey(r)).toBe(idempotencyKey({ ...r }));
  });

  it('differs when any one field differs', () => {
    const base = {
      instrumentId: 'ANALYZER-1',
      specimenId: 'SPEC-1',
      analyte: 'GLU',
      runId: 'RUN-1',
    };
    expect(idempotencyKey(base)).not.toBe(
      idempotencyKey({ ...base, runId: 'RUN-2' }),
    );
    expect(idempotencyKey(base)).not.toBe(
      idempotencyKey({ ...base, analyte: 'K' }),
    );
  });
});

describe('rawResultSchema', () => {
  it('accepts a well-formed raw result', () => {
    const result = rawResultSchema.safeParse({
      instrumentId: 'ANALYZER-1',
      specimenId: 'SPEC-1',
      analyte: 'GLU',
      runId: 'RUN-1',
      value: 5.4,
      unit: 'mmol/L',
      flag: 'N',
      rawPayload: 'H|\\^&|||ANALYZER-1|...',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing rawPayload (KB-29: raw retention is mandatory)', () => {
    const result = rawResultSchema.safeParse({
      instrumentId: 'ANALYZER-1',
      specimenId: 'SPEC-1',
      analyte: 'GLU',
      runId: 'RUN-1',
      value: 5.4,
    });
    expect(result.success).toBe(false);
  });
});
