import { Inject, Injectable } from '@nestjs/common';
import { KeycloakAdminAuthService } from './keycloak-admin-auth.service';

interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  tenantId: string;
}

export interface CreatedUser {
  id: string;
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

    await this.assignRealmRole(userId, 'qa', token);

    return { id: userId };
  }

  private async assignRealmRole(
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
}
