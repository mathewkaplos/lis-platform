import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
 * FEAT-055 (docs/plans/feat-055-amr-surveillance-report.md). Proves the
 * literal KB-44 AMR-surveillance example against real seeded EUCAST v16.0
 * breakpoints and a real dual-emission antibiogram write path (FEAT-053) --
 * real organism x antimicrobial S/I/R rates, `verified`-only counting, and
 * RLS isolation. Reuses `antibiogram.e2e-spec.ts`'s own
 * `createOrgidWithIdentifiedOrganism` fixture shape rather than re-deriving
 * it.
 */
describe('AMR surveillance report (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let technologistToken: string;
  let verifierToken: string;
  let qaToken: string;
  let orgidTestDefId: string;
  let organismIdentifiedAnalyteId: string;
  let ecoliSnomedCode: string;
  let saureusSnomedCode: string;
  let ecoliId: string;
  let saureusId: string;
  let ampicillinId: string;
  let meropenemId: string;
  let vancomycinId: string;

  let windowFrom: Date;
  let windowTo: Date;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({
        firstName: 'AmrSurveillance',
        lastName: 'Test',
        sex: 'U',
        birthDate: '1980-01-01',
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createOrgidWithIdentifiedOrganism(
    snomedCode: string,
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

  /** Records a real antibiogram and, unless `skipVerify` is set for a given
   * entry, verifies each resulting discrete Observation -- returns the
   * verified Observation ids for direct timestamp inspection. */
  async function recordAndVerify(
    orderedTestId: string,
    entries: { antimicrobialId: string; micValue: number }[],
    skipVerifyForIndex?: number,
  ): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/antibiogram`)
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ results: entries })
      .expect(201);
    const body = res.body as { results: { observationId: string }[] };

    const verifiedIds: string[] = [];
    for (let i = 0; i < body.results.length; i++) {
      if (i === skipVerifyForIndex) continue;
      const observationId = body.results[i].observationId;
      const [row] = await db
        .select({ analyteId: observation.analyteId })
        .from(observation)
        .where(eq(observation.id, observationId));
      await request(app.getHttpServer())
        .post(
          `/v1/ordered-tests/${orderedTestId}/results/${row.analyteId}/verify`,
        )
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);
      verifiedIds.push(observationId);
    }
    return verifiedIds;
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
      .select({ id: organism.id, code: codeSystemValue.code })
      .from(organism)
      .innerJoin(
        codeSystemValue,
        eq(organism.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(codeSystemValue.code, '112283007'));
    ecoliId = ecoli.id;
    ecoliSnomedCode = ecoli.code;

    const [saureus] = await db
      .select({ id: organism.id, code: codeSystemValue.code })
      .from(organism)
      .innerJoin(
        codeSystemValue,
        eq(organism.codeSystemValueId, codeSystemValue.id),
      )
      .where(eq(codeSystemValue.code, '3092008'));
    saureusId = saureus.id;
    saureusSnomedCode = saureus.code;

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
    vancomycinId = await antimicrobialIdByAtc('J01XA01');

    // E. coli x Ampicillin: 2 verified R -- both >8, EUCAST v16.0 p.13.
    const ecoliOrderA =
      await createOrgidWithIdentifiedOrganism(ecoliSnomedCode);
    const idsA = await recordAndVerify(ecoliOrderA, [
      { antimicrobialId: ampicillinId, micValue: 16 },
      { antimicrobialId: meropenemId, micValue: 1 }, // <=2 -> S
    ]);
    const ecoliOrderB =
      await createOrgidWithIdentifiedOrganism(ecoliSnomedCode);
    const idsB = await recordAndVerify(ecoliOrderB, [
      { antimicrobialId: ampicillinId, micValue: 16 },
    ]);

    // A third E. coli/Ampicillin result deliberately left `preliminary`
    // (never verified) -- proves the report's own "verified is the
    // completion bar" filter, not just that verified rows can be counted.
    const ecoliOrderC =
      await createOrgidWithIdentifiedOrganism(ecoliSnomedCode);
    await recordAndVerify(
      ecoliOrderC,
      [{ antimicrobialId: ampicillinId, micValue: 16 }],
      0,
    );

    // S. aureus x Vancomycin: 1 verified S (<=2), 1 verified R (>2) --
    // EUCAST v16.0 p.35, MIC-only pair.
    const saureusOrderA =
      await createOrgidWithIdentifiedOrganism(saureusSnomedCode);
    const idsC = await recordAndVerify(saureusOrderA, [
      { antimicrobialId: vancomycinId, micValue: 1 },
    ]);
    const saureusOrderB =
      await createOrgidWithIdentifiedOrganism(saureusSnomedCode);
    const idsD = await recordAndVerify(saureusOrderB, [
      { antimicrobialId: vancomycinId, micValue: 4 },
    ]);

    const allVerifiedIds = [...idsA, ...idsB, ...idsC, ...idsD];
    const verifiedRows = await db
      .select({ verifiedAt: observation.verifiedAt })
      .from(observation)
      .where(inArray(observation.id, allVerifiedIds));
    const timestamps = verifiedRows
      .map((r) => r.verifiedAt)
      .filter((d): d is Date => d !== null);
    windowFrom = new Date(
      Math.min(...timestamps.map((d) => d.getTime())) - 1_000,
    );
    windowTo = new Date(
      Math.max(...timestamps.map((d) => d.getTime())) + 1_000,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a non-qa session (403)', async () => {
    await request(app.getHttpServer())
      .get('/v1/reports/amr-surveillance')
      .set('Authorization', `Bearer ${technologistToken}`)
      .query({ from: windowFrom.toISOString(), to: windowTo.toISOString() })
      .expect(403);
  });

  it('rejects a request missing from/to (400)', async () => {
    await request(app.getHttpServer())
      .get('/v1/reports/amr-surveillance')
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(400);
  });

  it('computes real organism x antimicrobial S/I/R rates from verified Observations only, across two organisms', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/reports/amr-surveillance')
      .set('Authorization', `Bearer ${qaToken}`)
      .query({ from: windowFrom.toISOString(), to: windowTo.toISOString() })
      .expect(200);
    const body = res.body as {
      entries: {
        organismId: string;
        organismDisplay: string;
        antimicrobialId: string;
        antimicrobialDisplay: string;
        susceptibleCount: number;
        intermediateCount: number;
        resistantCount: number;
        total: number;
        resistantPct: number;
      }[];
    };

    const ecoliAmp = body.entries.find(
      (e) => e.organismId === ecoliId && e.antimicrobialId === ampicillinId,
    );
    // Exactly 2 -- the third, unverified E. coli/Ampicillin result must NOT
    // be counted.
    expect(ecoliAmp).toMatchObject({
      organismDisplay: 'Escherichia coli',
      susceptibleCount: 0,
      intermediateCount: 0,
      resistantCount: 2,
      total: 2,
      resistantPct: 100,
    });

    const ecoliMero = body.entries.find(
      (e) => e.organismId === ecoliId && e.antimicrobialId === meropenemId,
    );
    expect(ecoliMero).toMatchObject({
      susceptibleCount: 1,
      intermediateCount: 0,
      resistantCount: 0,
      total: 1,
      resistantPct: 0,
    });

    const saureusVan = body.entries.find(
      (e) => e.organismId === saureusId && e.antimicrobialId === vancomycinId,
    );
    expect(saureusVan).toMatchObject({
      organismDisplay: 'Staphylococcus aureus',
      susceptibleCount: 1,
      intermediateCount: 0,
      resistantCount: 1,
      total: 2,
      resistantPct: 50,
    });
  });

  it("RLS: another tenant's own qa session shows none of this fixture's data", async () => {
    const otherTenantQaToken = await getKeycloakToken(
      'test-user-6',
      'test-password-6',
    );
    const res = await request(app.getHttpServer())
      .get('/v1/reports/amr-surveillance')
      .set('Authorization', `Bearer ${otherTenantQaToken}`)
      .query({ from: windowFrom.toISOString(), to: windowTo.toISOString() })
      .expect(200);
    const body = res.body as { entries: unknown[] };
    expect(body.entries).toHaveLength(0);
  });
});
