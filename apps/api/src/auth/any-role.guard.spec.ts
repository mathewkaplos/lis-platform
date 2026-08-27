import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AnyRoleGuard } from './any-role.guard';

function makeContext(roles: string[]): ExecutionContext {
  const request = {
    authContext: { sub: 'user-1', tenantId: 'tenant-1', roles },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AnyRoleGuard', () => {
  it('allows a caller with at least one role', () => {
    const guard = new AnyRoleGuard();
    expect(guard.canActivate(makeContext(['technologist']))).toBe(true);
  });

  it('denies (403) a caller with zero roles — issue #762', () => {
    const guard = new AnyRoleGuard();
    expect(() => guard.canActivate(makeContext([]))).toThrow(
      ForbiddenException,
    );
  });
});
