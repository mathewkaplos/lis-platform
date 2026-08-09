import { Injectable } from '@nestjs/common';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/**
 * Client-credentials grant against the `lis-gateway` client (ADR-0026) --
 * caches the token and refreshes shortly before expiry rather than on every
 * forward call, mirroring the JWKS-cache pattern the api's own JwtAuthGuard
 * already uses (create once, reuse across calls).
 */
@Injectable()
export class GatewayAuthService {
  private cache: TokenCache | null = null;

  private get issuerUrl(): string {
    return (
      process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/lis'
    );
  }

  private get clientId(): string {
    return process.env.GATEWAY_CLIENT_ID ?? 'lis-gateway';
  }

  private get clientSecret(): string {
    return process.env.GATEWAY_CLIENT_SECRET ?? 'dev-only-lis-gateway-secret';
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
        `gateway auth failed: ${response.status} ${await response.text()}`,
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

  /** Called by the forwarder on a 401 -- the cached token may have been
   * revoked or the realm restarted; force a fresh grant on the next call. */
  invalidate(): void {
    this.cache = null;
  }
}
