/**
 * Everything `mapObservationToFhir` needs, already resolved (FEAT-037,
 * KB-31's Observation→Observation mapping table). Mirrors
 * `InteropOruDataService`/`InteropOruData`'s own shape (FEAT-036) -- the
 * closest existing precedent in this repo for "read a verified
 * Observation's resolved LOINC/value/unit/range/flags and serialize into an
 * external standard's resource."
 */
export interface FhirObservationInput {
  id: string;
  status: string;
  patientId: string;
  analyteCode: string;
  analyteDisplay: string;
  value: number;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  flags: string[];
  effectiveAt: string;
}

const UCUM_SYSTEM = 'http://unitsofmeasure.org';
const LOINC_SYSTEM = 'http://loinc.org';
const INTERPRETATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';

/**
 * Internal `observation.status` -> FHIR `Observation.status` (proposal §10
 * Q2, resolved). `reported` has no separate FHIR state -- still `final`.
 * `rejected` maps to `entered-in-error`, the closest FHIR equivalent for a
 * voided/erroneous result, not `cancelled` (a cancelled order was never
 * resulted at all; a rejected result was resulted, then voided).
 */
const STATUS_MAP: Record<string, fhir4.Observation['status']> = {
  registered: 'registered',
  preliminary: 'preliminary',
  verified: 'final',
  reported: 'final',
  amended: 'amended',
  corrected: 'corrected',
  cancelled: 'cancelled',
  rejected: 'entered-in-error',
};

/**
 * This repo's own severity-flag vocabulary (`N`/`L`/`H`/`LL`/`HH`,
 * `packages/db/src/flagging.ts`) is a confirmed exact subset of FHIR's
 * `v3-ObservationInterpretation` CodeSystem for these five codes
 * specifically. `D` (delta-check flagged, `mergeDeltaFlag`) is deliberately
 * **not** mapped here -- FHIR's own `D` in that CodeSystem means
 * "significantly decreased," a different concept than "flagged by a delta
 * check against the patient's own prior value." Emitting FHIR's `D` for our
 * `D` would silently misrepresent the result to any real FHIR consumer;
 * omitting an interpretation is honest, a wrong one is not.
 */
const INTERPRETATION_CODES = new Set(['N', 'L', 'H', 'LL', 'HH']);

export function mapObservationToFhir(
  input: FhirObservationInput,
): fhir4.Observation {
  const status = STATUS_MAP[input.status];
  if (!status) {
    throw new Error(`Unmapped observation status for FHIR: ${input.status}`);
  }

  const resource: fhir4.Observation = {
    resourceType: 'Observation',
    id: input.id,
    status,
    code: {
      coding: [
        {
          system: LOINC_SYSTEM,
          code: input.analyteCode,
          display: input.analyteDisplay,
        },
      ],
    },
    subject: { reference: `Patient/${input.patientId}` },
    effectiveDateTime: input.effectiveAt,
    valueQuantity: {
      value: input.value,
      ...(input.unit
        ? { unit: input.unit, system: UCUM_SYSTEM, code: input.unit }
        : {}),
    },
  };

  if (input.refLow !== null || input.refHigh !== null) {
    resource.referenceRange = [
      {
        ...(input.refLow !== null ? { low: { value: input.refLow } } : {}),
        ...(input.refHigh !== null ? { high: { value: input.refHigh } } : {}),
      },
    ];
  }

  const interpretationCode = input.flags.find((flag) =>
    INTERPRETATION_CODES.has(flag),
  );
  if (interpretationCode) {
    resource.interpretation = [
      { coding: [{ system: INTERPRETATION_SYSTEM, code: interpretationCode }] },
    ];
  }

  return resource;
}
