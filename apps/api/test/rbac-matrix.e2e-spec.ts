import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000099';

/**
 * Pilot-readiness audit, docs/pilot/PILOT-USER-GUIDE.md §18.1's own
 * allow/deny matrix ("log in as each account, attempt each action"). That
 * matrix was designed as a manual browser sweep; this file is its
 * API-level equivalent, run for real against the live app (real Keycloak
 * tokens, real Postgres, real `CapabilityGuard`-decorated routes) -- not a
 * re-test of `capabilities.spec.ts`'s already-exhaustive pure
 * `resolveGrantingRole()` coverage, but proof that each route is actually
 * wired to the *correct* capability, for the *exact* seeded accounts the
 * guide names. `test-user-9` (reception), `test-user-10` (cashier), and
 * `test-user-11` (lab_admin) had zero e2e coverage anywhere in this repo
 * before this file (confirmed via a repo-wide grep) -- this closes that
 * gap for six of §18.1's rows outright.
 *
 * Every deny assertion uses a syntactically-valid but nonexistent resource
 * id and no real fixture: `CapabilityGuard` runs before any body/param
 * validation or business logic in Nest's request pipeline (Guards ->
 * Interceptors -> Pipes -> Handler), so a caller lacking the capability
 * always gets a real 403 here regardless of whether the target resource
 * exists -- this is the same guard-only-denial precedent
 * `case-sign-out.e2e-spec.ts`'s own AC #1 already relies on. Every allow
 * assertion either gets a genuine 2xx (side-effect-free reads, or a create
 * with a real, valid body) or, where a real prerequisite resource would be
 * expensive to build purely to prove authorization (an existing invoice to
 * pay), asserts the response is definitely *not* 403 -- the guard's own
 * pass/deny decision is what this file is proving, not each route's full
 * business logic, which every domain's own e2e spec already covers
 * separately (billing.e2e-spec.ts, patient.e2e-spec.ts, etc.).
 *
 * Two §18.1 rows are deliberately not duplicated here:
 * - `test-user` (technologist) / `test-user-3` (no role) sign-out-deny and
 *   `test-user-4` (pathologist) sign-out-allow are already fully covered
 *   by `case-sign-out.e2e-spec.ts`'s own AC #1/#2 -- including the
 *   allow case's step-up-fresh token (`getKeycloakFreshToken`), which a
 *   Direct Grant token here never carries (that file's own header comment
 *   explains why). Re-asserting the same three calls here would be pure
 *   duplication, not new coverage.
 */
