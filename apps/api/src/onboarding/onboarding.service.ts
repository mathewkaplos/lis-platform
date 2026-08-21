import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { seedStarterCatalog, tenant, writeAuditEvent } from '@lis/db';
import { sql } from 'drizzle-orm';
import { db } from '../auth/db';
import { KeycloakUserService } from './keycloak-user.service';

export interface SignUpInput {
  orgName: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface SignUpResult {
  tenantId: string;
  keycloakUserId: string;
}

/**
 * FEAT-049 (ADR-0040): the one path a new lab self-onboards through. No
 * `TenantContextInterceptor` runs ahead of this call — there is no tenant
 * yet — so this service binds `app.tenant_id` itself, inside its own
 * transaction, the same mechanism the interceptor uses for every other
 * request (ADR-0010), just self-initiated instead of request-triggered.
 *
 * Ordering (proposal §6): the Keycloak user is created *first*. If the
 * subsequent DB transaction then fails, the result is an orphaned Keycloak
 * user pointing at a `tenant_id` that was never created — harmless (no
 * data, easy to find and clean up) — never the reverse (a tenant/catalog
 * existing with no way to log into it).
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(KeycloakUserService)
    private readonly keycloakUsers: KeycloakUserService,
  ) {}

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const tenantId = randomUUID();

    const keycloakUser = await this.keycloakUsers.createUser({
      email: input.adminEmail,
      firstName: input.adminFirstName,
      lastName: input.adminLastName,
      password: input.adminPassword,
      tenantId,
      // Issue #702 (EPIC #697, decision on #698): was hard-coded 'qa', a
      // role with no manage_patients/manage_orders/manage_specimens/
      // manage_billing/verify -- the self-signup owner could not do any
      // lab work. 'lab_admin' is the real "runs this org" role (#701):
      // manage_org_settings + manage_users, so the owner can immediately
      // add a second staff account with a working role.
      role: 'lab_admin',
    });

    await db.transaction(async (tx) => {
      // Transaction-scoped, per ADR-0010 — cleared at COMMIT regardless of
      // physical connection, safe under apps/api's pooled pg.Pool.
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      );

      await tx.insert(tenant).values({
        id: tenantId,
        name: input.orgName,
        isolationTier: 'shared',
      });

      await writeAuditEvent(tx, {
        tenantId,
        actorPrincipalId: keycloakUser.id,
        actorRole: 'lab_admin',
        actorType: 'service',
        action: 'tenant.self_onboard',
        resourceType: 'tenant',
        resourceId: tenantId,
        after: { orgName: input.orgName, adminEmail: input.adminEmail },
      });
    });

    // Outside the transaction above: seedStarterCatalog opens and commits
    // its own transaction against the raw pool (it re-runs the existing
    // db-reset.sh seed files verbatim, which are plain multi-statement SQL,
    // not drizzle queries — see tenant-catalog-seed.ts's own header
    // comment). Sequenced after the tenant row commits, since the seed
    // files' tenant-scoped inserts have no FK requiring the row to exist
    // first, but doing so anyway keeps the tenant's own existence as the
    // one fact that's true before anything else is attempted.
    await seedStarterCatalog(db.$client, tenantId);

    return { tenantId, keycloakUserId: keycloakUser.id };
  }
}
