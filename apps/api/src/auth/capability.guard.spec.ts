import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityGuard } from './capability.guard';
import { CAPABILITY_KEY } from './require-capability.decorator';

function makeContext(roles: string[]): ExecutionContext {
  const request = {
    authContext: { sub: 'user-1', tenantId: 'tenant-1', roles },
  };
  return {
    getHandler: () => ({}) as never,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(capability: string | undefined): Reflector {
  return { get: () => capability } as unknown as Reflector;
}

describe('CapabilityGuard', () => {
  it('allows a route with no @RequireCapability() metadata', () => {
    const guard = new CapabilityGuard(makeReflector(undefined));
    expect(guard.canActivate(makeContext([]))).toBe(true);
  });

  it('grants a matching capability and records the granting role', () => {
    const guard = new CapabilityGuard(makeReflector('enter_result'));
    const context = makeContext(['technologist']);
    expect(guard.canActivate(context)).toBe(true);
    const request = context
      .switchToHttp()
      .getRequest<{ grantingRole?: string }>();
    expect(request.grantingRole).toBe('technologist');
  });

  it('denies (403) when no held role grants the capability', () => {
    const guard = new CapabilityGuard(makeReflector('verify'));
    expect(() => guard.canActivate(makeContext(['technologist']))).toThrow(
      ForbiddenException,
    );
  });

  it('denies (403) for an empty roles array — ADR-0011 fail-closed AC', () => {
    const guard = new CapabilityGuard(makeReflector('enter_result'));
    expect(() => guard.canActivate(makeContext([]))).toThrow(
      ForbiddenException,
    );
  });

  it('reads the capability metadata via CAPABILITY_KEY off the route handler', () => {
    const get = vi.fn().mockReturnValue('enter_result');
    const guard = new CapabilityGuard({ get } as unknown as Reflector);
    guard.canActivate(makeContext(['technologist']));
    expect(get).toHaveBeenCalledWith(CAPABILITY_KEY, expect.anything());
  });
});