describe('RBAC allow/deny matrix (e2e, pilot guide §18.1)', () => {
  let app: INestApplication<App>;

  let receptionToken: string; // test-user-9
  let technologistToken: string; // test-user
  let pathologistToken: string; // test-user-4 (technologist + pathologist)
  let cashierToken: string; // test-user-10
  let labAdminToken: string; // test-user-11
  let qaToken: string; // test-user-5
  let noRoleToken: string; // test-user-3

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    [
      receptionToken,
      technologistToken,
      pathologistToken,
      cashierToken,
      labAdminToken,
      qaToken,
      noRoleToken,
    ] = await Promise.all([
      getKeycloakToken('test-user-9', 'test-password-9'),
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user-10', 'test-password-10'),
      getKeycloakToken('test-user-11', 'test-password-11'),
      getKeycloakToken('test-user-5', 'test-password-5'),
      getKeycloakToken('test-user-3', 'test-password-3'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('test-user-9 (reception): manage_patients + manage_orders only', () => {
    it('register patient -- allowed', async () => {
      await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${receptionToken}`)
        .send({
          firstName: 'RbacMatrix',
          lastName: `Reception-${Date.now()}`,
          sex: 'U',
        })
        .expect(201);
    });

    it('sign out a pathology case -- denied (no verify)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/cases/${NONEXISTENT_ID}/finalize`)
        .set('Authorization', `Bearer ${receptionToken}`)
        .expect(403);
    });

    it('change org settings -- denied (no manage_org_settings)', async () => {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${receptionToken}`)
        .send({})
        .expect(403);
    });

    it('record a payment -- denied (no manage_billing)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/invoices/${NONEXISTENT_ID}/payments`)
        .set('Authorization', `Bearer ${receptionToken}`)
        .send({ method: 'cash', amountCents: 100 })
        .expect(403);
    });
  });

  describe('test-user (technologist): enter_result, manage_patients/orders/specimens, manage_billing', () => {
    it('record a payment -- allowed (technologist carries manage_billing, a real, deliberate grant)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/invoices/${NONEXISTENT_ID}/payments`)
        .set('Authorization', `Bearer ${technologistToken}`)
        .send({ method: 'cash', amountCents: 100 });
      expect(res.status).not.toBe(403);
    });
  });

  describe('test-user-4 (pathologist): manage_users -- deliberately not granted', () => {
    it('manage users -- denied (no manage_users)', async () => {
      await request(app.getHttpServer())
        .get('/v1/users')
        .set('Authorization', `Bearer ${pathologistToken}`)
        .expect(403);
    });
  });

  describe('test-user-10 (cashier): manage_billing only', () => {
    it('record a payment -- allowed', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/invoices/${NONEXISTENT_ID}/payments`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({ method: 'cash', amountCents: 100 });
      expect(res.status).not.toBe(403);
    });

    it('edit diagnosis/narrative -- denied (no manage_specimens)', async () => {
      await request(app.getHttpServer())
        .put(`/v1/cases/${NONEXISTENT_ID}/narrative`)
        .set('Authorization', `Bearer ${cashierToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('test-user-11 (lab_admin): manage_org_settings/manage_users/manage_catalog/manage_billing/manage_patients', () => {
    it('organization settings -- allowed', async () => {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${labAdminToken}`)
        .send({})
        .expect(200);
    });

    it('users -- allowed', async () => {
      await request(app.getHttpServer())
        .get('/v1/users')
        .set('Authorization', `Bearer ${labAdminToken}`)
        .expect(200);
    });

    it('facilities -- allowed (manage_patients)', async () => {
      await request(app.getHttpServer())
        .post('/v1/referring-facilities')
        .set('Authorization', `Bearer ${labAdminToken}`)
        .send({ name: `RBAC Matrix Facility ${Date.now()}` })
        .expect(201);
    });

    it('catalog -- allowed (manage_catalog; a bogus analyte id 400s on business logic, never 403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/test-definitions')
        .set('Authorization', `Bearer ${labAdminToken}`)
        .send({
          code: `RBAC-MATRIX-${Date.now()}`,
          displayName: 'RBAC Matrix Test',
          analyteIds: [NONEXISTENT_ID],
        });
      expect(res.status).not.toBe(403);
    });

    it('billing -- allowed', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/invoices/${NONEXISTENT_ID}/payments`)
        .set('Authorization', `Bearer ${labAdminToken}`)
        .send({ method: 'cash', amountCents: 100 });
      expect(res.status).not.toBe(403);
    });

    it('resolve a QC violation -- denied (resolve_qc is qa-only, deliberately not folded into lab_admin)', async () => {
      await request(app.getHttpServer())
        .post(`/v1/qc-rule-violations/${NONEXISTENT_ID}/resolve`)
        .set('Authorization', `Bearer ${labAdminToken}`)
        .send({})
        .expect(403);
    });
  });

  describe('test-user-5 (qa): manage_org_settings/resolve_qc/manage_workflow/manage_report_templates/manage_catalog/view_operational_reports', () => {
    it('set org default synoptic standard -- allowed', async () => {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ preferredSynopticSourceStandard: 'CAP' })
        .expect(200);
    });

    it('manage users -- denied (manage_users is lab_admin-only)', async () => {
      await request(app.getHttpServer())
        .get('/v1/users')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(403);
    });
  });

  describe('test-user-3 (no role): the true fail-closed baseline', () => {
    it('every mutating action tried here is denied', async () => {
      await request(app.getHttpServer())
        .post('/v1/patients')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send({ firstName: 'X', lastName: 'Y', sex: 'U' })
        .expect(403);
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`/v1/invoices/${NONEXISTENT_ID}/payments`)
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send({ method: 'cash', amountCents: 100 })
        .expect(403);
      await request(app.getHttpServer())
        .get('/v1/users')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403);
    });
  });
});
