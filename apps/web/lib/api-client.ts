import { createApiClient } from '@lis/sdk';

/**
 * TASK-040: `apps/web`'s own thin wrapper around `@lis/sdk`'s
 * `createApiClient` — bakes in `API_BASE_URL` so call sites don't repeat
 * that env-var lookup. Still returns a **fresh** client per call (see
 * `@lis/sdk`'s own header comment for why) — `accessToken` must come from
 * `getValidAccessToken()` (`auth/access-token.ts`), called fresh in the same
 * Server Action/Route Handler that uses this client, never cached.
 */
export function createPatientApiClient(accessToken: string) {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  return createApiClient(baseUrl, accessToken);
}
