import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  createUserSchema,
  updateUserEnabledSchema,
  updateUserRoleSchema,
  userListResponseSchema,
  type UserListResponse,
} from '@lis/domain';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { Audit } from '../auth/audit.decorator';
import { AuditInterceptor } from '../auth/audit.interceptor';
import { CapabilityGuard } from '../auth/capability.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestContext } from '../auth/request-context';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { UserAlreadyExistsError } from '../onboarding/keycloak-user.service';
import {
  UserManagementService,
  UserNotInTenantError,
} from './user-management.service';

class CreateUserDto extends createZodDto(createUserSchema) {}
class UpdateUserRoleDto extends createZodDto(updateUserRoleSchema) {}
class UpdateUserEnabledDto extends createZodDto(updateUserEnabledSchema) {}
class UserListResponseDto extends createZodDto(userListResponseSchema) {}

/**
 * Issue #703 (EPIC #697). The original pilot-readiness audit's #2 finding:
 * no UI anywhere to create/list/deactivate/role-assign a second staff
 * account. Every route here is `manage_users`-gated (granted only to
 * `lab_admin`, #701) -- including GET, unlike `OrgSettingsController`'s own
 * ungated GET, since a user list (names/emails/roles) is real identity
 * data, not an informational preference. Applied per-method, matching this
 * codebase's own established convention (every other controller gates
 * route-by-route, never at the class level, even when every route happens
 * to share one capability).
 *
 * `TenantContextInterceptor`/`AuditInterceptor`/`@Audit()` are applied to
 * every mutating route purely so `AuditInterceptor` has a transaction to
 * write the `audit_event` row through -- the actual mutation happens
 * against Keycloak, not Postgres (there is no local `user` table; Keycloak
 * is this codebase's sole source of truth for user records, same as
 * `OnboardingService`). Same ordering risk `OnboardingService`'s own header
 * comment already documents and accepts: the Keycloak call happens first,
 * so a failure in the audit DB write after a successful Keycloak mutation
 * leaves a real, correct Keycloak change with no matching audit row --
 * harmless and discoverable, never the reverse (a fabricated audit trail
 * for a mutation that didn't actually happen).
 */
@Controller('v1/users')
export class UserManagementController {
  constructor(private readonly userManagement: UserManagementService) {}

  @Get()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_users')
  @ZodResponse({ type: UserListResponseDto, status: 200 })
  async list(@CurrentUser() user: RequestContext): Promise<UserListResponse> {
    const items = await this.userManagement.listUsers(user.tenantId);
    return { items };
  }

  @Post()
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_users')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'user.create', resourceType: 'user' })
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto,
    @CurrentUser() user: RequestContext,
  ) {
    try {
      return await this.userManagement.createUser(user.tenantId, body);
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }

  @Patch(':id/role')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_users')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'user.role_change', resourceType: 'user' })
  async changeRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserRoleSchema)) body: UpdateUserRoleDto,
    @CurrentUser() user: RequestContext,
  ) {
    try {
      return await this.userManagement.changeRole(user.tenantId, id, body.role);
    } catch (err) {
      if (err instanceof UserNotInTenantError) {
        throw new NotFoundException(`No user ${id}`);
      }
      throw err;
    }
  }

  @Patch(':id/enabled')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_users')
  @UseInterceptors(TenantContextInterceptor, AuditInterceptor)
  @Audit({ action: 'user.set_enabled', resourceType: 'user' })
  async setEnabled(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserEnabledSchema))
    body: UpdateUserEnabledDto,
    @CurrentUser() user: RequestContext,
  ) {
    try {
      return await this.userManagement.setEnabled(
        user.tenantId,
        id,
        body.enabled,
      );
    } catch (err) {
      if (err instanceof UserNotInTenantError) {
        throw new NotFoundException(`No user ${id}`);
      }
      throw err;
    }
  }
}
