import {
  Body,
  ConflictException,
  Controller,
  Inject,
  Post,
} from '@nestjs/common';
import { signUpSchema } from '@lis/domain';
import { createZodDto, ZodValidationPipe } from 'nestjs-zod';
import { UserAlreadyExistsError } from './keycloak-user.service';
import { OnboardingService } from './onboarding.service';

class SignUpDto extends createZodDto(signUpSchema) {}

/**
 * FEAT-049: the one deliberately public, unauthenticated, mutating route in
 * this codebase — no `JwtAuthGuard`/`TenantContextInterceptor`, because
 * there is no tenant to authenticate against yet. Every other controller in
 * this repo gates every route; this is the single, explicit exception,
 * documented as such rather than an oversight.
 *
 * Rate-limiting/CAPTCHA/email-verification are explicitly out of scope for
 * this slice (approved proposal §10 Q4) — tracked as a required follow-up
 * before any real public launch, not silently shipped as solved.
 */
@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  @Post('signup')
  async signUp(@Body(new ZodValidationPipe(signUpSchema)) body: SignUpDto) {
    try {
      const result = await this.onboarding.signUp(body);
      return result;
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }
  }
}
