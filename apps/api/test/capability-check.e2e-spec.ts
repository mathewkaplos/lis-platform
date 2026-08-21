import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-032/TASK-033/ADR-0011: proves the role→capability model AND the
 * audit-emission mechanism through the live API, with real Keycloak-issued
 * tokens for a bench role (technologist), a verifier, a dual-role user, and
 * a user with no realm role at all (the exact state every token was in
 * before TASK-032 — ADR-0011's explicit fail-closed AC).
 */
describe('Capability checks + audit emission (e2e)', () => {
  let app: INestApplication<App>;
  let technologistToken: string;
  let verifierToken: string;
  let dualRoleToken: string;
  let noRoleToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [technologistToken, verifierToken, dualRoleToken, noRoleToken] =
      await Promise.all([
        getKeycloakToken('test-user', 'test-password'),
        getKeycloakToken('test-user-2', 'test-password-2'),
        getKeycloakToken('test-user-4', 'test-password-4'),
        getKeycloakToken('test-user-3', 'test-password-3'),
      ]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function auditCount(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/tenant-audit-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  async function orderCount(token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/auth/capability-check/order-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { count: number }).count;
  }

  it('a bench-role (technologist) user may enter_result, producing one audit_event row (TASK-033 AC)', async () => {
    const before = await auditCount(technologistToken);
    const res = await request(app.getHttpServer())
      .post('/auth/capability-check/enter-result')
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(201);
    const body = res.body as { resourceId: string; actorRole: string };
    if (typeof body.resourceId !== 'string' || body.resourceId.length === 0) {
      throw new Error(`expected a resourceId, got ${JSON.stringify(res.body)}`);
    }
    if (body.actorRole !== 'technologist') {
      throw new Error(
        `expected actorRole 'technologist', got ${JSON.stringify(res.body)}`,
      );
    }
    const after = await auditCount(technologistToken);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it(
    'a bench-role (technologist) user is refused verify, with NO audit_event or order row ' +
      'written (TASK-032 AC, capability check rejects before the mutation runs)',
    async () => {
      const auditBefore = await auditCount(technologistToken);
      const orderBefore = await orderCount(technologistToken);
      await request(app.getHttpServer())
        .post('/auth/capability-check/verify')
        .set('Authorization', `Bearer ${technologistToken}`)
        .expect(403);
      const auditAfter = await auditCount(technologistToken);
      const orderAfter = await orderCount(technologistToken);
      if (auditAfter !== auditBefore) {
        throw new Error(
          `expected no new audit_event row on 403, before=${auditBefore} after=${auditAfter}`,
        );
      }
      if (orderAfter !== orderBefore) {
        throw new Error(
          `expected no new order row on 403, before=${orderBefore} after=${orderAfter}`,
        );
      }
    },
  );

  it('a verifier may verify, producing one audit_event row attributed to verifier', async () => {
    const before = await auditCount(verifierToken);
    const res = await request(app.getHttpServer())
      .post('/auth/capability-check/verify')
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(201);
    const body = res.body as { actorRole: string };
    if (body.actorRole !== 'pathologist') {
      throw new Error(
        `expected actorRole 'pathologist', got ${JSON.stringify(res.body)}`,
      );
    }
    const after = await auditCount(verifierToken);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it('a verifier may also enter_result', () => {
    return request(app.getHttpServer())
      .post('/auth/capability-check/enter-result')
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(201);
  });

  it(
    'a dual-role (technologist + verifier) user resolves actor_role deterministically ' +
      '(FEAT-009 proposal §8 item 5)',
    async () => {
      const first = await request(app.getHttpServer())
        .post('/auth/capability-check/enter-result')
        .set('Authorization', `Bearer ${dualRoleToken}`)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/auth/capability-check/enter-result')
        .set('Authorization', `Bearer ${dualRoleToken}`)
        .expect(201);
      const roleA = (first.body as { actorRole: string }).actorRole;
      const roleB = (second.body as { actorRole: string }).actorRole;
      if (roleA !== roleB) {
        throw new Error(
          `expected the same granting role both times, got '${roleA}' then '${roleB}'`,
        );
      }
    },
  );

  it(
    'a user with no realm role assigned is refused every capability, with no audit row ' +
      '(ADR-0011 fail-closed AC)',
    async () => {
      const before = await auditCount(noRoleToken);
      await request(app.getHttpServer())
        .post('/auth/capability-check/enter-result')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .post('/auth/capability-check/verify')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
      const after = await auditCount(noRoleToken);
      if (after !== before) {
        throw new Error(
          `expected no audit_event rows for a no-role user, before=${before} after=${after}`,
        );
      }
    },
  );

  it('an unauthenticated request is refused before any capability check runs', () => {
    return request(app.getHttpServer())
      .post('/auth/capability-check/verify')
      .expect(401);
  });

  it(
    'a route with no @Audit() metadata performs its mutation with NO audit_event row ' +
      '(FEAT-009 proposal §8 item 7 — the mechanism is opt-in, not implicit)',
    async () => {
      const auditBefore = await auditCount(technologistToken);
      const orderBefore = await orderCount(technologistToken);
      await request(app.getHttpServer())
        .post('/auth/capability-check/enter-result-unaudited')
        .set('Authorization', `Bearer ${technologistToken}`)
        .expect(201);
      const auditAfter = await auditCount(technologistToken);
      const orderAfter = await orderCount(technologistToken);
      if (auditAfter !== auditBefore) {
        throw new Error(
          `expected no audit_event row for the unaudited route, before=${auditBefore} after=${auditAfter}`,
        );
      }
      if (orderAfter !== orderBefore + 1) {
        throw new Error(
          `expected exactly one new order row, before=${orderBefore} after=${orderAfter}`,
        );
      }
    },
  );

  it(
    'a forced audit-write failure rolls back its own mutation too — same transaction, ' +
      'not a follow-up write (FEAT-009 proposal §6/§8 item 6, Constitution Law #5)',
    async () => {
      const auditBefore = await auditCount(technologistToken);
      const orderBefore = await orderCount(technologistToken);
      const res = await request(app.getHttpServer())
        .post('/auth/capability-check/enter-result-forced-audit-failure')
        .set('Authorization', `Bearer ${technologistToken}`);
      if (res.status < 500) {
        throw new Error(
          `expected the forced-failure route to fail (malformed resourceId), got ${res.status} ${JSON.stringify(res.body)}`,
        );
      }
      const auditAfter = await auditCount(technologistToken);
      const orderAfter = await orderCount(technologistToken);
      if (auditAfter !== auditBefore) {
        throw new Error(
          `expected no audit_event row survives the failure, before=${auditBefore} after=${auditAfter}`,
        );
      }
      if (orderAfter !== orderBefore) {
        throw new Error(
          `expected the order insert to roll back too (same transaction), before=${orderBefore} after=${orderAfter}`,
        );
      }
    },
  );

  it(
    "the caller's audit hash chain still validates after all the above " +
      '(FEAT-009 proposal §8 item 8, verifyAuditChain)',
    async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/capability-check/audit-chain-valid')
        .set('Authorization', `Bearer ${technologistToken}`)
        .expect(200);
      const body = res.body as { valid: boolean; brokenAtId?: string };
      if (body.valid !== true) {
        throw new Error(
          `expected the audit chain to validate, got ${JSON.stringify(res.body)}`,
        );
      }
    },
  );
});
