import { Fhir } from 'fhir-tool';
import {
  mapObservationToFhir,
  type FhirObservationInput,
} from './observation-mapper';

/**
 * `fhir-tool`'s own `Severities` enum is declared in its `.d.ts` but is
 * **not actually exported from its runtime `index.js`**
 * (`Object.keys(require('fhir-tool'))` confirms it directly -- a real
 * type/runtime mismatch in the library, not a mistake here). `severity` is,
 * at runtime, a plain string; compared as a string, not the declared-but-
 * absent enum.
 */
function isHardFailure(severity: unknown): boolean {
  return severity === 'error' || severity === 'fatal';
}

function input(
  overrides: Partial<FhirObservationInput> = {},
): FhirObservationInput {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    status: 'verified',
    patientId: '22222222-2222-2222-2222-222222222222',
    analyteCode: '2345-7',
    analyteDisplay: 'Glucose',
    value: 90,
    unit: 'mg/dL',
    refLow: 70,
    refHigh: 99,
    flags: ['N'],
    effectiveAt: '2026-08-10T12:00:00.000Z',
    ...overrides,
  };
}

/** Real R4 validation (fhir-tool defaults to FHIR 4.0.0) -- proposal §8:
 * `valid: true` with zero error/fatal messages is the actual bar, not just
 * "the object has the right-looking shape." Terminology-binding info/warning
 * messages (LOINC/interpretation codes not found in fhir-tool's bundled
 * base value sets) are expected and not failures -- see proposal §6. */
function assertValidR4(resource: unknown) {
  const fhir = new Fhir();
  const result = fhir.validate(resource as object);
  const hardFailures = result.messages.filter((m) => isHardFailure(m.severity));
  if (!result.valid || hardFailures.length > 0) {
    throw new Error(
      `Expected valid R4 resource, got: ${JSON.stringify(result, null, 2)}`,
    );
  }
}

describe('mapObservationToFhir', () => {
  it('produces a FHIR Observation that validates against the R4 base profile (AC)', () => {
    const resource = mapObservationToFhir(input());
    assertValidR4(resource);
    expect(resource.resourceType).toBe('Observation');
    expect(resource.status).toBe('final');
    expect(resource.code.coding?.[0]).toEqual({
      system: 'http://loinc.org',
      code: '2345-7',
      display: 'Glucose',
    });
    expect(resource.subject).toEqual({
      reference: `Patient/${input().patientId}`,
    });
    expect(resource.valueQuantity).toEqual({
      value: 90,
      unit: 'mg/dL',
      system: 'http://unitsofmeasure.org',
      code: 'mg/dL',
    });
    expect(resource.referenceRange?.[0]).toEqual({
      low: { value: 70 },
      high: { value: 99 },
    });
    expect(resource.interpretation?.[0].coding?.[0]).toEqual({
      system:
        'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
      code: 'N',
    });
  });

  it.each([
    ['registered', 'registered'],
    ['preliminary', 'preliminary'],
    ['verified', 'final'],
    ['reported', 'final'],
    ['amended', 'amended'],
    ['corrected', 'corrected'],
    ['cancelled', 'cancelled'],
    ['rejected', 'entered-in-error'],
  ])(
    'maps internal status %s to FHIR status %s (proposal §10 Q2)',
    (internal, expected) => {
      const resource = mapObservationToFhir(input({ status: internal }));
      expect(resource.status).toBe(expected);
      assertValidR4(resource);
    },
  );

  it('throws for an unrecognized internal status rather than emitting a wrong FHIR code', () => {
    expect(() =>
      mapObservationToFhir(input({ status: 'not-a-real-status' })),
    ).toThrow(/Unmapped observation status/);
  });

  it('omits interpretation for a delta-only flag ("D") -- FHIR\'s own "D" means something different', () => {
    const resource = mapObservationToFhir(input({ flags: ['D'] }));
    expect(resource.interpretation).toBeUndefined();
    assertValidR4(resource);
  });

  it('maps a severity flag correctly even when a delta flag is also present', () => {
    const resource = mapObservationToFhir(input({ flags: ['H', 'D'] }));
    expect(resource.interpretation?.[0].coding?.[0].code).toBe('H');
  });

  it('omits referenceRange entirely when neither bound is set', () => {
    const resource = mapObservationToFhir(
      input({ refLow: null, refHigh: null }),
    );
    expect(resource.referenceRange).toBeUndefined();
    assertValidR4(resource);
  });

  it('renders a one-sided reference range (critical-low threshold only)', () => {
    const resource = mapObservationToFhir(input({ refLow: null, refHigh: 40 }));
    expect(resource.referenceRange?.[0]).toEqual({ high: { value: 40 } });
    assertValidR4(resource);
  });

  it('omits unit-coded fields when no unit is recorded', () => {
    const resource = mapObservationToFhir(input({ unit: null }));
    expect(resource.valueQuantity).toEqual({ value: 90 });
    assertValidR4(resource);
  });

  it('rejects a deliberately incomplete resource -- proves the validator actually checks structure, not just accepts anything', () => {
    const fhir = new Fhir();
    const result = fhir.validate({ resourceType: 'Observation' });
    expect(result.valid).toBe(false);
    expect(result.messages.some((m) => isHardFailure(m.severity))).toBe(true);
  });
});
