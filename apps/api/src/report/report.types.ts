/**
 * TASK-058 (FEAT-016, docs/plans/feat-016-minimal-report.md §10 Q4). This
 * repo's first PDF-report input shape -- deliberately disposable
 * scaffolding, not a domain contract. Shaped like `12-template-engine.md`'s
 * CBC example and this repo's own already-shipped `ObservationResult` DTO
 * (`packages/domain/src/observation.ts`): a patient/specimen header, a
 * per-analyte result table (name, value, unit, flags, reference range,
 * critical indicator), and a verifier/status block.
 *
 * Deliberately NOT a Zod schema in `packages/domain` -- there is no HTTP
 * route validating a request body against this shape (proposal §10 Q3/
 * finding #1: TASK-058 is mechanism-only, rendered against placeholder
 * data, not a real request). TASK-059 ("Report data assembly") is the task
 * that will actually query real `observation`/`patient` rows and is not
 * bound to conform to this exact shape when it does -- see the proposal's
 * own §5 assumption.
 */
export interface ChemistryReportAnalyteResult {
  /** FEAT-032 addition: the resolved analyte's own id, so the generic
   * template interpreter (`report-render.ts`) can look up which result a
   * template field's `analyteBinding` refers to. Not used by the old fixed
   * layout, which iterated `results` positionally. */
  analyteId: string;
  analyteName: string;
  /** Already-formatted display value (e.g. "142", "Positive") -- this
   * report renders whatever string the caller passed, it does not format
   * numbers itself. */
  value: string;
  unit: string;
  /** KB-14/KB-15 severity flag vocabulary (`packages/db/src/flagging.ts`):
   * a subset of `N | L | H | LL | HH`, or `[]` for no-range/unflagged. */
  flags: string[];
  referenceRangeText: string;
  isCritical: boolean;
}

export interface ChemistryReportInput {
  patient: {
    name: string;
    mrn: string;
    dateOfBirth: string;
    sex?: string;
  };
  specimen: {
    accessionNumber: string;
    collectedAt: string;
    receivedAt?: string;
  };
  order: {
    orderingProviderName: string;
    orderId?: string;
  };
  results: ChemistryReportAnalyteResult[];
  verifier: {
    name: string;
    status: string;
    verifiedAt: string;
  };
}
