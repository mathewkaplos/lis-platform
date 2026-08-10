'use server';

import type { MorphologyGrade } from '@lis/domain';
import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

/** TASK-053 (FEAT-014 revision §2 finding #4): mirrors `finalize()`'s own
 * `calculatedDependents` -- calculated analytes (eGFR/LDL, or five of them
 * at once for a differential's shared-WBC trigger, TASK-072) that cascaded
 * off this same finalize call, if any.
 *
 * `observationStatus` widened to include `'verified'` (TASK-055,
 * `packages/domain`'s `observationStatusSchema`) purely to type-check
 * against `@lis/sdk`'s now-wider shared `ObservationDto.status` -- `draft()`/
 * `finalize()` themselves never actually return `'verified'` (only the
 * `verify()` action below does). */
export interface CalculatedDependentOutcome {
  analyteId: string;
  valueNum: number | null;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified';
}

export interface ResultActionOutcome {
  // ADR-0021 / issue #400: 'held' is only ever returned by finalizeResult(),
  // when FinalizationRollupInterceptor's post-commit gate blocks the panel
  // from completing -- the write itself already succeeded (see heldMessage),
  // so this is NOT the same as 'error' and must not be rendered as one.
  status: 'ok' | 'error' | 'held';
  error?: string;
  heldMessage?: string;
  // TASK-390 (issue #390): distinguishes which post-commit branch held the
  // panel, so the UI can point a QC hold at /qc-violations without touching
  // the unrelated unacknowledged-critical caption (TASK-400's own scope).
  heldReason?: 'unacknowledged_critical' | 'qc_violation';
  valueNum: number | null;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified' | null;
  // TASK-057 (FEAT-015 revision §2/§10 Q4): only ever non-null after a
  // successful `verifyResult()` call -- `draftResult()`/`finalizeResult()`
  // never set either (draft/finalize themselves never write these columns).
  verifierUserId?: string | null;
  verifiedAt?: string | null;
  calculatedDependents?: CalculatedDependentOutcome[];
  // FEAT-024 (ADR-0025): only ever set by draftMorphologyResult()/
  // finalizeMorphologyResult() -- quantity actions never populate either.
  valueCode?: string | null;
  notes?: string | null;
  // FEAT-042: same "only ever set by the morphology actions" shape as
  // valueCode/notes immediately above.
  notesAiOriginated?: boolean | null;
  notesAiDisposition?: 'accepted' | 'edited' | null;
}

// The subset of `ProblemDetails` (apps/api's problem-details.filter.ts)
// present only on a `panel_hold` 409 -- the echoed, already-committed write.
interface HeldObservationDto {
  analyteId: string;
  valueNum: number | null;
  // FEAT-024 (ADR-0025): present on the real echoed body for any dataType,
  // simply always null for a quantity row -- widened so a held morphology
  // result's grade/notes survive the panel_hold path too.
  valueCode: string | null;
  notes: string | null;
  // FEAT-042: same "widened so it survives the panel_hold path too" shape.
  notesAiOriginated: boolean;
  notesAiDisposition: 'accepted' | 'edited' | null;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  status: 'registered' | 'preliminary' | 'verified';
}
interface PanelHoldProblem {
  code: 'panel_hold';
  detail: string;
  // ADR-0021 Decision 1: always present on a panel_hold body -- which of
  // FinalizationRollupInterceptor's two post-commit branches fired, so the
  // frontend doesn't need to re-derive it from `detail`'s free-text message
  // (issue #390's own QC-held indicator is the first real consumer of this).
  reason?: 'unacknowledged_critical' | 'qc_violation';
  heldObservation: HeldObservationDto;
  heldCalculatedDependents?: HeldObservationDto[];
}

const FAILURE: Omit<ResultActionOutcome, 'status' | 'error'> = {
  valueNum: null,
  flags: [],
  refLow: null,
  refHigh: null,
  observationStatus: null,
};

