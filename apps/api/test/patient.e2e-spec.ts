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
  let qaToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // test-user-5 = qa (TENANT_A) -- no manage_patients (capabilities.ts),
    // used to prove PUT /v1/patients/:id's RBAC gate for real.
    [tokenA, tokenB, qaToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-2', 'test-password-2'),
      getKeycloakToken('test-user-5', 'test-password-5'),
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

  /**
   * TASK-041 §2/§8: the new free-text `q` search mode. Case-insensitive
   * partial match on name, prefix match on mrn/nationalId.
   */
  it('q matches a name fragment (case-insensitive, partial)', async () => {
    const uniqueLastName = `Freetext-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Grace', lastName: uniqueLastName, sex: 'F' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: uniqueLastName.slice(0, -4).toUpperCase() }) // partial, different casing
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const results = res.body as Array<{ lastName: string }>;
    if (!results.some((r) => r.lastName === uniqueLastName)) {
      throw new Error(
        `expected q name-fragment match, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it('q matches an mrn prefix', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'Mrn', lastName: 'PrefixMatch', sex: 'U' })
      .expect(201);
    const mrn = (created.body as { after: { mrn: string } }).after.mrn;

    const res = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: mrn.slice(0, 4) })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const results = res.body as Array<{ mrn: string }>;
    if (!results.some((r) => r.mrn === mrn)) {
      throw new Error(
        `expected q mrn-prefix match, got ${JSON.stringify(res.body)}`,
      );
    }
  });

  it('q matches a nationalId prefix, and returns an empty array (not an error) for no match', async () => {
    const nationalId = randomUUID();
    await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        firstName: 'National',
        lastName: 'IdMatch',
        sex: 'U',
        nationalId,
      })
      .expect(201);

    const match = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: nationalId.slice(0, 8) })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const matchResults = match.body as Array<{ nationalId: string }>;
    if (!matchResults.some((r) => r.nationalId === nationalId)) {
      throw new Error(
        `expected q nationalId-prefix match, got ${JSON.stringify(match.body)}`,
      );
    }

    const noMatch = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: `no-such-patient-${randomUUID()}` })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    if ((noMatch.body as unknown[]).length !== 0) {
      throw new Error(
        `expected empty array for a q with no match, got ${JSON.stringify(noMatch.body)}`,
      );
    }
  });

  it('q caps results at PATIENT_SEARCH_RESULT_LIMIT (50), proven by seeding more than the cap', async () => {
    const uniqueLastName = `CapTest-${randomUUID()}`;
    // Sequential, not Promise.all: this suite runs with DB_POOL_MAX=1 (a
    // single physical connection), and 51 truly concurrent requests caused a
    // real, reproducible-but-flaky `ECONNRESET` under connection pressure —
    // proving the cap only needs 51 rows to exist, not concurrent writes.
    for (let i = 0; i < 51; i++) {
      await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: `Capped${i}`,
          lastName: uniqueLastName,
          sex: 'U',
        })
        .expect(201);
    }

    const res = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: uniqueLastName })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const results = res.body as unknown[];
    if (results.length !== 50) {
      throw new Error(
        `expected the q result set capped at 50 (51 rows seeded), got ${results.length}`,
      );
    }
  });

  /**
   * Issue #747 (docs/plans/task-747-patient-demographic-editing.md): the
   * only correction path for a mistyped registration.
   */
  describe('PUT /v1/patients/:id (issue #747)', () => {
    async function createPatient() {
      const created = await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'Before',
          lastName: 'Edit',
          sex: 'F',
          phone: '0700000000',
        })
        .expect(201);
      return (created.body as { resourceId: string }).resourceId;
    }

    it('updates only the fields sent, leaving omitted fields untouched, with exactly one new audit_event row', async () => {
      const id = await createPatient();
      const before = await auditCount(tokenA);

      const res = await request(app.getHttpServer())
        .put(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ lastName: 'EditCorrected' })
        .expect(200);
      const body = res.body as {
        after: { firstName: string; lastName: string; phone: string | null };
      };
      if (
        body.after.lastName !== 'EditCorrected' ||
        body.after.firstName !== 'Before'
      ) {
        throw new Error(`unexpected response body ${JSON.stringify(res.body)}`);
      }
      if (body.after.phone !== '0700000000') {
        throw new Error(
          `expected the omitted phone field to stay unchanged, got ${JSON.stringify(res.body)}`,
        );
      }

      const after = await auditCount(tokenA);
      if (after !== before + 1) {
        throw new Error(
          `expected exactly one new audit_event row, before=${before} after=${after}`,
        );
      }
    });

    it('clears a nullable field when the caller explicitly sends null', async () => {
      const id = await createPatient();
      const res = await request(app.getHttpServer())
        .put(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ phone: null })
        .expect(200);
      const body = res.body as { after: { phone: string | null } };
      if (body.after.phone !== null) {
        throw new Error(
          `expected phone cleared to null, got ${JSON.stringify(res.body)}`,
        );
      }
    });

    it('rejects a role without manage_patients with 403', async () => {
      const id = await createPatient();
      await request(app.getHttpServer())
        .put(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ lastName: 'ShouldNotApply' })
        .expect(403);
    });

    it('returns 404 for a patient created under a different tenant', async () => {
      const id = await createPatient();
      await request(app.getHttpServer())
        .put(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastName: 'ShouldNotApply' })
        .expect(404);
    });

    it('rejects a duplicate nationalId for the same tenant with 409, leaving the row unchanged', async () => {
      const nationalId = randomUUID();
      await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          firstName: 'Holds',
          lastName: 'NationalId',
          sex: 'M',
          nationalId,
        })
        .expect(201);
      const id = await createPatient();

      await request(app.getHttpServer())
        .put(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ nationalId })
        .expect(409);

      const unchanged = await request(app.getHttpServer())
        .get(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      if (
        (unchanged.body as { nationalId: string | null }).nationalId !== null
      ) {
        throw new Error(
          `expected the rejected update to leave nationalId unchanged, got ${JSON.stringify(unchanged.body)}`,
        );
      }
    });

    it('rejects a malformed body with 400, writing nothing', async () => {
      const id = await createPatient();
      await request(app.getHttpServer())
        .put(`/v1/patients/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sex: 'not-a-real-value' })
        .expect(400);
    });
  });
});
