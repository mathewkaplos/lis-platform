import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

/**
 * Issue #827: CapabilityCheckController exists purely to prove the
 * audit/capability-guard mechanism (capability-check.e2e-spec.ts) -- several
 * of its routes insert real patient/order rows, so it must not be reachable
 * when NODE_ENV is 'production' (same precedent as main.ts's own Swagger
 * gate). Deliberately its own file, not a second describe block appended to
 * capability-check.e2e-spec.ts: AuthModule's @Module() controllers array is
 * evaluated once, at import time, when the module is first loaded -- a
 * static `import { AppModule } from ...` at the top of a shared file runs
 * before any beforeAll() in that file, so setting process.env.NODE_ENV
 * inside a beforeAll() there is always too late to affect it. A dynamic
 * import(), after setting NODE_ENV, in a file that itself never statically
 * imports AppModule, is the only way to control which value AuthModule sees
 * at its own import time.
 */
describe('CapabilityCheckController is not registered when NODE_ENV=production (e2e)', () => {
  let app: INestApplication<App>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const { AppModule } = await import('./../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('POST /auth/capability-check/verify 404s -- the route does not exist in this build', async () => {
    await request(app.getHttpServer())
      .post('/auth/capability-check/verify')
      .send({})
      .expect(404);
  });
});
