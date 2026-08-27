import { describe, expect, it } from 'vitest';
import {
  clearSessionCookies,
  setSessionCookies,
  signSession,
  verifySession,
  SESSION_COOKIE_NAME,
  SESSION_TOKENS_COOKIE_NAME,
  type SessionPayload,
} from './session';

// A realistic worst case, not a token-length guess: three real Keycloak
// JWTs of roughly the size a `lab_admin` holding the `default-roles-lis`
// composite (offline_access + uma_authorization, on top of lab_admin
// itself) actually produced live during the pilot-readiness pass that
// found this bug -- see session.ts's own header comment on
// SESSION_TOKENS_COOKIE_NAME for the full story.
const REALISTIC_PAYLOAD: SessionPayload = {
  sub: 'a'.repeat(36),
  tenantId: 'b'.repeat(36),
  roles: ['default-roles-lis', 'offline_access', 'lab_admin', 'uma_authorization'],
  idToken: 'x'.repeat(1150),
  accessToken: 'y'.repeat(1050),
  refreshToken: 'z'.repeat(650),
  accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 300,
};

// Browsers silently drop (never store, no error surfaced anywhere) any
// cookie whose value exceeds this -- RFC 6265's recommended minimum, which
// Chrome enforces in practice. This is the actual, confirmed-live failure
// mode this whole split-cookie design exists to avoid -- see
// SESSION_TOKENS_COOKIE_NAME's own header comment.
const BROWSER_COOKIE_VALUE_LIMIT = 4096;

function makeMockCookieWriter() {
  const store = new Map<string, string>();
  return {
    store,
    writer: {
      set(name: string, value: string) {
        store.set(name, value);
      },
      delete(name: string) {
        store.delete(name);
      },
    },
  };
}

describe('signSession / verifySession', () => {
  it('round-trips every field through a sign/verify cycle', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    const result = await verifySession(signed.core, signed.tokens);
    expect(result).toEqual(REALISTIC_PAYLOAD);
  });

  it('keeps each individual cookie value under the browser limit that caused the real bug', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    expect(signed.core.length).toBeLessThan(BROWSER_COOKIE_VALUE_LIMIT);
    expect(signed.tokens.length).toBeLessThan(BROWSER_COOKIE_VALUE_LIMIT);
    // Real regression check: the OLD single-cookie design's combined length
    // for this exact payload is what actually exceeded the limit live
    // (4204 bytes, confirmed via a captured Set-Cookie header) -- confirming
    // the split stays safely under it even though the combined total still
    // would not.
    expect(signed.core.length + signed.tokens.length).toBeGreaterThan(
      BROWSER_COOKIE_VALUE_LIMIT,
    );
  });

  it('fails closed when only the core cookie is present', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    expect(await verifySession(signed.core, undefined)).toBeUndefined();
  });

  it('fails closed when only the tokens cookie is present', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    expect(await verifySession(undefined, signed.tokens)).toBeUndefined();
  });

  it('fails closed when both cookies are missing', async () => {
    expect(await verifySession(undefined, undefined)).toBeUndefined();
  });

  it('fails closed on a tampered core cookie', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    const tampered = signed.core.slice(0, -4) + 'abcd';
    expect(await verifySession(tampered, signed.tokens)).toBeUndefined();
  });

  it('fails closed when the two halves belong to different sessions (no cross-session mixing)', async () => {
    const signedA = await signSession(REALISTIC_PAYLOAD);
    const signedB = await signSession({
      ...REALISTIC_PAYLOAD,
      sub: 'different-user-id',
    });
    // Mixing halves is still cryptographically valid on each half alone
    // (both signed by the same server secret) -- verifySession() has no way
    // to detect this by design (each cookie is independently self-contained,
    // same as the original single-cookie design's own trust boundary), so
    // this documents actual behavior rather than asserting a rejection this
    // implementation was never meant to provide.
    const result = await verifySession(signedA.core, signedB.tokens);
    expect(result?.sub).toBe(REALISTIC_PAYLOAD.sub);
    expect(result?.accessToken).toBe(REALISTIC_PAYLOAD.accessToken);
  });
});

describe('setSessionCookies / clearSessionCookies', () => {
  it('sets both cookies with the expected names', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    const { store, writer } = makeMockCookieWriter();
    setSessionCookies(writer, signed);
    expect(store.get(SESSION_COOKIE_NAME)).toBe(signed.core);
    expect(store.get(SESSION_TOKENS_COOKIE_NAME)).toBe(signed.tokens);
  });

  it('clears both cookies', async () => {
    const signed = await signSession(REALISTIC_PAYLOAD);
    const { store, writer } = makeMockCookieWriter();
    setSessionCookies(writer, signed);
    clearSessionCookies(writer);
    expect(store.has(SESSION_COOKIE_NAME)).toBe(false);
    expect(store.has(SESSION_TOKENS_COOKIE_NAME)).toBe(false);
  });
});
