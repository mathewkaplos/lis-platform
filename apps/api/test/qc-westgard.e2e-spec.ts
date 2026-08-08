import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq, sql } from 'drizzle-orm';
import {
  analyte,
  controlLot,
  createDb,
  observation,
  qcRuleViolation,
  unit,
} from '@lis/db';
import { evaluateWestgardRules } from '@lis/domain';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-067 (FEAT-019, ADR-0018): proves the Westgard multirule evaluator and
 * its wiring into `POST /v1/control-lots/:id/results`. Structure mirrors
 * `flagging.e2e-spec.ts`'s own precedent (TASK-050): a pure, no-DB describe
 * block for boundary-exact rule logic, plus real-Postgres/real-HTTP blocks
 * for RLS isolation and end-to-end detection. No standalone
 * `packages/domain/src/qc-westgard.test.ts` -- no package under `packages/`
 * has ever had its own test runner configured; every existing pure-domain
 * function is validated this same way (see this proposal's §2 correction
 * note).
 */
describe('pure rule evaluation (no DB dependency)', () => {
  const targetMean = 5.0;
  // 0.25, not 0.2: an exact power-of-two fraction, so z * targetSd and the
  // resulting division back to a z-score round-trip exactly in IEEE 754 --
  // 0.2 is not exactly representable in binary floating point, which made
  // this file's own first draft of the exact-2-SD boundary test flaky (a
  // z of 2.0000000000000018, not 2.0, from the lossy round-trip).
  const targetSd = 0.25;

  function pointAtZ(
    z: number,
    producedAt: Date,
  ): { value: number; producedAt: Date } {
    return { value: targetMean + z * targetSd, producedAt };
  }

  it('a point at exactly 2 SD is NOT a 1-2s trigger (boundary is strictly > 2, not >=)', () => {
    const result = evaluateWestgardRules({
      history: [pointAtZ(2.0, new Date())],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([]);
  });

  it('1-2s: a single point just beyond 2 SD, with no other rule able to fire, persists as a warning', () => {
    const result = evaluateWestgardRules({
      history: [pointAtZ(2.3, new Date())],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '1_2s', severity: 'warning' }]);
  });

  it('1-3s: a single point beyond 3 SD is a rejection, and suppresses the redundant 1-2s warning', () => {
    const result = evaluateWestgardRules({
      history: [pointAtZ(3.5, new Date())],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '1_3s', severity: 'rejection' }]);
  });

  it('a point at exactly 3 SD is NOT a 1-3s trigger', () => {
    const result = evaluateWestgardRules({
      history: [pointAtZ(3.0, new Date())],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '1_2s', severity: 'warning' }]);
  });

  it('2-2s: the two most recent points both beyond 2 SD, same side, is a rejection', () => {
    const now = new Date();
    const result = evaluateWestgardRules({
      history: [pointAtZ(2.4, now), pointAtZ(2.2, now)],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '2_2s', severity: 'rejection' }]);
  });

  it('2-2s does NOT fire when the two most recent points are on opposite sides', () => {
    const now = new Date();
    const result = evaluateWestgardRules({
      history: [pointAtZ(-2.4, now), pointAtZ(2.2, now)],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '1_2s', severity: 'warning' }]);
  });

  it('4-1s: four consecutive points beyond 1 SD, same side, is a rejection', () => {
    const now = new Date();
    const result = evaluateWestgardRules({
      history: [
        pointAtZ(1.2, now),
        pointAtZ(1.3, now),
        pointAtZ(1.1, now),
        pointAtZ(1.4, now),
      ],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '4_1s', severity: 'rejection' }]);
  });

  it('4-1s does NOT fire with only three qualifying points', () => {
    const now = new Date();
    const result = evaluateWestgardRules({
      history: [pointAtZ(1.2, now), pointAtZ(1.3, now), pointAtZ(1.1, now)],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([]);
  });

  it('10x: ten consecutive points on the same side of the mean, regardless of magnitude, is a rejection', () => {
    const now = new Date();
    const history = Array.from({ length: 10 }, (_, i) =>
      pointAtZ(0.1 + i * 0.02, now),
    );
    const result = evaluateWestgardRules({
      history,
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '10x', severity: 'rejection' }]);
  });

  it('10x does NOT fire with only nine qualifying points', () => {
    const now = new Date();
    const history = Array.from({ length: 9 }, (_, i) =>
      pointAtZ(0.1 + i * 0.02, now),
    );
    const result = evaluateWestgardRules({
      history,
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([]);
  });

  it('r-4s: a range beyond 4 SD against the sibling level is a rejection', () => {
    const result = evaluateWestgardRules({
      history: [pointAtZ(2.5, new Date())],
      targetMean,
      targetSd,
      siblingLevelZScore: -2.0, // range = |2.5 - (-2.0)| = 4.5 > 4
    });
    expect(result).toEqual([{ ruleCode: 'r_4s', severity: 'rejection' }]);
  });

  it('r-4s is simply not evaluated (no violation, no error) when no sibling exists', () => {
    const result = evaluateWestgardRules({
      history: [pointAtZ(2.5, new Date())],
      targetMean,
      targetSd,
      siblingLevelZScore: null,
    });
    expect(result).toEqual([{ ruleCode: '1_2s', severity: 'warning' }]);
  });
});

/**
 * RLS isolation for `qc_rule_violation`, mirroring `control_lot`'s own
 * negative test in `control-lot.e2e-spec.ts`.
 */
describe('qc_rule_violation RLS isolation (e2e)', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  const TENANT_B = '00000000-0000-0000-0000-000000000099';
  const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

  async function setTenant(tenantId: string) {
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, false)`,
    );
  }

  it('a qc_rule_violation row created under one tenant is invisible to another tenant session', async () => {
    await setTenant(TENANT_A);
    const [analyteRow] = await db
      .select({ id: analyte.id })
      .from(analyte)
      .limit(1);
    const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
    if (!analyteRow || !unitRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }

    const [lot] = await db
      .insert(controlLot)
      .values({
        tenantId: TENANT_A,
        analyteId: analyteRow.id,
        level: 'normal',
        unitId: unitRow.id,
        targetMean: '5.0',
        targetSd: '0.2',
        lotNumber: `QC-VIOLATION-RLS-${Date.now()}`,
      })
      .returning();
    const [obs] = await db
      .insert(observation)
      .values({
        tenantId: TENANT_A,
        isControl: true,
        controlLotId: lot.id,
        analyteId: analyteRow.id,
        dataType: 'quantity',
        valueNum: '9.5',
        source: 'manual',
      })
      .returning();
    const [violation] = await db
      .insert(qcRuleViolation)
      .values({
        tenantId: TENANT_A,
        controlLotId: lot.id,
        observationId: obs.id,
        observationCreatedAt: sql`(SELECT created_at FROM observation WHERE id = ${obs.id})`,
        ruleCode: '1_3s',
        severity: 'rejection',
      })
      .returning();

    await setTenant(TENANT_A);
    const visibleToOwnTenant = await db
      .select()
      .from(qcRuleViolation)
      .where(eq(qcRuleViolation.id, violation.id));
    expect(visibleToOwnTenant).toHaveLength(1);

    await setTenant(TENANT_B);
    const visibleToWrongTenant = await db
      .select()
      .from(qcRuleViolation)
      .where(eq(qcRuleViolation.id, violation.id));
    expect(visibleToWrongTenant).toHaveLength(0);

    await setTenant(TENANT_A);
  });
});

/**
 * End-to-end detection via the real HTTP route, real Postgres, real
 * Keycloak tokens -- matching `control-lot.e2e-spec.ts`'s own standard.
 */
describe('Westgard rule evaluation on QC result entry (e2e)', () => {
  const TENANT_A = '00000000-0000-0000-0000-000000000001';
  let app: INestApplication<App>;
  let tokenA: string;
  // One analyte per test (not one shared analyte), deliberately: R-4s's
  // sibling-pairing is scoped by `(analyteId, instrumentId)` alone (ADR-0018
  // §Decision 3), so two tests sharing one analyte could see each other's
  // control lots as false "sibling levels" -- found the hard way, a real
  // cross-test contamination this file's first draft hit (the r-4s test's
  // own 'high'-level lot leaking into a later test's unrelated 1-3s case).
  let analyteIds: string[];
  let unitId: string;

  interface RecordResultResponse {
    resourceId: string;
    after: {
      violations: { ruleCode: string; severity: string }[];
    };
  }

  // Only ruleCode/severity are asserted -- `body.after.violations` carries
  // the full QcRuleViolationResult DTO (id/controlLotId/observationId/
  // detectedAt too), which is real per-run, non-deterministic data.
  function ruleSeverityPairs(
    violations: { ruleCode: string; severity: string }[],
  ) {
    return violations.map((v) => ({
      ruleCode: v.ruleCode,
      severity: v.severity,
    }));
  }

  async function createLot(
    analyteId: string,
    level: string,
    targetMean: string,
    targetSd: string,
  ) {
    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const [lot] = await db
      .insert(controlLot)
      .values({
        tenantId: TENANT_A,
        analyteId,
        level,
        unitId,
        targetMean,
        targetSd,
        lotNumber: `WESTGARD-E2E-${level}-${Date.now()}-${Math.random()}`,
      })
      .returning();
    return lot.id;
  }

  async function postResult(
    lotId: string,
    valueNum: number,
  ): Promise<RecordResultResponse> {
    const res = await request(app.getHttpServer())
      .post(`/v1/control-lots/${lotId}/results`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dataType: 'quantity', valueNum })
      .expect(201);
    return res.body as RecordResultResponse;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    tokenA = await getKeycloakToken('test-user', 'test-password');

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const analyteRows = await db
      .select({ id: analyte.id })
      .from(analyte)
      .limit(10);
    const [unitRow] = await db.select({ id: unit.id }).from(unit).limit(1);
    if (analyteRows.length < 10 || !unitRow) {
      throw new Error(
        'chemistry-catalog seed data not found -- run `pnpm db:reset` first',
      );
    }
    analyteIds = analyteRows.map((r) => r.id);
    unitId = unitRow.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1-2s alone (no confirming rejection rule) persists as a warning', async () => {
    const lotId = await createLot(analyteIds[0], 'normal', '5.0', '0.2');
    const body = await postResult(lotId, 5.46); // z = 2.3

    expect(ruleSeverityPairs(body.after.violations)).toEqual([
      { ruleCode: '1_2s', severity: 'warning' },
    ]);
  });

  it('1-3s fires as a rejection and suppresses the redundant 1-2s warning', async () => {
    const lotId = await createLot(analyteIds[1], 'normal', '5.0', '0.2');
    const body = await postResult(lotId, 5.7); // z = 3.5

    expect(ruleSeverityPairs(body.after.violations)).toEqual([
      { ruleCode: '1_3s', severity: 'rejection' },
    ]);
  });

  it('2-2s fires only once two consecutive same-side points beyond 2 SD exist', async () => {
    const lotId = await createLot(analyteIds[2], 'normal', '5.0', '0.2');
    const first = await postResult(lotId, 5.48); // z = 2.4
    expect(ruleSeverityPairs(first.after.violations)).toEqual([
      { ruleCode: '1_2s', severity: 'warning' },
    ]);

    const second = await postResult(lotId, 5.44); // z = 2.2
    expect(ruleSeverityPairs(second.after.violations)).toEqual([
      { ruleCode: '2_2s', severity: 'rejection' },
    ]);
  });

  it('4-1s fires only once four consecutive same-side points beyond 1 SD exist', async () => {
    const lotId = await createLot(analyteIds[3], 'normal', '5.0', '0.2');
    for (const z of [1.2, 1.3, 1.1]) {
      const body = await postResult(lotId, 5.0 + z * 0.2);
      expect(ruleSeverityPairs(body.after.violations)).toEqual([]);
    }
    const fourth = await postResult(lotId, 5.0 + 1.4 * 0.2);
    expect(ruleSeverityPairs(fourth.after.violations)).toEqual([
      { ruleCode: '4_1s', severity: 'rejection' },
    ]);
  });

  it('10x fires only once ten consecutive same-side points exist', async () => {
    const lotId = await createLot(analyteIds[4], 'normal', '5.0', '0.2');
    for (let i = 0; i < 9; i++) {
      const body = await postResult(lotId, 5.0 + (0.1 + i * 0.02) * 0.2);
      expect(ruleSeverityPairs(body.after.violations)).toEqual([]);
    }
    const tenth = await postResult(lotId, 5.0 + (0.1 + 9 * 0.02) * 0.2);
    expect(ruleSeverityPairs(tenth.after.violations)).toEqual([
      { ruleCode: '10x', severity: 'rejection' },
    ]);
  });

  it('r-4s fires against a same-day sibling-level result, and is not evaluated when no sibling exists', async () => {
    const normalLotId = await createLot(analyteIds[5], 'normal', '5.0', '0.2');
    const highLotId = await createLot(analyteIds[5], 'high', '10.0', '0.5');

    await postResult(highLotId, 9.0); // sibling z = -2.0

    const withSibling = await postResult(normalLotId, 5.5); // z = 2.5; range = |2.5 - (-2.0)| = 4.5 > 4
    expect(ruleSeverityPairs(withSibling.after.violations)).toEqual([
      { ruleCode: 'r_4s', severity: 'rejection' },
    ]);

    // A different analyte entirely -- guarantees no sibling-level result
    // can possibly exist for it.
    const lonelyLotId = await createLot(analyteIds[6], 'normal', '5.0', '0.2');
    const withoutSibling = await postResult(lonelyLotId, 5.5); // z = 2.5, no sibling
    expect(ruleSeverityPairs(withoutSibling.after.violations)).toEqual([
      { ruleCode: '1_2s', severity: 'warning' },
    ]);
  });

  it('persists a real qc_rule_violation row for a detected violation, in the same tenant', async () => {
    const lotId = await createLot(analyteIds[7], 'normal', '5.0', '0.2');
    const body = await postResult(lotId, 5.7); // z = 3.5, 1-3s

    const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
    const rows = await db
      .select()
      .from(qcRuleViolation)
      .where(eq(qcRuleViolation.observationId, body.resourceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].ruleCode).toBe('1_3s');
    expect(rows[0].severity).toBe('rejection');
    expect(rows[0].controlLotId).toBe(lotId);
  });
});
