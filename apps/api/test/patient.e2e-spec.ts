import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-039 (FEAT-011): proves the first real domain-resource endpoint
 * through the live API — real Keycloak tokens, real Postgres, matching
 * every existing e2e spec's own standard (not a mocked-request unit test).
 * `test-user`/TENANT_A (technologist) and `test-user-2`/TENANT_B (verifier)
 * — same convention `tenant-context.e2e-spec.ts` already established; both
 * roles carry `manage_patients` (capabilities.ts).
 */
describe('Patient API (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenB] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-2', 'test-password-2'),
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

  it('creates a patient (201), matching the response shape, with exactly one new audit_event row', async () => {
    const before = await auditCount(tokenA);
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Ada', lastName: 'Lovelace', sex: 'F' })
      .expect(201);
    const body = res.body as {
      resourceId: string;
      after: {
        id: string;
        mrn: string;
        nationalId: string | null;
        firstName: string;
        lastName: string;
        sex: string;
      };
    };
    if (typeof body.resourceId !== 'string' || body.resourceId.length === 0) {
      throw new Error(`expected a resourceId, got ${JSON.stringify(res.body)}`);
    }
    if (typeof body.after.mrn !== 'string' || body.after.mrn.length === 0) {
      throw new Error(
        `expected a server-generated mrn, got ${JSON.stringify(res.body)}`,
      );
    }
    if (body.after.firstName !== 'Ada' || body.after.lastName !== 'Lovelace') {
      throw new Error(`unexpected response body ${JSON.stringify(res.body)}`);
    }
    const after = await auditCount(tokenA);
    if (after !== before + 1) {
      throw new Error(
        `expected exactly one new audit_event row, before=${before} after=${after}`,
      );
    }
  });

  it('rejects a malformed body with 400 problem+json enumerating field-level errors, writing nothing', async () => {
    const before = await auditCount(tokenA);
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'NoLastName', sex: 'not-a-real-value' })
      .expect(400);
    if (
      res.headers['content-type']?.includes('application/problem+json') !== true
    ) {
      throw new Error(
        `expected application/problem+json, got ${JSON.stringify(res.headers['content-type'])}`,
      );
    }
    const body = res.body as { code: string; errors: unknown[] };
    if (
      body.code !== 'validation_failed' ||
      !Array.isArray(body.errors) ||
      body.errors.length === 0
    ) {
      throw new Error(
        `expected field-level validation errors, got ${JSON.stringify(res.body)}`,
      );
    }
    const after = await auditCount(tokenA);
    if (after !== before) {
      throw new Error(
        `expected no audit_event row on a rejected create, before=${before} after=${after}`,
      );
    }
  });

  it('rejects a duplicate nationalId for the same tenant with 409', async () => {
    const nationalId = randomUUID();
    await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'First',
        lastName: 'Registration',
        sex: 'M',
        nationalId,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Second',
        lastName: 'Registration',
        sex: 'M',
        nationalId,
      })
      .expect(409);
  });

  it('searches by mrn and by nationalId, both returning the correct row', async () => {
    const nationalId = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Search', lastName: 'Target', sex: 'U', nationalId })
      .expect(201);
    const mrn = (created.body as { after: { mrn: string } }).after.mrn;

    const byMrn = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ mrn })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byMrnResults = byMrn.body as Array<{ mrn: string }>;
    if (byMrnResults.length !== 1 || byMrnResults[0].mrn !== mrn) {
      throw new Error(
        `mrn search returned unexpected results: ${JSON.stringify(byMrn.body)}`,
      );
    }

    const byNationalId = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ nationalId })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const byNationalIdResults = byNationalId.body as Array<{ mrn: string }>;
    if (
      byNationalIdResults.length !== 1 ||
      byNationalIdResults[0].mrn !== mrn
    ) {
      throw new Error(
        `nationalId search returned unexpected results: ${JSON.stringify(byNationalId.body)}`,
      );
    }
  });

  it('searches by firstName+lastName+birthDate (case-insensitive), the TASK-040 duplicate-detection combination', async () => {
    const uniqueLastName = `Duped-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'Jamie',
        lastName: uniqueLastName,
        sex: 'U',
        birthDate: '1990-05-15',
      })
      .expect(201);

    const match = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({
        firstName: 'JAMIE', // different casing -- proves case-insensitivity
        lastName: uniqueLastName.toLowerCase(),
        birthDate: '1990-05-15',
      })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const matchResults = match.body as Array<{ lastName: string }>;
    if (matchResults.length !== 1) {
      throw new Error(
        `expected exactly one name+DOB match, got ${JSON.stringify(match.body)}`,
      );
    }

    const noMatch = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({
        firstName: 'Jamie',
        lastName: uniqueLastName,
        birthDate: '1991-05-15', // different birth date -- must not match
      })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const noMatchResults = noMatch.body as unknown[];
    if (noMatchResults.length !== 0) {
      throw new Error(
        `expected no match for a different birth date, got ${JSON.stringify(noMatch.body)}`,
      );
    }
  });

  it('returns 404 for a patient created under a different tenant (RLS at the API layer, not just the DB layer)', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Tenant', lastName: 'Isolated', sex: 'F' })
      .expect(201);
    const id = (created.body as { resourceId: string }).resourceId;

    await request(app.getHttpServer())
      .get(`/v1/patients/${id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/v1/patients/${id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('returns 404 (not a 500) for a well-formed but nonexistent id', async () => {
    await request(app.getHttpServer())
      .get(`/v1/patients/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });
});
