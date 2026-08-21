import { describe, expect, it } from 'vitest';
import type { SessionPayload } from './session';
import {
  hasBillingRole,
  hasLabAdminRole,
  hasPatientManagementRole,
  hasPathologistRole,
  hasQaRole,
  hasSpecimenManagementRole,
  hasTechnologistRole,
} from './roles';

/**
 * Real, previously-untested gap: `roles.ts`'s seven helpers gate real UI
 * controls (bulk actions, admin screens, billing/facility forms) across the
 * app, several were touched directly by #701's role-model rename (verifier
 * -> pathologist) and #701/#703's new reception/cashier/lab_admin grants,
 * and none had any test coverage before this. Pure functions over a plain
 * object -- no I/O, so no reason to reach for a mock; this repo's own
 * `access-token.spec.ts` already establishes "test the real thing, not a
 * fake" as the house style, and there's nothing to fake here.
 */
function session(roles: string[]): SessionPayload {
  return {
    sub: 'test-sub',
    tenantId: 'test-tenant',
    roles,
    idToken: 'irrelevant',
    accessToken: 'irrelevant',
    refreshToken: 'irrelevant',
    accessTokenExpiresAt: 0,
  };
}

describe('hasPathologistRole', () => {
  it('grants for pathologist', () => {
    expect(hasPathologistRole(session(['pathologist']))).toBe(true);
  });
  it('denies for every other single role', () => {
    expect(hasPathologistRole(session(['technologist']))).toBe(false);
    expect(hasPathologistRole(session(['qa']))).toBe(false);
  });
});

describe('hasQaRole', () => {
  it('grants for qa', () => {
    expect(hasQaRole(session(['qa']))).toBe(true);
  });
  it('denies for pathologist/technologist', () => {
    expect(hasQaRole(session(['pathologist']))).toBe(false);
    expect(hasQaRole(session(['technologist']))).toBe(false);
  });
});

describe('hasTechnologistRole', () => {
  it('grants for technologist only, not pathologist', () => {
    expect(hasTechnologistRole(session(['technologist']))).toBe(true);
    expect(hasTechnologistRole(session(['pathologist']))).toBe(false);
  });
});

describe('hasPatientManagementRole', () => {
  it('grants for technologist, pathologist, and reception (#701)', () => {
    expect(hasPatientManagementRole(session(['technologist']))).toBe(true);
    expect(hasPatientManagementRole(session(['pathologist']))).toBe(true);
    expect(hasPatientManagementRole(session(['reception']))).toBe(true);
  });
  it('denies for roles with no manage_patients grant', () => {
    expect(hasPatientManagementRole(session(['qa']))).toBe(false);
    expect(hasPatientManagementRole(session(['cashier']))).toBe(false);
    expect(hasPatientManagementRole(session(['lab_admin']))).toBe(false);
  });
});

describe('hasSpecimenManagementRole', () => {
  it('grants for technologist and pathologist only', () => {
    expect(hasSpecimenManagementRole(session(['technologist']))).toBe(true);
    expect(hasSpecimenManagementRole(session(['pathologist']))).toBe(true);
  });
  it('denies reception -- manage_specimens is narrower than manage_patients', () => {
    expect(hasSpecimenManagementRole(session(['reception']))).toBe(false);
  });
});

describe('hasBillingRole', () => {
  it('grants for technologist, pathologist, and cashier (#701)', () => {
    expect(hasBillingRole(session(['technologist']))).toBe(true);
    expect(hasBillingRole(session(['pathologist']))).toBe(true);
    expect(hasBillingRole(session(['cashier']))).toBe(true);
  });
  it('denies reception -- manage_billing is a different grant than manage_patients', () => {
    expect(hasBillingRole(session(['reception']))).toBe(false);
  });
});

describe('hasLabAdminRole', () => {
  it('grants for lab_admin only', () => {
    expect(hasLabAdminRole(session(['lab_admin']))).toBe(true);
  });
  it('denies every other role, including qa', () => {
    expect(hasLabAdminRole(session(['qa']))).toBe(false);
    expect(hasLabAdminRole(session(['technologist']))).toBe(false);
  });
});

describe('every helper fails closed on missing/malformed session state', () => {
  const helpers = [
    hasPathologistRole,
    hasQaRole,
    hasTechnologistRole,
    hasPatientManagementRole,
    hasSpecimenManagementRole,
    hasBillingRole,
    hasLabAdminRole,
  ];

  it('denies for an undefined session', () => {
    for (const helper of helpers) {
      expect(helper(undefined)).toBe(false);
    }
  });

  it('denies for an empty roles array', () => {
    for (const helper of helpers) {
      expect(helper(session([]))).toBe(false);
    }
  });

  it('denies for a malformed (non-array) roles field, despite the type contract', () => {
    for (const helper of helpers) {
      const malformed = { ...session([]), roles: undefined } as unknown as SessionPayload;
      expect(helper(malformed)).toBe(false);
    }
  });

  it('multiple held roles: grants if ANY held role matches, order-independent', () => {
    expect(hasBillingRole(session(['qa', 'cashier']))).toBe(true);
    expect(hasBillingRole(session(['cashier', 'qa']))).toBe(true);
    expect(hasPatientManagementRole(session(['lab_admin', 'reception']))).toBe(true);
  });
});
