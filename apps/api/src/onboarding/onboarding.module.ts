import { Module } from '@nestjs/common';
import { KeycloakAdminAuthService } from './keycloak-admin-auth.service';
import { KeycloakUserService } from './keycloak-user.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController],
  providers: [KeycloakAdminAuthService, KeycloakUserService, OnboardingService],
  // Issue #703: UserManagementModule reuses the same Keycloak admin client
  // (list/create/role-change/enable-disable are all the same "manage
  // Keycloak users" concern the signup path already implements) rather
  // than duplicating a second client against the same `lis-onboarding`
  // service account.
  exports: [KeycloakAdminAuthService, KeycloakUserService],
})
export class OnboardingModule {}
