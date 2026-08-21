import { Inject, Injectable } from '@nestjs/common';
import { KeycloakAdminAuthService } from './keycloak-admin-auth.service';

interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  tenantId: string;
  role: string;
}

export interface CreatedUser {
  id: string;
}

export interface KeycloakUserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  attributes?: Record<string, string[]>;
}

/** Confirmed live: Keycloak returns 409 with `{"errorMessage": "User exists
 * with same email"}` for a duplicate username/email on user creation. */
export class UserAlreadyExistsError extends Error {}

/**
 * ADR-0040: the only writer of new Keycloak users in this codebase. Every
 * prior user was provisioned via `lis-realm.json`'s bulk import
 * (`authentication` Skill entry #10) -- this is the first live write.
 *
 * Two real requirements confirmed empirically while building this, not
 * assumed from documentation:
 * - A user created with only `username`/`attributes` set fails login with
 *   "Account is not fully set up" until `email`/`firstName`/`lastName` are
 *   also present (the profile's own required-field validation, distinct
 *   from the `unmanagedAttributePolicy` fix). This service always sets all
 *   three at creation time, not as a follow-up.
 * - Assigning a realm role requires the role's own `id` (not just its
 *   `name`) in the request body -- fetched once per call, mirroring the
 *   exact shape `GET /admin/realms/lis/roles/{name}` returns.
 */
@Injectable()
export class KeycloakUserService {
  constructor(
    @Inject(KeycloakAdminAuthService)
    private readonly auth: KeycloakAdminAuthService,
  ) {}

  private get issuerUrl(): string {
    return (
      process.env.KEYCLOAK_ISSUER_URL ?? 'http://localhost:8080/realms/lis'
    );
  }

  private get adminBaseUrl(): string {
    // KEYCLOAK_ISSUER_URL is .../realms/lis -- the Admin REST API lives at
    // .../admin/realms/lis, not under /realms/lis itself.
    return this.issuerUrl.replace('/realms/', '/admin/realms/');
  }

  async createUser(input: CreateUserInput): Promise<CreatedUser> {
    const token = await this.auth.getToken();

    const createResponse = await fetch(`${this.adminBaseUrl}/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: input.email,
        email: input.email,
        emailVerified: true,
        firstName: input.firstName,
        lastName: input.lastName,
        enabled: true,
        attributes: { tenant_id: [input.tenantId] },
        credentials: [
          { type: 'password', value: input.password, temporary: false },
        ],
      }),
    });
    if (createResponse.status === 409) {
      throw new UserAlreadyExistsError(
        `A user with email ${input.email} already exists`,
      );
    }
    if (!createResponse.ok) {
      throw new Error(
        `Keycloak user creation failed: ${createResponse.status} ${await createResponse.text()}`,
      );
    }
    const location = createResponse.headers.get('Location');
    const userId = location?.split('/').pop();
    if (!userId) {
      throw new Error(
        'Keycloak user creation succeeded but returned no Location header to read the new user id from',
      );
    }

    await this.assignRealmRole(userId, input.role, token);

    return { id: userId };
  }

  /**
   * Issue #703 (EPIC #697): also used by the user-management screen to
   * assign/change a role on an existing user, not just at creation time --
   * kept `async`/exported-via-class-method rather than folded into
   * `createUser`, since it's the one piece of role-assignment logic both
   * paths need identically.
   */
  async assignRealmRole(
    userId: string,
    roleName: string,
    token: string,
  ): Promise<void> {
    const roleResponse = await fetch(`${this.adminBaseUrl}/roles/${roleName}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!roleResponse.ok) {
      throw new Error(
        `Keycloak role lookup for '${roleName}' failed: ${roleResponse.status} ${await roleResponse.text()}`,
      );
    }
    const role = (await roleResponse.json()) as { id: string; name: string };

    const assignResponse = await fetch(
      `${this.adminBaseUrl}/users/${userId}/role-mappings/realm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([role]),
      },
    );
    if (!assignResponse.ok) {
      throw new Error(
        `Keycloak role assignment failed: ${assignResponse.status} ${await assignResponse.text()}`,
      );
    }
  }

  /**
   * Issue #703: `q=tenant_id:<value>` searches the custom user attribute
   * (Keycloak's declarative-user-profile with `unmanagedAttributePolicy:
   * ENABLED`, same profile config `lis-realm.json` already sets) -- the
   * only tenant boundary that exists for Keycloak users at all, since there
   * is no local `user` table/RLS to lean on instead (Keycloak is the sole
   * source of truth for user records in this codebase).
   */
  async listUsersByTenant(tenantId: string): Promise<KeycloakUserRecord[]> {
    const token = await this.auth.getToken();
    const response = await fetch(
      `${this.adminBaseUrl}/users?q=${encodeURIComponent(`tenant_id:${tenantId}`)}&max=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new Error(
        `Keycloak user list failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as KeycloakUserRecord[];
  }

  /**
   * Issue #703: fetches one user by id -- used to verify the target belongs
   * to the caller's own tenant before any role/enabled change, since
   * `PATCH /v1/users/:id/...` takes an id directly and nothing else scopes
   * it to the caller's tenant otherwise (an unscoped id lookup would let a
   * `lab_admin` from one tenant act on a user id it happened to guess from
   * another tenant).
   */
  async getUser(userId: string): Promise<KeycloakUserRecord | undefined> {
    const token = await this.auth.getToken();
    const response = await fetch(`${this.adminBaseUrl}/users/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `Keycloak user lookup failed: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as KeycloakUserRecord;
  }

  async listRealmRoles(userId: string): Promise<string[]> {
    const token = await this.auth.getToken();
    const response = await fetch(
      `${this.adminBaseUrl}/users/${userId}/role-mappings/realm`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new Error(
        `Keycloak role-mapping lookup failed: ${response.status} ${await response.text()}`,
      );
    }
    const roles = (await response.json()) as { name: string }[];
    return roles.map((r) => r.name);
  }

  /**
   * Issue #703: removes only the roles named in `roleNames` -- never a
   * blanket "clear all realm roles" -- so a role-change call can safely
   * replace just the caller's one assignable staff role (see
   * `ASSIGNABLE_STAFF_ROLES`) without touching any other realm role a user
   * might independently hold.
   */
  async removeRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    if (roleNames.length === 0) return;
    const token = await this.auth.getToken();
    const roles = await Promise.all(
      roleNames.map(async (name) => {
        const res = await fetch(`${this.adminBaseUrl}/roles/${name}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(
            `Keycloak role lookup for '${name}' failed: ${res.status} ${await res.text()}`,
          );
        }
        return (await res.json()) as { id: string; name: string };
      }),
    );
    const response = await fetch(
      `${this.adminBaseUrl}/users/${userId}/role-mappings/realm`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(roles),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Keycloak role removal failed: ${response.status} ${await response.text()}`,
      );
    }
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    const token = await this.auth.getToken();
    const response = await fetch(`${this.adminBaseUrl}/users/${userId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      throw new Error(
        `Keycloak user enable/disable failed: ${response.status} ${await response.text()}`,
      );
    }
  }
}
