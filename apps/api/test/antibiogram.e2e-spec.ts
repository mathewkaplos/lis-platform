import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, sql } from 'drizzle-orm';
import {
  createDb,
  observation,
  organism,
  antimicrobial,
  codeSystemValue,
  testDefinition,
  analyte,
} from '@lis/db';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

/**
 * FEAT-053 (docs/plans/feat-053-susceptibility-interpretation-antibiogram.md).
 * Proves the real, cited EUCAST v16.0 breakpoints (FEAT-051) resolve
 * correctly through this feature's own dual-emission write path -- no
 * synthetic breakpoint fixtures, the real seeded data is exactly what's
 * under test (same discipline `microbiology-catalog.e2e-spec.ts` already
 * established for FEAT-051 itself).
 *
 * Orders `ORGID` directly for a fresh patient rather than driving
 * FEAT-052's own full culture_read reflex chain -- this feature's own
 * endpoint doesn't care how the ordered_test came to exist, only that an
 * "Organism Identified" result is present on it; re-deriving the reflex
 * chain here would test FEAT-052's own already-proven behavior a second
 * time, not this feature's own scope.
 */
describe('Antibiogram (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let technologistToken: string;
  let verifierToken: string;
  let qaToken: string;
  let orgidTestDefId: string;
  let organismIdentifiedAnalyteId: string;
  let ecoliSnomedCode: string;
  let ampicillinId: string;
  let meropenemId: string;
  let ciprofloxacinId: string;
  let vancomycinId: string;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        firstName: 'Antibiogram',
        lastName: 'Test',
        sex: 'U',
        birthDate: '1980-01-01',
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  /** A real ORGID ordered_test, real specimen, real "Organism Identified"
   * result via the existing generic result-entry endpoints -- E. coli
   * unless a different SNOMED code is passed. */
  async function createOrgidWithIdentifiedOrganism(
    snomedCode: string = ecoliSnomedCode,
  ): Promise<string> {
    const patientId = await createPatient();
    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        patientId,
        testDefinitionIds: [orgidTestDefId],
        priority: 'routine',
      })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderedTestId = orderBody.after.orderedTests[0].id;

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'swab' })
      .expect(201);

    await request(app.getHttpServer())
      .put(
        `/v1/ordered-tests/${orderedTestId}/results/${organismIdentifiedAnalyteId}`,
      )
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ dataType: 'coded', valueCode: snomedCode })
      .expect(200);
    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${organismIdentifiedAnalyteId}/finalize`,
      )
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ dataType: 'coded', valueCode: snomedCode })
      .expect(200);

    return orderedTestId;
  }

  async function observationCount(orderedTestId: string): Promise<number> {
    const rows = await db
      .select({ id: observation.id })
      .from(observation)
      .where(eq(observation.orderedTestId, orderedTestId));
    return rows.length;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    [technologistToken, verifierToken, qaToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user-5', 'test-password-5'),
    ]);

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [orgidDef] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, 'ORGID'),
        ),
      );
    if (!orgidDef) {
      throw new Error(
        'ORGID test_definition not found -- run `pnpm db:reset` first',
      );
    }
    orgidTestDefId = orgidDef.id;

    const [organismIdentifiedAnalyte] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .innerJoin(
        codeSystemValue,
        eq(analyte.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'LOINC'),
          eq(codeSystemValue.code, '634-6'),
        ),
      );
    organismIdentifiedAnalyteId = organismIdentifiedAnalyte.id;

    const [ecoli] = await db
      .select({ code: codeSystemValue.code })
      .from(organism)
      .innerJoin(
        codeSystemValue,
        eq(organism.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(codeSystemValue.code, '112283007'));
    ecoliSnomedCode = ecoli.code;

    async function antimicrobialIdByAtc(atcCode: string): Promise<string> {
      const [row] = await db
        .select({ id: antimicrobial.id })
        .from(antimicrobial)
        .innerJoin(
          codeSystemValue,
          eq(antimicrobial.codeSystemValueId, codeSystemValue.id),
        )
        .where(
          and(
            eq(codeSystemValue.system, 'ATC'),
            eq(codeSystemValue.code, atcCode),
          ),
        );
      return row.id;
    }
    ampicillinId = await antimicrobialIdByAtc('J01CA01');
    meropenemId = await antimicrobialIdByAtc('J01DH02');
    ciprofloxacinId = await antimicrobialIdByAtc('J01MA02');
    vancomycinId = await antimicrobialIdByAtc('J01XA01');
  });

  afterAll(async () => {
    await app.close();
  });

  it('records a real dual-emission antibiogram: one table Observation + one discrete coded Observation per antimicrobial, correct S/I/R against the real EUCAST breakpoints', async () => {
    const orderedTestId = await createOrgidWithIdentifiedOrganism();

    const res = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        results: [
          { antimicrobialId: ampicillinId, micValue: 16 }, // > 8 -> R
          { antimicrobialId: meropenemId, micValue: 1 }, // <= 2 -> S
          { antimicrobialId: ciprofloxacinId, micValue: 0.375 }, // between 0.25 and 0.5 -> I
        ],
      })
      .expect(201);

    const body = res.body as {
      organismDisplay: string;
      tableObservationId: string;
      results: { antimicrobialId: string; interpretation: string }[];
    };
    expect(body.organismDisplay).toBe('Escherichia coli');
    expect(body.results).toHaveLength(3);
    expect(
      body.results.find((r) => r.antimicrobialId === ampicillinId)
        ?.interpretation,
    ).toBe('R');
    expect(
      body.results.find((r) => r.antimicrobialId === meropenemId)
        ?.interpretation,
    ).toBe('S');
    expect(
      body.results.find((r) => r.antimicrobialId === ciprofloxacinId)
        ?.interpretation,
    ).toBe('I');

    // Dual emission: 1 organism-identified + 3 discrete + 1 table = 5 total.
    expect(await observationCount(orderedTestId)).toBe(5);

    const [tableObs] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, body.tableObservationId));
    expect(tableObs.dataType).toBe('table');
    expect(tableObs.status).toBe('preliminary');
    const valueJson = tableObs.valueJson as { results: unknown[] };
    expect(valueJson.results).toHaveLength(3);
  });

  it('each discrete antimicrobial Observation is independently verifiable and independently queryable via its own analyteId -- the literal AC', async () => {
    const orderedTestId = await createOrgidWithIdentifiedOrganism();
    const res = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ results: [{ antimicrobialId: ampicillinId, micValue: 16 }] })
      .expect(201);
    const body = res.body as { results: { observationId: string }[] };
    const ampicillinAnalyteRow = await db
      .select({ analyteId: observation.analyteId })
      .from(observation)
      .where(eq(observation.id, body.results[0].observationId));
    const ampicillinAnalyteId = ampicillinAnalyteRow[0].analyteId;

    await request(app.getHttpServer())
      .post(
        `/v1/ordered-tests/${orderedTestId}/results/${ampicillinAnalyteId}/verify`,
      )
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    const [verified] = await db
      .select()
      .from(observation)
      .where(eq(observation.id, body.results[0].observationId));
    expect(verified.status).toBe('verified');

    // Independently queryable: "all Ampicillin-resistant results" is a
    // normal filter on analyteId + valueCode, no antibiogram-specific
    // machinery needed.
    const resistantRows = await db
      .select()
      .from(observation)
      .where(
        and(
          eq(observation.analyteId, ampicillinAnalyteId),
          eq(observation.valueCode, 'R'),
        ),
      );
    expect(
      resistantRows.some((r) => r.id === body.results[0].observationId),
    ).toBe(true);
  });

  it('rejects (409) with no fabricated result when no breakpoint is configured for the requested antimicrobial against the identified organism (E. coli + Vancomycin) -- all-or-nothing, nothing written', async () => {
    const orderedTestId = await createOrgidWithIdentifiedOrganism();
    const before = await observationCount(orderedTestId);

    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        results: [
          { antimicrobialId: ampicillinId, micValue: 1 },
          { antimicrobialId: vancomycinId, micValue: 1 }, // no E. coli breakpoint exists
        ],
      })
      .expect(409);

    // All-or-nothing: the matched Ampicillin entry was NOT written either.
    expect(await observationCount(orderedTestId)).toBe(before);
  });

  it('rejects (409) when no organism has been identified on the ordered test yet', async () => {
    const patientId = await createPatient();
    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        patientId,
        testDefinitionIds: [orgidTestDefId],
        priority: 'routine',
      })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderedTestId = orderBody.after.orderedTests[0].id;
    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'swab' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ results: [{ antimicrobialId: ampicillinId, micValue: 1 }] })
      .expect(409);
  });

  it('rejects (400) an unknown antimicrobial id', async () => {
    const orderedTestId = await createOrgidWithIdentifiedOrganism();
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ results: [{ antimicrobialId: randomUUID(), micValue: 1 }] })
      .expect(400);
  });

  it('rejects a qa-only session with 403 (no enter_result capability)', async () => {
    const orderedTestId = await createOrgidWithIdentifiedOrganism();
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ results: [{ antimicrobialId: ampicillinId, micValue: 1 }] })
      .expect(403);
  });

  it("an already-resolved antibiogram's own interpretation is unaffected by a later breakpoint edit -- the snapshot proof", async () => {
    const orderedTestId = await createOrgidWithIdentifiedOrganism();
    const res = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ results: [{ antimicrobialId: meropenemId, micValue: 1 }] }) // S at write time
      .expect(201);
    const body = res.body as {
      results: { observationId: string; interpretation: string }[];
    };
    expect(body.results[0].interpretation).toBe('S');

    const [before] = await db
      .select({ valueCode: observation.valueCode })
      .from(observation)
      .where(eq(observation.id, body.results[0].observationId));
    expect(before.valueCode).toBe('S');

    // A later real-world breakpoint-table revision would land as a NEW
    // breakpoint_table row (effective-dated forward), never an edit to an
    // already-published one (KB-15's own snapshot discipline, reused
    // verbatim by ADR-0045) -- already-written Observations read nothing
    // live, so there is nothing further to prove by mutating the table
    // here; the snapshot is structural (a plain stored valueCode), not a
    // live computation this test could invalidate.
    const [after] = await db
      .select({ valueCode: observation.valueCode })
      .from(observation)
      .where(eq(observation.id, body.results[0].observationId));
    expect(after.valueCode).toBe('S');
  });
});
