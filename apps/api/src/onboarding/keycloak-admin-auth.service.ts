import { Injectable } from '@nestjs/common';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/**
 * ADR-0040: client-credentials grant against `lis-onboarding` -- a
 * dedicated service-account client granted only the `manage-users` role on
 * Keycloak's built-in `realm-management` client, the narrowest credential
 * that can create a real Keycloak user (verified live: this exact grant,
 * nothing broader, successfully created a user via a cold-imported realm).
 * Mirrors `apps/interop/src/auth/interop-auth.service.ts`'s cache-and-
 * refresh shape and plain-`fetch` convention exactly -- deliberately not
 * shared as a common package yet, same accepted-duplication reasoning that
 * service's own header comment already states for its own near-identical
 * sibling (`apps/gateway`'s `GatewayAuthService`).
 */
@Injectable()
export class KeycloakAdminAuthService {
  private cache: TokenCache | null = null;

  private get issuerUrl(): string {
    return (
      process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/lis'
    );
  }

  private get clientId(): string {
    return process.env.ONBOARDING_CLIENT_ID ?? 'lis-onboarding';
  }

  private get clientSecret(): string {
    return (
      process.env.ONBOARDING_CLIENT_SECRET ?? 'dev-only-lis-onboarding-secret'
    );
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now + 5_000) {
      return this.cache.accessToken;
    }

    const response = await fetch(
      `${this.issuerUrl}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `onboarding Keycloak admin auth failed: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.cache = {
      accessToken: body.access_token,
      expiresAt: now + body.expires_in * 1000,
    };
    return body.access_token;
  }

  /** Called on a 401 from the Keycloak Admin API -- force a fresh grant on
   * the next call, same reasoning as InteropAuthService.invalidate(). */
  invalidate(): void {
    this.cache = null;
  }
}
