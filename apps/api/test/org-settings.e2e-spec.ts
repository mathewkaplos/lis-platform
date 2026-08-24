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
    // Real, shared tenant row -- reset to the default 'no preference'/
    // no-SMTP-configured state so this spec never leaks state into any
    // other spec run against the same tenant.
    await request(app.getHttpServer())
      .put('/v1/org-settings')
      .set('Authorization', `Bearer ${qaToken}`)
      .send({
        preferredSynopticSourceStandard: null,
        smtpUser: null,
        smtpAppPassword: null,
        smtpFrom: null,
      });
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

  describe('Per-tenant SMTP (pilot-readiness audit follow-up)', () => {
    const APP_PASSWORD = 'a-real-looking-app-password-16c';

    afterEach(async () => {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ smtpUser: null, smtpAppPassword: null, smtpFrom: null });
    });

    it('setting an app password never echoes it back -- GET and the PUT response itself only ever expose smtpConfigured', async () => {
      const updated = await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          smtpUser: 'lab@example.invalid',
          smtpAppPassword: APP_PASSWORD,
          smtpFrom: 'reports@example.invalid',
        })
        .expect(200);

      // Real proof, not just "the schema doesn't declare the field" --
      // the plaintext (and, since AES-256-GCM ciphertext is base64, any
      // encrypted form of it) must never appear anywhere in the raw
      // response body, not just be absent from a typed accessor.
      const rawBody = JSON.stringify(updated.body);
      if (rawBody.includes(APP_PASSWORD)) {
        throw new Error(
          'the PUT response echoed the plaintext app password back',
        );
      }

      const updatedBody = updated.body as {
        after: {
          smtpUser: string | null;
          smtpFrom: string | null;
          smtpConfigured: boolean;
        };
      };
      if (
        updatedBody.after.smtpUser !== 'lab@example.invalid' ||
        updatedBody.after.smtpFrom !== 'reports@example.invalid' ||
        updatedBody.after.smtpConfigured !== true
      ) {
        throw new Error(
          `expected smtpUser/smtpFrom set and smtpConfigured true, got ${JSON.stringify(updatedBody)}`,
        );
      }

      const read = await request(app.getHttpServer())
        .get('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);
      if (JSON.stringify(read.body).includes(APP_PASSWORD)) {
        throw new Error('GET echoed the plaintext app password back');
      }
      const readBody = read.body as { smtpConfigured: boolean };
      if (readBody.smtpConfigured !== true) {
        throw new Error(
          `expected GET to reflect smtpConfigured: true, got ${JSON.stringify(readBody)}`,
        );
      }
    });

    it('omitting smtpAppPassword on a later, unrelated update leaves the stored one unchanged', async () => {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          smtpUser: 'lab@example.invalid',
          smtpAppPassword: APP_PASSWORD,
        })
        .expect(200);

      // Same tenant, a completely unrelated field, smtpAppPassword key not
      // present in the body at all -- the three-way `!== undefined`
      // resolution (org-settings.controller.ts's own header comment) must
      // treat this as "leave it alone," not silently clear it.
      const after = await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ address: '123 Lab Street' })
        .expect(200);
      const afterBody = after.body as { after: { smtpConfigured: boolean } };
      if (afterBody.after.smtpConfigured !== true) {
        throw new Error(
          `expected an unrelated update to leave smtpConfigured: true untouched, got ${JSON.stringify(afterBody)}`,
        );
      }
    });

    it('an explicit null clears it -- smtpConfigured flips back to false', async () => {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({
          smtpUser: 'lab@example.invalid',
          smtpAppPassword: APP_PASSWORD,
        })
        .expect(200);

      const cleared = await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ smtpAppPassword: null })
        .expect(200);
      const clearedBody = cleared.body as {
        after: { smtpConfigured: boolean };
      };
      if (clearedBody.after.smtpConfigured !== false) {
        throw new Error(
          `expected clearing smtpAppPassword to flip smtpConfigured to false, got ${JSON.stringify(clearedBody)}`,
        );
      }
    });
  });
});
