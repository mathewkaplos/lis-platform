import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-043 (FEAT-012): proves the order builder's own catalog-read
 * prerequisite through the live API -- real Keycloak tokens, real Postgres,
 * matching order.e2e-spec.ts's own standard. Relies on db/seed/chemistry-
 * catalog.sql's real CMP panel (14 member tests), same fixture order.e2e-
 * spec.ts already depends on.
 */
describe('Catalog API (e2e)', () => {
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

  it('returns the seeded CMP panel with its 14 member tests, and every seeded test code', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const body = res.body as {
      tests: { code: string }[];
      panels: { code: string; testDefinitionIds: string[] }[];
    };

    const cmp = body.panels.find((p) => p.code === 'CMP');
    if (!cmp) {
      throw new Error(
        `expected the seeded CMP panel, got ${JSON.stringify(body.panels)}`,
      );
    }
    if (cmp.testDefinitionIds.length !== 14) {
      throw new Error(
        `expected CMP to have 14 member tests, got ${cmp.testDefinitionIds.length}`,
      );
    }

    const testCodes = new Set(body.tests.map((t) => t.code));
    for (const code of [
      'GLU',
      'BUN',
      'CREAT',
      'NA',
      'K',
      'CL',
      'CO2',
      'CA',
      'TP',
      'ALB',
      'TBIL',
      'ALP',
      'AST',
      'ALT',
    ]) {
      if (!testCodes.has(code)) {
        throw new Error(
          `expected seeded test code ${code} in the catalog, got ${JSON.stringify([...testCodes])}`,
        );
      }
    }
  });

  it("never leaks TENANT_A's real catalog into TENANT_B's response (RLS at the API layer)", async () => {
    // Not asserted as literally empty: order.e2e-spec.ts's own cross-tenant
    // test inserts a throwaway TENANT_B test_definition fixture as a side
    // effect, and this suite's DB isn't reset between spec files -- asserting
    // isolation (TENANT_A's real, named fixtures never appear) is the robust
    // proof here, not an exact row count.
    const res = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const body = res.body as {
      tests: { code: string }[];
      panels: { code: string }[];
    };
    if (body.panels.some((p) => p.code === 'CMP')) {
      throw new Error(
        `TENANT_A's CMP panel leaked into TENANT_B's catalog: ${JSON.stringify(body.panels)}`,
      );
    }
    if (body.tests.some((t) => t.code === 'GLU')) {
      throw new Error(
        `TENANT_A's GLU test leaked into TENANT_B's catalog: ${JSON.stringify(body.tests)}`,
      );
    }
  });
});
