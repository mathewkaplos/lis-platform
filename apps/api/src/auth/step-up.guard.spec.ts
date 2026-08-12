import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { StepUpGuard, STEP_UP_MAX_AGE_SECONDS } from './step-up.guard';
import { StepUpRequiredException } from './step-up-required.exception';
import { STEP_UP_KEY } from './require-step-up.decorator';

function makeContext(authTime: number): ExecutionContext {
  const request = {
    authContext: { sub: 'user-1', tenantId: 'tenant-1', roles: [], authTime },
  };
  return {
    getHandler: () => ({}) as never,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(requiresStepUp: boolean | undefined): Reflector {
  return { get: () => requiresStepUp } as unknown as Reflector;
}

describe('StepUpGuard', () => {
  it('allows a route with no @RequireStepUp() metadata regardless of authTime', () => {
    const guard = new StepUpGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext(0))).toBe(true);
  });

  it('allows a fresh authTime (just now)', () => {
    const guard = new StepUpGuard(makeReflector(true));
    const now = Math.floor(Date.now() / 1000);
    expect(guard.canActivate(makeContext(now))).toBe(true);
  });

  it('denies (403 step_up_required) an authTime older than STEP_UP_MAX_AGE_SECONDS', () => {
    const guard = new StepUpGuard(makeReflector(true));
    const now = Math.floor(Date.now() / 1000);
    const stale = now - STEP_UP_MAX_AGE_SECONDS - 1;
    expect(() => guard.canActivate(makeContext(stale))).toThrow(
      StepUpRequiredException,
    );
  });

  it("denies authTime=0 (JwtAuthGuard's default for a token with no claim) — fails closed", () => {
    const guard = new StepUpGuard(makeReflector(true));
    expect(() => guard.canActivate(makeContext(0))).toThrow(
      StepUpRequiredException,
    );
  });

  it('reads the metadata via STEP_UP_KEY off the route handler', () => {
    let requestedKey: unknown;
    const reflector = {
      get: (key: unknown) => {
        requestedKey = key;
        return true;
      },
    } as unknown as Reflector;
    const guard = new StepUpGuard(reflector);
    const now = Math.floor(Date.now() / 1000);
    guard.canActivate(makeContext(now));
    expect(requestedKey).toBe(STEP_UP_KEY);
  });
});
