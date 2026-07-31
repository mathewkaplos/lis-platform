import { Controller, Get, UseGuards } from '@nestjs/common';
import { CapabilityGuard } from './capability.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RequireCapability } from './require-capability.decorator';
import type { RequestContext } from './request-context';

/**
 * TASK-032 (FEAT-009) proof routes — no real result-entry/verification
 * feature exists yet (M3/M4), so these prove the capability-check mechanism
 * structurally, same standard TASK-030's tenant-check.controller.ts already
 * established for RLS binding ahead of a real business feature needing it.
 * Not a business feature: never used for anything but this proof.
 */
@Controller('auth/capability-check')
export class CapabilityCheckController {
  @Get('enter-result')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('enter_result')
  enterResult(@CurrentUser() user: RequestContext) {
    return { sub: user.sub, tenantId: user.tenantId };
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('verify')
  verify(@CurrentUser() user: RequestContext) {
    return { sub: user.sub, tenantId: user.tenantId };
  }
}
