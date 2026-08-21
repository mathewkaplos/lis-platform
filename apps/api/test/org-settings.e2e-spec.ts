import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * Issue #692 (docs/plans/task-692-org-default-synoptic-standard.md).
 * `GET/PUT /v1/org-settings` -- `tenant.preferred_synoptic_source_standard`,
 * read by apps/web's synoptic recording page (issue #690) to auto-resolve
 * its own "Choose reporting standard" picker. `tenant` is the global
 * registry table itself (ADR-0039), so this is deliberately the one
 * settings surface in this repo not scoped by RLS -- every query filters
 * manually by the caller's own tenantId instead (`catalog-admin.e2e-spec.ts`'s
 * own qa/technologist token fixture reused verbatim).
 */
describe('Org settings (e2e)', () => {
  let app: INestApplication<App>;
  let qaToken: string;
  let technologistToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    // Same seeded users catalog-admin.e2e-spec.ts's own fixture uses:
    // test-user-5 = qa (TENANT_A), test-user = technologist (TENANT_A).
    qaToken = await getKeycloakToken('test-user-5', 'test-password-5');
    technologistToken = await getKeycloakToken('test-user', 'test-password');
  });

  afterAll(async () => {
    // Real, shared tenant row -- reset to the default 'no preference'
    // state so this spec never leaks state into any other spec run
    // against the same tenant.
    await request(app.getHttpServer())
      .put('/v1/org-settings')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ preferredSynopticSourceStandard: null });
    await app.close();
  });

  it('GET requires no capability -- any authenticated tenant member can read it', async () => {
    await request(app.getHttpServer())
      .get('/v1/org-settings')
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(200);
  });

  it('PUT rejects a non-qa session (403)', async () => {
    await request(app.getHttpServer())
      .put('/v1/org-settings')
      .set('Authorization', `Bearer ${technologistToken}`)
      .send({ preferredSynopticSourceStandard: 'CAP' })
      .expect(403);
  });

  it('a qa session sets a preference, visible on the next GET, and clearing it back to null works', async () => {
    const updated = await request(app.getHttpServer())
      .put('/v1/org-settings')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ preferredSynopticSourceStandard: 'CAP' })
      .expect(200);
    const updatedBody = updated.body as {
      after: { preferredSynopticSourceStandard: string | null };
    };
    if (updatedBody.after.preferredSynopticSourceStandard !== 'CAP') {
      throw new Error(
        `expected the update to record 'CAP', got ${JSON.stringify(updatedBody)}`,
      );
    }

    const read = await request(app.getHttpServer())
      .get('/v1/org-settings')
      .set('Authorization', `Bearer ${qaToken}`)
      .expect(200);
    const readBody = read.body as {
      preferredSynopticSourceStandard: string | null;
    };
    if (readBody.preferredSynopticSourceStandard !== 'CAP') {
      throw new Error(
        `expected GET to reflect the update, got ${JSON.stringify(readBody)}`,
      );
    }

    const cleared = await request(app.getHttpServer())
      .put('/v1/org-settings')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({ preferredSynopticSourceStandard: null })
      .expect(200);
    const clearedBody = cleared.body as {
      after: { preferredSynopticSourceStandard: string | null };
    };
    if (clearedBody.after.preferredSynopticSourceStandard !== null) {
      throw new Error(
        `expected clearing the preference to record null, got ${JSON.stringify(clearedBody)}`,
      );
    }
  });
});
