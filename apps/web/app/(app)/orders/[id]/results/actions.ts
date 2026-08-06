'use server';

import { getValidAccessToken } from '@/auth/access-token';
import { createLisApiClient } from '@/lib/api-client';

/** TASK-053 (FEAT-014 revision §2 finding #4): mirrors `finalize()`'s own
 * `calculatedDependent` -- a calculated analyte (eGFR/LDL) that cascaded off
 * this same finalize call, if any.
 *
 * `observationStatus` widened to include `'verified'` (TASK-055,
 * `packages/domain`'s `observationStatusSchema`) purely to type-check
 * against `@lis/sdk`'s now-wider shared `ObservationDto.status` -- `draft()`/
 * `finalize()` themselves never actually return `'verified'` (only the new
 * `verify()` action does, which this page/action file does not call yet).
 * No UI branch handles `'verified'` here; that's TASK-057's own scope. */
export interface CalculatedDependentOutcome {
  analyteId: string;
  valueNum: number | null;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified';
}

export interface ResultActionOutcome {
  status: 'ok' | 'error';
  error?: string;
  valueNum: number | null;
  flags: string[];
  refLow: number | null;
  refHigh: number | null;
  observationStatus: 'registered' | 'preliminary' | 'verified' | null;
  calculatedDependent?: CalculatedDependentOutcome | null;
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

  const { data, response } = await client.POST('/v1/ordered-tests/{id}/results/{analyteId}/finalize', {
    params: { path: { id: orderedTestId, analyteId } },
    body: { dataType: 'quantity', valueNum },
  });
  if (!response.ok || !data) {
    return { status: 'error', error: writeErrorMessage(response.status), ...FAILURE };
  }
  // Not run through @ZodResponse (same {resourceId, before, after} shape as
  // order/specimen's own create()/cancel() -- observation.controller.ts's
  // own header comment explains why finalize is audited this way).
  // TASK-053 (FEAT-014 revision §1 finding #4): `after` is now always
  // `{ observation, calculatedDependent }`, not a flat ObservationResult.
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
        calculatedDependent: {
          analyteId: string;
          valueNum: number | null;
          flags: string[];
          refLow: number | null;
          refHigh: number | null;
          status: 'registered' | 'preliminary';
        } | null;
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
    calculatedDependent: after.calculatedDependent
      ? {
          analyteId: after.calculatedDependent.analyteId,
          valueNum: after.calculatedDependent.valueNum,
          flags: after.calculatedDependent.flags,
          refLow: after.calculatedDependent.refLow,
          refHigh: after.calculatedDependent.refHigh,
          observationStatus: after.calculatedDependent.status,
        }
      : null,
  };
}