function writeErrorMessage(httpStatus: number): string {
  if (httpStatus === 409) {
    return 'This test cannot accept results right now (not yet received, or already finalized).';
  }
  if (httpStatus === 400) {
    return 'Invalid value for this analyte.';
  }
  return 'Something went wrong saving this value. Please try again.';
}

/**
 * TASK-052 (FEAT-014 revision §2, finding #2). A plain async function, not
 * `useActionState`-bound -- called imperatively from `results-grid.tsx`'s
 * own event handlers (`onBlur` for draft, `Enter` for finalize), matching
 * `cancel-order-button.tsx`'s own precedent (TASK-044) for a Server Action
 * invoked directly from a Client Component via `useTransition`. Never
 * exposes `getValidAccessToken()`'s token to the browser -- ADR-0014's
 * server-side-only token boundary is unaffected by this new *interaction*
 * pattern.
 */
export async function draftResult(
  orderedTestId: string,
  analyteId: string,
  valueNum: number,
): Promise<ResultActionOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.', ...FAILURE };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.PUT('/v1/ordered-tests/{id}/results/{analyteId}', {
    params: { path: { id: orderedTestId, analyteId } },
    body: { dataType: 'quantity', valueNum },
  });
  if (!response.ok || !data) {
    return { status: 'error', error: writeErrorMessage(response.status), ...FAILURE };
  }
  return {
    status: 'ok',
    valueNum: data.valueNum,
    flags: data.flags,
    refLow: data.refLow,
    refHigh: data.refHigh,
    observationStatus: data.status,
  };
}

/**
 * FEAT-024 (ADR-0025): the `ordinal` counterpart to `draftResult` above --
 * same shape, `dataType: 'ordinal'` with a validated grade (`valueCode`,
 * `morphologyGradeSchema` server-side) plus an optional `notes`. `draft()`
 * (PUT) returns the flat `ObservationResult` directly (`toObservationDto`),
 * so `data.valueCode`/`data.notes` are already typed, no manual cast needed
 * (unlike `finalizeMorphologyResult` below).
 */
export async function draftMorphologyResult(
  orderedTestId: string,
  analyteId: string,
  valueCode: MorphologyGrade,
  notes?: string,
  notesAiOriginated?: boolean,
  notesAiDisposition?: 'accepted' | 'edited',
): Promise<ResultActionOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.', ...FAILURE };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.PUT('/v1/ordered-tests/{id}/results/{analyteId}', {
    params: { path: { id: orderedTestId, analyteId } },
    body: { dataType: 'ordinal', valueCode, notes, notesAiOriginated, notesAiDisposition },
  });
  if (!response.ok || !data) {
    return { status: 'error', error: writeErrorMessage(response.status), ...FAILURE };
  }
  return {
    status: 'ok',
    valueNum: null,
    valueCode: data.valueCode,
    notes: data.notes,
    notesAiOriginated: data.notesAiOriginated,
    notesAiDisposition: data.notesAiDisposition,
    flags: data.flags,
    refLow: data.refLow,
    refHigh: data.refHigh,
    observationStatus: data.status,
  };
}

/**
 * FEAT-042: proposes a starter narrative for the analyte's already-drafted
 * grade (the API's own `draftNarrative()` reads the persisted valueCode,
 * not a client-supplied one -- see its own header comment). Never writes
 * anything itself; the technologist's own subsequent draft/finalize call is
 * what actually persists the (possibly edited) text.
 */
export async function draftNarrative(
  orderedTestId: string,
  analyteId: string,
): Promise<{ status: 'ok'; narrative: string } | { status: 'error'; error: string }> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.' };
  }
  const client = createLisApiClient(accessToken);

  // Not run through @ZodResponse (same gap finalize()'s own comment above
  // documents -- observation.controller.ts's draftNarrative() returns a
  // plain object, no OpenAPI response schema, hence the manual cast).
  const { data, response } = await client.POST(
    '/v1/ordered-tests/{id}/results/{analyteId}/draft-narrative',
    { params: { path: { id: orderedTestId, analyteId } } },
  );
  if (!response.ok || !data) {
    if (response.status === 409) {
      return { status: 'error', error: 'Select a morphology grade before drafting a narrative.' };
    }
    return { status: 'error', error: writeErrorMessage(response.status) };
  }
  const narrative = (data as unknown as { narrative: string }).narrative;
  return { status: 'ok', narrative };
}

