import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

/**
 * TASK-032/ADR-0011: proves the role→capability model through the live API,
 * with real Keycloak-issued tokens for a bench role (technologist), a
 * verifier, and a user with no realm role at all (the exact state every
 * token was in before this task — ADR-0011's explicit fail-closed AC).
 */
describe('Capability checks (e2e)', () => {
  let app: INestApplication<App>;
  let technologistToken: string;
  let verifierToken: string;
  let noRoleToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [technologistToken, verifierToken, noRoleToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-2', 'test-password-2'),
      getKeycloakToken('test-user-3', 'test-password-3'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a bench-role (technologist) user may enter_result', () => {
    return request(app.getHttpServer())
      .get('/auth/capability-check/enter-result')
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(200);
  });

  it('a bench-role (technologist) user is refused verify (TASK-032 AC)', () => {
    return request(app.getHttpServer())
      .get('/auth/capability-check/verify')
      .set('Authorization', `Bearer ${technologistToken}`)
      .expect(403);
  });

  it('a verifier may verify', () => {
    return request(app.getHttpServer())
      .get('/auth/capability-check/verify')
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  });

  it('a verifier may also enter_result', () => {
    return request(app.getHttpServer())
      .get('/auth/capability-check/enter-result')
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
  });

  it(
    'a user with no realm role assigned is refused every capability ' +
      '(ADR-0011 fail-closed AC)',
    async () => {
      await request(app.getHttpServer())
        .get('/auth/capability-check/enter-result')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/auth/capability-check/verify')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
    },
  );

  it('an unauthenticated request is refused before any capability check runs', () => {
    return request(app.getHttpServer())
      .get('/auth/capability-check/verify')
      .expect(401);
  });
});
