/**
 * TASK-053 (FEAT-014 revision §1 finding #2): KB-14/KB-20 describe calculated
 * Observations driven by a sandboxed metadata-formula engine — "where the
 * engine lives and its sandboxing" and "the shipped calculated-analyte
 * library" are both named as still-unresolved open questions in KB-20
 * itself, not a 1-day task's scope. This is a deliberately narrower, hard-
 * coded registry of the two formulas the AC names, shaped so a future
 * metadata-driven engine could replace it without changing its callers'
 * contract (output code, input codes, a pure `compute`, a human-readable
 * `formula` string).
 *
 * Pure, zero-DB-dependency (like `flagging.ts` in `@lis/db`) so both
 * `apps/api` (to actually compute) and `apps/web` (to know which analyte
 * codes are calculated, and what formula text to show on hover) can import
 * it directly.
 */

import type { PatientSex } from "./patient";

export interface CalculatedValue {
  value: number;
}

export interface SuppressedValue {
  suppressed: true;
  reason: string;
}

export type CalculatedResult = CalculatedValue | SuppressedValue;

export function isSuppressed(result: CalculatedResult): result is SuppressedValue {
  return "suppressed" in result;
}

/** Whole years between `birthDate` and `at`, floored — CKD-EPI's own input unit. */
export function ageYearsAt(birthDate: Date, at: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((at.getTime() - birthDate.getTime()) / msPerDay);
  return Math.floor(days / 365.2425);
}

export interface CkdEpiInput {
  creatinineMgDl: number;
  sex: PatientSex;
  ageYears: number | null;
}

/**
 * CKD-EPI 2021 (race-free) creatinine equation — the current standard of
 * care (removes the prior race coefficient), NEJM 2021 (Inker et al.).
 * `κ`/`α` are sex-dependent constants; the female result gets an additional
 * ×1.012 factor. `sex: 'U'` and a null `ageYears` are both real, explicit
 * "cannot compute" states (matching `reference-range.ts`'s own treatment of
 * unknown sex/birthDate) — never guessed, per KB-15's "no_range never faked
 * as normal" discipline applied here to calculated *values*.
 */
export function computeEgfr(input: CkdEpiInput): CalculatedResult {
  if (input.sex === "U") {
    return { suppressed: true, reason: "eGFR (CKD-EPI 2021) requires a known patient sex" };
  }
  if (input.ageYears === null) {
    return { suppressed: true, reason: "eGFR (CKD-EPI 2021) requires a known patient birth date" };
  }
  if (input.creatinineMgDl <= 0) {
    return { suppressed: true, reason: "eGFR (CKD-EPI 2021) requires a positive creatinine value" };
  }

  const kappa = input.sex === "F" ? 0.7 : 0.9;
  const alpha = input.sex === "F" ? -0.241 : -0.302;
  const scrOverKappa = input.creatinineMgDl / kappa;

  const value =
    142 *
    Math.min(scrOverKappa, 1) ** alpha *
    Math.max(scrOverKappa, 1) ** -1.2 *
    0.9938 ** input.ageYears *
    (input.sex === "F" ? 1.012 : 1);

  // Real lab reports show eGFR as a whole number, not a raw floating-point
  // computation (found during TASK-053's own web-verify pass: the
  // unrounded value rendered as "70.97500558720519" in the results grid).
  return { value: Math.round(value) };
}

export interface FriedewaldInput {
  totalCholesterolMgDl: number;
  hdlMgDl: number;
  triglyceridesMgDl: number;
}

const FRIEDEWALD_TRIGLYCERIDE_GUARD_MG_DL = 400;

/**
 * Friedewald equation: LDL = Total Cholesterol − HDL − Triglycerides / 5.
 * KB-20's own validity guard: invalid (suppressed, not fabricated) at or
 * above the triglyceride threshold — chylomicronemia makes the underlying
 * assumption (VLDL ≈ TG/5) unreliable.
 */
export function computeLdl(input: FriedewaldInput): CalculatedResult {
  if (input.triglyceridesMgDl >= FRIEDEWALD_TRIGLYCERIDE_GUARD_MG_DL) {
    return {
      suppressed: true,
      reason: `Friedewald LDL is invalid when triglycerides >= ${FRIEDEWALD_TRIGLYCERIDE_GUARD_MG_DL} mg/dL`,
    };
  }

  const value =
    input.totalCholesterolMgDl - input.hdlMgDl - input.triglyceridesMgDl / 5;

  // Matches TC/HDL/TG's own whole-number mg/dL reporting convention (same
  // rounding rationale as computeEgfr above).
  return { value: Math.round(value) };
}

export interface CalculatedAnalytePatientContext {
  sex: PatientSex;
  ageYears: number | null;
}

export interface CalculatedAnalyteDefinition {
  /** The calculated analyte's own LOINC code (its `analyte.codeSystemValueId` resolves to this). */
  outputLoincCode: string;
  /** LOINC codes of every input analyte this formula needs, all on the same `test_definition`. */
  inputLoincCodes: string[];
  /** Human-readable formula text — the literal "shown on hover" AC. */
  formula: string;
  compute: (
    inputsByLoincCode: Record<string, number>,
    patient: CalculatedAnalytePatientContext,
  ) => CalculatedResult;
}

export const CALCULATED_ANALYTES: readonly CalculatedAnalyteDefinition[] = [
  {
    outputLoincCode: "98979-8", // eGFR (CKD-EPI 2021, race-free)
    inputLoincCodes: ["2160-0"], // Creatinine
    formula:
      "eGFR (CKD-EPI 2021, race-free) = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^-1.200 × 0.9938^Age × 1.012 (if female), where κ = 0.7 (F) / 0.9 (M), α = -0.241 (F) / -0.302 (M)",
    compute: (inputs, patient) =>
      computeEgfr({
        creatinineMgDl: inputs["2160-0"],
        sex: patient.sex,
        ageYears: patient.ageYears,
      }),
  },
  {
    outputLoincCode: "13457-7", // LDL Cholesterol, calculated (Friedewald)
    inputLoincCodes: ["2093-3", "2085-9", "2571-8"], // Total Cholesterol, HDL, Triglycerides
    formula: `LDL (Friedewald) = Total Cholesterol − HDL − Triglycerides / 5 (invalid if triglycerides >= ${FRIEDEWALD_TRIGLYCERIDE_GUARD_MG_DL} mg/dL)`,
    compute: (inputs) =>
      computeLdl({
        totalCholesterolMgDl: inputs["2093-3"],
        hdlMgDl: inputs["2085-9"],
        triglyceridesMgDl: inputs["2571-8"],
      }),
  },
] as const;

const CALCULATED_ANALYTE_BY_OUTPUT_CODE = new Map(
  CALCULATED_ANALYTES.map((def) => [def.outputLoincCode, def]),
);

export function getCalculatedAnalyteDefinition(
  outputLoincCode: string,
): CalculatedAnalyteDefinition | undefined {
  return CALCULATED_ANALYTE_BY_OUTPUT_CODE.get(outputLoincCode);
}

export function isCalculatedAnalyteCode(loincCode: string): boolean {
  return CALCULATED_ANALYTE_BY_OUTPUT_CODE.has(loincCode);
}

/** Every calculated analyte whose formula depends on `inputLoincCode`. */
export function calculatedAnalytesDependingOn(
  inputLoincCode: string,
): CalculatedAnalyteDefinition[] {
  return CALCULATED_ANALYTES.filter((def) =>
    def.inputLoincCodes.includes(inputLoincCode),
  );
}