export async function finalizeResult(
  orderedTestId: string,
  analyteId: string,
  valueNum: number,
): Promise<ResultActionOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.', ...FAILURE };
  }
  const client = createLisApiClient(accessToken);

  const { data, error, response } = await client.POST('/v1/ordered-tests/{id}/results/{analyteId}/finalize', {
    params: { path: { id: orderedTestId, analyteId } },
    body: { dataType: 'quantity', valueNum },
  });
  if (!response.ok || !data) {
    // ADR-0021 / issue #400: distinguish "the write committed, the panel is
    // just held" from every other 409/failure -- openapi-fetch already
    // parses the problem+json body into `error` (finalize's error responses
    // aren't in the generated OpenAPI schema, hence the manual cast, same as
    // the success-path `after` casts below).
    const problem = error as PanelHoldProblem | undefined;
    if (response.status === 409 && problem?.code === 'panel_hold') {
      return {
        status: 'held',
        heldMessage: problem.detail,
        heldReason: problem.reason,
        valueNum: problem.heldObservation.valueNum,
        flags: problem.heldObservation.flags,
        refLow: problem.heldObservation.refLow,
        refHigh: problem.heldObservation.refHigh,
        observationStatus: problem.heldObservation.status,
        calculatedDependents: (problem.heldCalculatedDependents ?? []).map((dep) => ({
          analyteId: dep.analyteId,
          valueNum: dep.valueNum,
          flags: dep.flags,
          refLow: dep.refLow,
          refHigh: dep.refHigh,
          observationStatus: dep.status,
        })),
      };
    }
    return { status: 'error', error: writeErrorMessage(response.status), ...FAILURE };
  }
  // Not run through @ZodResponse (same {resourceId, before, after} shape as
  // order/specimen's own create()/cancel() -- observation.controller.ts's
  // own header comment explains why finalize is audited this way).
  // TASK-053 (FEAT-014 revision §1 finding #4): `after` is always
  // `{ observation, calculatedDependents }`, not a flat ObservationResult.
  // TASK-072 (FEAT-023): `calculatedDependents` is an array (possibly
  // empty), not a nullable singular -- a differential's shared WBC trigger
  // can cascade up to five dependents in one finalize call.
  const after = (
    data as unknown as {
      after: {
        observation: {
          valueNum: number | null;
          flags: string[];
          refLow: number | null;
          refHigh: number | null;
          status: 'registered' | 'preliminary';
        };
        calculatedDependents: {
          analyteId: string;
          valueNum: number | null;
          flags: string[];
          refLow: number | null;
          refHigh: number | null;
          status: 'registered' | 'preliminary';
        }[];
      };
    }
  ).after;
  return {
    status: 'ok',
    valueNum: after.observation.valueNum,
    flags: after.observation.flags,
    refLow: after.observation.refLow,
    refHigh: after.observation.refHigh,
    observationStatus: after.observation.status,
    calculatedDependents: after.calculatedDependents.map((dep) => ({
      analyteId: dep.analyteId,
      valueNum: dep.valueNum,
      flags: dep.flags,
      refLow: dep.refLow,
      refHigh: dep.refHigh,
      observationStatus: dep.status,
    })),
  };
}

/**
 * FEAT-024 (ADR-0025): the `ordinal` counterpart to `finalizeResult` above
 * -- same panel_hold/`held` handling (a morphology grade participates in
 * the same finalize/roll-up path as any other analyte; no reason to expect
 * a peripheral film panel could never itself hold, e.g. an unrelated
 * co-ordered analyte's own critical), same manual `after` cast (finalize's
 * response isn't run through `@ZodResponse`, see `finalizeResult`'s own
 * comment above).
 */
