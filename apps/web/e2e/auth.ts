import type { Page } from '@playwright/test';

/**
 * A real OIDC login, driving the actual redirect to Keycloak's own hosted
 * login page and typing real credentials into it -- not the `web-verify`
 * Skill's session-cookie-signing shortcut (that recipe exists for quick
 * manual spot-checks; this harness's whole point is exercising the real
 * production auth path end to end, same reasoning `access-token.spec.ts`'s
 * own header comment gives for calling a real Keycloak token endpoint
 * instead of mocking one).
 */
async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/api/auth/login');
  await page.waitForURL(/\/realms\/lis\/protocol\/openid-connect\/auth/);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#kc-login');
  // `next dev`'s own on-demand route compilation makes the very first hit
  // on `/api/auth/callback` and then the destination page each take
  // 10-15+s the first time in a freshly-started dev server (this repo's
  // own already-documented gotcha, real deployments have no such delay --
  // see the pilot-readiness report's own §Facilities & patients
  // correction) -- confirmed live: a first run of this exact login timed
  // out at the default 30s, but the captured page snapshot at the moment
  // of timeout already showed the fully authenticated dashboard, proving
  // the login itself succeeded and this was purely a cold-compile speed
  // issue, not a real bug. A generous explicit timeout here, not a global
  // bump, since only this first navigation is ever genuinely slow.
  await page.waitForURL((url) => url.origin === 'http://localhost:3000', { timeout: 60_000 });
  // `waitForURL` only proves the browser has landed on the right origin,
  // not that the app's own post-callback redirect chain (the OIDC
  // callback route itself redirects to `/`) and initial hydration have
  // both fully settled -- confirmed live: without this, an immediate
  // `page.goto()` right after login intermittently aborted with
  // `net::ERR_ABORTED`, racing a still-in-flight navigation this one step
  // wasn't waiting for.
  await page.waitForLoadState('networkidle');
}

// test-user: seeded `technologist` role, TENANT_A -- same fixture every
// apps/api e2e spec already relies on (infra/keycloak/lis-realm.json).
export async function loginAsTechnologist(page: Page): Promise<void> {
  await login(page, 'test-user', 'test-password');
}

// test-user-11: seeded `lab_admin` role, TENANT_A (#701/#703).
export async function loginAsLabAdmin(page: Page): Promise<void> {
  await login(page, 'test-user-11', 'test-password-11');
}

// test-user-4: seeded `technologist`+`pathologist` roles, TENANT_A -- same
// verifier/sign-out fixture apps/api's own case-sign-out.e2e-spec.ts and
// auto-verify.e2e-spec.ts already rely on. Real Authorization Code + PKCE
// browser login (this file's own `login()`), unlike those API specs' own
// direct-grant token fetch -- confirmed via apps/api/test/get-keycloak-
// fresh-token.ts's own header comment that direct-grant tokens on this
// realm carry no auth_time at all, so only this browser-driven login path
// can ever produce a StepUpGuard-fresh session (needed for signOutCase).
export async function loginAsPathologist(page: Page): Promise<void> {
  await login(page, 'test-user-4', 'test-password-4');
}

// test-user-5: seeded `qa` role, TENANT_A -- holds manage_catalog/
// manage_org_settings (apps/api/src/auth/capabilities.ts), the same
// fixture apps/api's own antibiogram.e2e-spec.ts/amr-surveillance.e2e-
// spec.ts already rely on.
export async function loginAsQa(page: Page): Promise<void> {
  await login(page, 'test-user-5', 'test-password-5');
}
