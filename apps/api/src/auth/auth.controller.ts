import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { RequestContext } from './request-context';

/**
 * /auth/me is the concrete route TASK-029's AC is verified against: no
 * clinical/business route exists yet (M3+) to hang the guard on, and a
 * "who am I" diagnostic endpoint is genuinely useful on its own, not just a
 * test fixture.
 */
@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: RequestContext): RequestContext {
    return user;
  }
}
