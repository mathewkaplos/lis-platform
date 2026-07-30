import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { KEYCLOAK_ISSUER_URL, KEYCLOAK_JWKS_URI } from './keycloak-config';
import type { RequestContext } from './request-context';

// jose caches keys on the returned function internally — create once, reuse
// across every request, not per-request (would defeat the point of a JWKS
// cache and hammer Keycloak's certs endpoint on every call).
const jwks = createRemoteJWKSet(new URL(KEYCLOAK_JWKS_URI));

export type RequestWithAuthContext = FastifyRequest & {
  authContext: RequestContext;
};

interface LisTokenPayload extends JWTPayload {
  tenant_id?: unknown;
  realm_access?: { roles?: unknown };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);

    let payload: LisTokenPayload;
    try {
      const result = await jwtVerify<LisTokenPayload>(token, jwks, {
        issuer: KEYCLOAK_ISSUER_URL,
      });
      payload = result.payload;
    } catch {
      // Deliberately no detail in the response (expired vs. bad signature vs.
      // wrong issuer are all just "unauthenticated" to the caller) — the
      // distinction is only useful in logs, not in the 401 body.
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('Token missing sub claim');
    }
    if (
      typeof payload.tenant_id !== 'string' ||
      payload.tenant_id.length === 0
    ) {
      // Fails closed: a token that can't resolve a tenant is treated as
      // unauthenticated, not "authenticated with no tenant" — nothing
      // downstream is allowed to run without a resolved tenant context.
      throw new UnauthorizedException('Token missing tenant_id claim');
    }

    const roles = Array.isArray(payload.realm_access?.roles)
      ? (payload.realm_access.roles as string[])
      : [];

    request.authContext = {
      sub: payload.sub,
      tenantId: payload.tenant_id,
      roles,
    };
    return true;
  }
}