export async function finalizeMorphologyResult(
  orderedTestId: string,
  analyteId: string,
  valueCode: MorphologyGrade,
  notes?: string,
  notesAiOriginated?: boolean,
  notesAiDisposition?: 'accepted' | 'edited',
): Promise<ResultActionOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.', ...FAILURE };
  }
  const client = createLisApiClient(accessToken);

  const { data, error, response } = await client.POST('/v1/ordered-tests/{id}/results/{analyteId}/finalize', {
    params: { path: { id: orderedTestId, analyteId } },
    body: { dataType: 'ordinal', valueCode, notes, notesAiOriginated, notesAiDisposition },
  });
  if (!response.ok || !data) {
    const problem = error as PanelHoldProblem | undefined;
    if (response.status === 409 && problem?.code === 'panel_hold') {
      return {
        status: 'held',
        heldMessage: problem.detail,
        heldReason: problem.reason,
        valueNum: problem.heldObservation.valueNum,
        valueCode: problem.heldObservation.valueCode,
        notes: problem.heldObservation.notes,
        notesAiOriginated: problem.heldObservation.notesAiOriginated,
        notesAiDisposition: problem.heldObservation.notesAiDisposition,
        flags: problem.heldObservation.flags,
        refLow: problem.heldObservation.refLow,
        refHigh: problem.heldObservation.refHigh,
        observationStatus: problem.heldObservation.status,
      };
    }
    return { status: 'error', error: writeErrorMessage(response.status), ...FAILURE };
  }
  const after = (
    data as unknown as {
      after: {
        observation: {
          valueCode: string | null;
          notes: string | null;
          notesAiOriginated: boolean;
          notesAiDisposition: 'accepted' | 'edited' | null;
          flags: string[];
          refLow: number | null;
          refHigh: number | null;
          status: 'registered' | 'preliminary';
        };
      };
    }
  ).after;
  return {
    status: 'ok',
    valueNum: null,
    valueCode: after.observation.valueCode,
    notes: after.observation.notes,
    notesAiOriginated: after.observation.notesAiOriginated,
    notesAiDisposition: after.observation.notesAiDisposition,
    flags: after.observation.flags,
    refLow: after.observation.refLow,
    refHigh: after.observation.refHigh,
    observationStatus: after.observation.status,
  };
}

/**
 * TASK-057 (FEAT-015 revision §2). Calls TASK-055's already-shipped bare
 * `POST .../verify` (no body) -- same shape as `finalizeResult()` above,
 * called imperatively from `results-grid.tsx`'s own verify affordance via
 * `useTransition`, same precedent as `draftResult()`/`finalizeResult()`.
 * The API's own `verify` capability guard (verifier-only, TASK-055) is the
 * real enforcement point; `apps/web/auth/roles.ts`'s `hasVerifierRole()` only
 * decides whether this screen even shows the control that would call this.
 */
export async function verifyResult(
  orderedTestId: string,
  analyteId: string,
): Promise<ResultActionOutcome> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return { status: 'error', error: 'Your session has expired — please log in again.', ...FAILURE };
  }
  const client = createLisApiClient(accessToken);

  const { data, response } = await client.POST('/v1/ordered-tests/{id}/results/{analyteId}/verify', {
    params: { path: { id: orderedTestId, analyteId } },
  });
  if (!response.ok || !data) {
    return { status: 'error', error: writeErrorMessage(response.status), ...FAILURE };
  }
  // Same "not run through @ZodResponse" shape as finalize()'s own
  // observation.controller.ts handler -- {resourceId, before, after}, not a
  // flat ObservationResult.
  const after = (
    data as unknown as {
      after: {
        observation: {
          valueNum: number | null;
          flags: string[];
          refLow: number | null;
          refHigh: number | null;
          status: 'preliminary' | 'verified';
          verifierUserId: string | null;
          verifiedAt: string | null;
        };
      };
    }
  ).after;
  return {
    status: 'ok',
    valueNum: after.observation.valueNum,
    flags: after.observation.flags,
    refLow: after.observation.refLow,
    refHigh: after.observation.refHigh,
    observationStatus: after.observation.status,
    verifierUserId: after.observation.verifierUserId,
    verifiedAt: after.observation.verifiedAt,
  };
}
