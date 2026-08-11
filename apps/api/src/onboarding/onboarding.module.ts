import { Module } from '@nestjs/common';
import { KeycloakAdminAuthService } from './keycloak-admin-auth.service';
import { KeycloakUserService } from './keycloak-user.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController],
  providers: [KeycloakAdminAuthService, KeycloakUserService, OnboardingService],
})
export class OnboardingModule {}
