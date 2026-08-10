import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  analyte,
  codeSystemValue,
  createDb,
  observation,
  orderedTest,
  testAnalyte,
  testDefinition,
  unit,
} from '@lis/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

// A fixed, clearly-artificial past window for the rejection-rate fixtures
// only -- `specimen` carries no append-only trigger (unlike `observation`,
// Constitution Law #2), so backdating `received_at` directly after the
// fact is safe and gives real isolation from any other spec's own
// real-time activity.
const REJECTION_WINDOW_FROM = new Date('2020-01-01T00:00:00Z');
const REJECTION_WINDOW_TO = new Date('2020-01-02T00:00:00Z');
const REJECTION_T0 = new Date('2020-01-01T10:00:00Z');

/**
 * FEAT-034 (docs/plans/feat-034-operational-reports-tat-workload.md).
 * Proves the issue's own literal AC ("TAT, workload, and rejection-rate
 * reports render correctly against real seeded data") plus this proposal's
 * own narrowed §7 criteria: real, tolerance-checked TAT numbers (not exact
 * hand-computed minutes -- a real, load-bearing correction found during
 * this task's own implementation, see `createBackdatedVerifiedResult`'s own
 * header comment), 400 for missing from/to, RLS isolation.
 */
describe('Operational reports (e2e)', () => {
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  let app: INestApplication<App>;
  let qaToken: string;
  let verifierToken: string;
  let technologistToken: string;
  let verifierUserId: string;

  let routineAnalyteId: string;
  let routineTestDefId: string;
  let statAnalyteId: string;
  let statTestDefId: string;

  let tatWindowFrom: Date;
  let tatWindowTo: Date;
  let workloadWindowFrom: Date;
  let workloadWindowTo: Date;

  async function createPatient(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({
        firstName: 'OpsReport',
        lastName: 'E2E',
        sex: 'F',
        birthDate: '1980-01-01',
      })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  /**
   * `observation` is append-only (Constitution Law #2, DB-trigger-enforced
   * -- confirmed directly: an early draft of this fixture tried to `UPDATE
   * observation SET verified_at = ...` after the fact and Postgres itself
   * rejected it, `"observation ... is verified and append-only"`). There is
   * no way to pin an exact, hand-computed TAT by editing `observation`
   * after verification.
   *
   * Instead: back-date `ordered_test.createdAt` (not append-only-protected)
   * to `now - backdateMinutes` *before* finalize/verify run, then let
   * `observation.verifiedAt` be set to the real wall-clock time verify()
   * actually completes at, a few seconds later. TAT then lands within a
   * small, real tolerance of `backdateMinutes`, not an exact integer --
   * asserted with `toBeGreaterThan`/`toBeLessThan`, not `toBe`, in the test
   * itself.
   */
  async function createBackdatedVerifiedResult(
    testDefId: string,
    analyteId: string,
    priority: 'routine' | 'stat',
    backdateMinutes: number,
  ): Promise<string> {
    const patientId = await createPatient();
    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ patientId, testDefinitionIds: [testDefId], priority })
      .expect(201);
    const orderBody = orderRes.body as {
      resourceId: string;
      after: { orderedTests: { id: string }[] };
    };
    const orderedTestId = orderBody.after.orderedTests[0].id;

    await db
      .update(orderedTest)
      .set({ createdAt: new Date(Date.now() - backdateMinutes * 60_000) })
      .where(eq(orderedTest.id, orderedTestId));

    await request(app.getHttpServer())
      .post('/v1/specimens')
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ orderId: orderBody.resourceId, specimenType: 'serum' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/finalize`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .send({ dataType: 'quantity', valueNum: 50 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/ordered-tests/${orderedTestId}/results/${analyteId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);

    return orderedTestId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    qaToken = await getKeycloakToken('test-user-5', 'test-password-5');
    verifierToken = await getKeycloakToken('test-user-4', 'test-password-4');
    technologistToken = await getKeycloakToken('test-user', 'test-password');
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    verifierUserId = (meRes.body as { sub: string }).sub;

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );

    const [mgdl] = await db
      .select({ id: unit.id })
      .from(unit)
      .innerJoin(
        codeSystemValue,
        eq(unit.codeSystemValueId, codeSystemValue.id),
      )
      .where(
        and(
          eq(codeSystemValue.system, 'UCUM'),
          eq(codeSystemValue.code, 'mg/dL'),
        ),
      )
      .limit(1);
    if (!mgdl) {
      throw new Error('expected mg/dL UCUM unit -- run `pnpm db:reset` first');
    }

    async function makeAnalyteAndTest(code: string) {
      const [csv] = await db
        .insert(codeSystemValue)
        .values({
          system: 'TEST',
          code,
          version: '1',
          display: `FEAT-034 synthetic analyte ${code} (non-clinical, spec-local only)`,
        })
        .returning({ id: codeSystemValue.id });
      const [analyteRow] = await db
        .insert(analyte)
        .values({
          codeSystemValueId: csv.id,
          display: `FEAT-034 Synthetic Analyte ${code} (non-clinical)`,
          dataType: 'quantity',
          defaultUnitId: mgdl.id,
        })
        .returning({ id: analyte.id });
      const [def] = await db
        .insert(testDefinition)
        .values({
          tenantId: TENANT_A,
          code: `FEAT034-${code}`,
          displayName: `FEAT-034 Synthetic Panel ${code} (non-clinical)`,
        })
        .returning({ id: testDefinition.id });
      await db.insert(testAnalyte).values({
        tenantId: TENANT_A,
        testDefinitionId: def.id,
        analyteId: analyteRow.id,
      });
      return { analyteId: analyteRow.id, testDefId: def.id };
    }

    const routine = await makeAnalyteAndTest('SYNTH-R');
    routineAnalyteId = routine.analyteId;
    routineTestDefId = routine.testDefId;
    const stat = await makeAnalyteAndTest('SYNTH-S');
    statAnalyteId = stat.analyteId;
    statTestDefId = stat.testDefId;

    // TAT's own window must bracket the backdated `ordered_test.createdAt`
    // values below (5 and 90 minutes in the past) while *excluding* real
    // "now" -- real finding, found running against the *full* e2e suite,
    // not this file in isolation: a window that includes real "now" (this
    // window's own previous shape, [now-120min, now+60s]) sums in every
    // *other* spec file's own real, non-backdated `ordered_test` rows too,
    // since `fileParallelism: false` runs every spec file back-to-back
    // inside the same real ~76s suite run, and those rows' own `createdAt`
    // all cluster within that same ~76s window around real "now" --
    // trivially inside a window that extends 120 minutes into the past and
    // even 60 seconds into the future. Confirmed directly: `routineRow.count`
    // came back 29 (not 1) the first time this ran as part of the full
    // suite, after passing cleanly in isolation. Fixed by ending the window
    // at `now - 2min` instead of `now + 60s` -- comfortably after the
    // routine fixture's own `now - 5min` backdate, but safely before real
    // "now" (and thus before any other spec's own contemporaneous activity),
    // so the window brackets only this fixture's two backdated rows, not by
    // luck but structurally. Workload's own window is derived differently
    // (see the comment just below `tatWindowTo`'s own assignment) --
    // `observation.producedAt`/`verifiedAt` are never backdated, so
    // excluding "now" isn't an option there.
    tatWindowFrom = new Date(Date.now() - 100 * 60_000); // safely before the 90-minute stat backdate
    // Routine: backdated 5 minutes, well within the seeded 1440-minute
    // routine target -- proves the "within target" branch.
    const routineOrderedTestId = await createBackdatedVerifiedResult(
      routineTestDefId,
      routineAnalyteId,
      'routine',
      5,
    );
    // Stat: backdated 90 minutes, exceeding the seeded 60-minute stat
    // target -- proves withinTargetPct is a real computation, not a
    // trivial always-100 pass-through.
    const statOrderedTestId = await createBackdatedVerifiedResult(
      statTestDefId,
      statAnalyteId,
      'stat',
      90,
    );
    tatWindowTo = new Date(Date.now() - 2 * 60_000); // safely after the routine backdate (now-5min), safely before real "now"

    // Workload's own window is derived from this fixture's own two real
    // `observation.producedAt`/`verifiedAt` timestamps (queried directly,
    // by this fixture's own known `ordered_test` ids), not estimated from
    // wall-clock/DB-clock "now" -- real finding: even a tight, DB-clock-
    // anchored `dbNow() +/- 5s` window (this window's own previous shape)
    // was still intermittently contaminated by other spec files' own
    // `test-user-4` activity landing inside that same few-second band
    // during a full-suite run (`test-user-4` is the shared verifier
    // identity nearly every e2e spec file in this repo uses, and
    // `producedAt`/`verifiedAt` are always real wall-clock time, so no
    // *time estimate* can fully rule out a same-second collision). Deriving
    // the window from the two rows' own actual timestamps instead removes
    // the estimation entirely -- the bracket is only as wide as reality
    // requires (a ~1s buffer for clock-resolution slack), not as wide as a
    // guessed margin.
    const workloadFixtureRows = await db
      .select({
        producedAt: observation.producedAt,
        verifiedAt: observation.verifiedAt,
      })
      .from(observation)
      .where(
        inArray(observation.orderedTestId, [
          routineOrderedTestId,
          statOrderedTestId,
        ]),
      );
    const workloadTimestamps = workloadFixtureRows.flatMap((row) =>
      [row.producedAt, row.verifiedAt].filter(
        (value): value is Date => value !== null,
      ),
    );
    workloadWindowFrom = new Date(
      Math.min(...workloadTimestamps.map((d) => d.getTime())) - 1_000,
    );
    workloadWindowTo = new Date(
      Math.max(...workloadTimestamps.map((d) => d.getTime())) + 1_000,
    );

    // Two rejected specimens (same reason, proving count aggregation) + one
    // successfully received specimen, all backdated into the same fixed
    // 2020 window by their own real, captured ids -- not by re-selecting
    // "rows already inside the window" (which, before backdating, is
    // circular: a freshly-created specimen's own `received_at` is real
    // "now," never already inside a window it's about to be moved into).
    async function receiveWithOutcome(
      rejectionReason?: string,
    ): Promise<string> {
      const patientId = await createPatient();
      const orderRes = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({ patientId, testDefinitionIds: [routineTestDefId] })
        .expect(201);
      const specimenRes = await request(app.getHttpServer())
        .post('/v1/specimens')
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          orderId: (orderRes.body as { resourceId: string }).resourceId,
          specimenType: 'serum',
          ...(rejectionReason ? { rejectionReason } : {}),
        })
        .expect(201);
      return (specimenRes.body as { resourceId: string }).resourceId;
    }
    const rejectedIdA = await receiveWithOutcome('haemolysed');
    const rejectedIdB = await receiveWithOutcome('haemolysed');
    const acceptedId = await receiveWithOutcome();

    await db.execute(
      sql`UPDATE specimen SET received_at = ${REJECTION_T0.toISOString()} WHERE id IN (${rejectedIdA}, ${rejectedIdB}, ${acceptedId})`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /v1/reports/operational/tat', () => {
    it('rejects a non-qa session (403)', async () => {
      await request(app.getHttpServer())
        .get('/v1/reports/operational/tat')
        .set('Authorization', `Bearer ${technologistToken}`)
        .query({
          from: tatWindowFrom.toISOString(),
          to: tatWindowTo.toISOString(),
        })
        .expect(403);
    });

    it('rejects a request missing from/to (400)', async () => {
      await request(app.getHttpServer())
        .get('/v1/reports/operational/tat')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(400);
    });

    // `byPriority`'s own count assertions are now structurally immune to
    // cross-spec contamination, the same way `byTest`'s own assertions
    // already were (scoped to this file's own unique `testDefinitionId`s)
    // -- see `tatWindowFrom`/`To`'s own header comment above (real finding:
    // this exact assertion failed with count 29, not 1, the first time it
    // ran as part of the full suite, before the window was fixed to exclude
    // real "now").
    it('computes real TAT by priority and by test, with real SLA-percentage math', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/operational/tat')
        .set('Authorization', `Bearer ${qaToken}`)
        .query({
          from: tatWindowFrom.toISOString(),
          to: tatWindowTo.toISOString(),
        })
        .expect(200);
      const body = res.body as {
        byPriority: {
          priority: string;
          count: number;
          meanMinutes: number;
          medianMinutes: number;
          withinTargetPct: number | null;
        }[];
        byTest: {
          testDefinitionId: string;
          count: number;
          meanMinutes: number;
        }[];
      };

      const routineRow = body.byPriority.find((r) => r.priority === 'routine');
      expect(routineRow?.count).toBe(1);
      expect(routineRow?.meanMinutes).toBeGreaterThan(4.9);
      expect(routineRow?.meanMinutes).toBeLessThan(6);
      // 5 real minutes is trivially within the seeded 1440-minute target.
      expect(routineRow?.withinTargetPct).toBe(100);

      const statRow = body.byPriority.find((r) => r.priority === 'stat');
      expect(statRow?.count).toBe(1);
      expect(statRow?.meanMinutes).toBeGreaterThan(89.9);
      expect(statRow?.meanMinutes).toBeLessThan(91);
      // 90 real minutes exceeds the seeded 60-minute stat target.
      expect(statRow?.withinTargetPct).toBe(0);

      const byTestRow = body.byTest.find(
        (r) => r.testDefinitionId === routineTestDefId,
      );
      expect(byTestRow?.count).toBe(1);
      expect(byTestRow?.meanMinutes).toBeGreaterThan(4.9);
      expect(byTestRow?.meanMinutes).toBeLessThan(6);
    });

    it("RLS: another tenant's own qa session shows none of this fixture's data", async () => {
      // test-user-6 -- a real, seeded `qa`-role user on a *different* tenant
      // (00000000-...-99, `infra/keycloak/lis-realm.json`), not the 403-for-
      // wrong-role case the test above already covers. This is the genuine
      // RLS proof: same capability, different tenant, zero rows.
      const otherTenantQaToken = await getKeycloakToken(
        'test-user-6',
        'test-password-6',
      );
      const res = await request(app.getHttpServer())
        .get('/v1/reports/operational/tat')
        .set('Authorization', `Bearer ${otherTenantQaToken}`)
        .query({
          from: tatWindowFrom.toISOString(),
          to: tatWindowTo.toISOString(),
        })
        .expect(200);
      const body = res.body as { byPriority: unknown[]; byTest: unknown[] };
      expect(body.byPriority).toHaveLength(0);
      expect(body.byTest).toHaveLength(0);
    });
  });

  describe('GET /v1/reports/operational/workload', () => {
    it('counts operator and verifier work for the same user across both fixture panels', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/operational/workload')
        .set('Authorization', `Bearer ${qaToken}`)
        .query({
          from: workloadWindowFrom.toISOString(),
          to: workloadWindowTo.toISOString(),
        })
        .expect(200);
      const body = res.body as {
        entries: {
          userId: string;
          operatorCount: number;
          verifierCount: number;
        }[];
      };
      const entry = body.entries.find((e) => e.userId === verifierUserId);
      expect(entry).toMatchObject({ operatorCount: 2, verifierCount: 2 });
    });
  });

  describe('GET /v1/reports/operational/rejection-rate', () => {
    it('computes exact rejected/total counts and a real rate denominator', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/reports/operational/rejection-rate')
        .set('Authorization', `Bearer ${qaToken}`)
        .query({
          from: REJECTION_WINDOW_FROM.toISOString(),
          to: REJECTION_WINDOW_TO.toISOString(),
        })
        .expect(200);
      const body = res.body as {
        totalSpecimens: number;
        rejectedTotal: number;
        byReason: { reason: string; count: number }[];
      };
      expect(body.totalSpecimens).toBe(3);
      expect(body.rejectedTotal).toBe(2);
      expect(body.byReason).toEqual([{ reason: 'haemolysed', count: 2 }]);
    });
  });
});
