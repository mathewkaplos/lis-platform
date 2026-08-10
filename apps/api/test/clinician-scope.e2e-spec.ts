import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { careRelationship, createDb, patient } from '@lis/db';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
// Real, decoded from a real token issued for this user (infra/keycloak/lis-realm.json).
const CLINICIAN_SUB_LOOKUP_USER = 'test-user-7';

/**
 * FEAT-040 (docs/plans/feat-040-fine-grained-abac-relationship-authz.md):
 * the one stated acceptance criterion -- "a clinician can only access
 * patients with an established care relationship, verified by isolation
 * test." `care_relationship` rows are inserted directly via `@lis/db`
 * (proposal §10 Q4 -- no assignment endpoint exists yet), mirroring
 * `observation.e2e-spec.ts`'s own established precedent for synthetic
 * fixtures with no admin endpoint.
 */
describe('Clinician relationship scoping (e2e)', () => {
  let app: INestApplication<App>;
  let clinicianToken: string;
  let clinicianSub: string;
  let technologistToken: string;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [clinicianToken, technologistToken] = await Promise.all([
      getKeycloakToken(CLINICIAN_SUB_LOOKUP_USER, 'test-password-7'),
      getKeycloakToken('test-user', 'test-password'),
    ]);
    // Decode the real token's `sub` claim directly rather than hardcoding
    // Keycloak's internal user id -- this repo's own convention (see
    // `oru-generator.service.spec.ts`'s equivalent reasoning for not
    // duplicating a derivation independently).
    const payload = clinicianToken.split('.')[1];
    clinicianSub = (
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
        sub: string;
      }
    ).sub;

    db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function createPatient(lastName: string): Promise<string> {
    const [pat] = await db
      .insert(patient)
      .values({
        tenantId: TENANT_A,
        mrn: `CLIN-E2E-${Date.now()}-${randomUUID()}`,
        firstName: 'Clinician',
        lastName,
        sex: 'U',
      })
      .returning();
    return pat.id;
  }

  it('a clinician with zero relationships sees an empty search result, not an error', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: `NoRelationship-${randomUUID()}` })
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('returns 404 for getById on a real, same-tenant patient with no care_relationship', async () => {
    const patientId = await createPatient(`Unrelated-${randomUUID()}`);
    await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(404);
  });

  it('a clinician with an established care_relationship can access that patient — getById and search', async () => {
    const lastName = `Related-${randomUUID()}`;
    const patientId = await createPatient(lastName);
    await db.insert(careRelationship).values({
      tenantId: TENANT_A,
      clinicianUserId: clinicianSub,
      patientId,
    });

    const byId = await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
    expect((byId.body as { id: string }).id).toBe(patientId);

    const search = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: lastName })
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
    const ids = (search.body as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual([patientId]);
  });

  it('search only returns the related patient, never an unrelated one matching the same query', async () => {
    const sharedTerm = `Shared-${randomUUID()}`;
    const relatedId = await createPatient(sharedTerm);
    const unrelatedId = await createPatient(sharedTerm);
    await db.insert(careRelationship).values({
      tenantId: TENANT_A,
      clinicianUserId: clinicianSub,
      patientId: relatedId,
    });

    const res = await request(app.getHttpServer())
      .get('/v1/patients')
      .query({ q: sharedTerm })
      .set('Authorization', `Bearer ${clinicianToken}`)
      .expect(200);
    const ids = (res.body as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual([relatedId]);
    expect(ids).not.toContain(unrelatedId);
  });

  it('regression: a non-clinician role (technologist) is unaffected — still sees every tenant patient', async () => {
    const patientId = await createPatient(`Regression-${randomUUID()}`);
    // No care_relationship row inserted at all -- technologist must still see it.
    await request(app.getHttpServer())
      .get(`/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(200);
  });
});
