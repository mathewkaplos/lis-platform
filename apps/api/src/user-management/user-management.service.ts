import { Inject, Injectable } from '@nestjs/common';
import type { AssignableStaffRole, UserSummary } from '@lis/domain';
import { ASSIGNABLE_STAFF_ROLES } from '@lis/domain';
import { KeycloakAdminAuthService } from '../onboarding/keycloak-admin-auth.service';
import {
  KeycloakUserService,
  UserAlreadyExistsError,
  type KeycloakUserRecord,
} from '../onboarding/keycloak-user.service';

export { UserAlreadyExistsError };

/** Thrown when a caller acts on a user id that exists but belongs to a
 * different tenant -- kept distinct from "not found" so the controller can
 * choose a 404 either way (never leak that the id exists in another
 * tenant), while still being a real, separately-testable code path. */
export class UserNotInTenantError extends Error {}

const ASSIGNABLE_ROLE_SET: readonly string[] = ASSIGNABLE_STAFF_ROLES;

/**
 * Issue #703 (EPIC #697): the one service both `GET/POST/PATCH /v1/users`
 * and any future user-management surface should go through -- owns the
 * tenant-ownership check every mutation needs (`KeycloakUserService` itself
 * is a thin, tenant-unaware Keycloak Admin API wrapper, same layering
 * `OnboardingService` already established over the same client).
 */
@Injectable()
export class UserManagementService {
  constructor(
    @Inject(KeycloakUserService)
    private readonly keycloakUsers: KeycloakUserService,
    @Inject(KeycloakAdminAuthService)
    private readonly auth: KeycloakAdminAuthService,
  ) {}

  async listUsers(tenantId: string): Promise<UserSummary[]> {
    const records = await this.keycloakUsers.listUsersByTenant(tenantId);
    // Service-account users (e.g. `service-account-lis-gateway`) share the
    // same `tenant_id` attribute search as real staff accounts but carry no
    // email/firstName/lastName in this realm (confirmed live: `lis-realm.json`
    // never sets those fields for a service account) -- filtered out here,
    // not with a Keycloak-side query, since this screen's whole purpose is
    // human staff management, not machine credentials.
    const humanRecords = records.filter((record) => Boolean(record.email));
    const withRoles = await Promise.all(
      humanRecords.map(async (record) => ({
        record,
        roles: await this.keycloakUsers.listRealmRoles(record.id),
      })),
    );
    return withRoles.map(({ record, roles }) => toUserSummary(record, roles));
  }

  async createUser(
    tenantId: string,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      role: AssignableStaffRole;
    },
  ): Promise<{ resourceId: string; after: UserSummary }> {
    const created = await this.keycloakUsers.createUser({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      password: input.password,
      tenantId,
      role: input.role,
    });
    return {
      resourceId: created.id,
      after: {
        id: created.id,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        roles: [input.role],
      },
    };
  }

  async changeRole(
    tenantId: string,
    userId: string,
    role: AssignableStaffRole,
  ): Promise<{ resourceId: string; before: UserSummary; after: UserSummary }> {
    const record = await this.requireUserInTenant(tenantId, userId);
    const currentRoles = await this.keycloakUsers.listRealmRoles(userId);
    const before = toUserSummary(record, currentRoles);

    // Only ever remove roles from within the assignable staff set (see
    // ASSIGNABLE_STAFF_ROLES's own comment) -- never touches a role this
    // screen doesn't itself manage (a machine role could never land here,
    // but this guards against a future assignable-set expansion silently
    // becoming overbroad).
    const staffRolesToRemove = currentRoles.filter((r) =>
      ASSIGNABLE_ROLE_SET.includes(r),
    );
    await this.keycloakUsers.removeRealmRoles(userId, staffRolesToRemove);
    const token = await this.auth.getToken();
    await this.keycloakUsers.assignRealmRole(userId, role, token);

    const after = toUserSummary(record, [
      ...currentRoles.filter((r) => !ASSIGNABLE_ROLE_SET.includes(r)),
      role,
    ]);
    return { resourceId: userId, before, after };
  }

  async setEnabled(
    tenantId: string,
    userId: string,
    enabled: boolean,
  ): Promise<{ resourceId: string; before: UserSummary; after: UserSummary }> {
    const record = await this.requireUserInTenant(tenantId, userId);
    const roles = await this.keycloakUsers.listRealmRoles(userId);
    const before = toUserSummary(record, roles);
    await this.keycloakUsers.setEnabled(userId, enabled);
    const after = { ...before, enabled };
    return { resourceId: userId, before, after };
  }

  private async requireUserInTenant(
    tenantId: string,
    userId: string,
  ): Promise<KeycloakUserRecord> {
    const record = await this.keycloakUsers.getUser(userId);
    if (!record || record.attributes?.tenant_id?.[0] !== tenantId) {
      throw new UserNotInTenantError(`No user ${userId} in tenant ${tenantId}`);
    }
    return record;
  }
}

function toUserSummary(
  record: KeycloakUserRecord,
  roles: string[],
): UserSummary {
  return {
    id: record.id,
    email: record.email,
    firstName: record.firstName,
    lastName: record.lastName,
    enabled: record.enabled,
    roles,
  };
}
