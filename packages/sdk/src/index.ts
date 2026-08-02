import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { paths } from "./schema";

/**
 * ADR-0013 §1: generated from apps/api's live OpenAPI document
 * (`apps/api/openapi.json`, `pnpm --filter @lis/sdk generate`) — never a
 * hand-maintained parallel client.
 *
 * Returns a **fresh** client per call, with the `Authorization` header baked
 * in at creation time — never a module-scoped singleton reused across
 * requests. `openapi-fetch`'s own docs warn that caching a token in module
 * state is only safe for client applications, not server ones; `apps/web`
 * is a multi-tenant, multi-user server application (ADR-0014's
 * `getValidAccessToken()` resolves a different token per request), so a
 * cached client would leak one user's token onto another's request.
 */
export function createApiClient(baseUrl: string, accessToken: string) {
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
