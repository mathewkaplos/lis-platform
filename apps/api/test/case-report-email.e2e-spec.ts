import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SMTPServer } from 'smtp-server';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { getKeycloakFreshToken } from './get-keycloak-fresh-token';

const TENANT_A_GLUCOSE_CODE = 'GLU';

// mailparser types `ParsedMail.to` as `AddressObject | AddressObject[] |
// undefined` -- a real single-recipient message from this suite's own
// sendEmail() call is always the singular-object case, but the type
// itself doesn't know that; normalize rather than assert past it.
function addressText(
  value: AddressObject | AddressObject[] | undefined,
): string {
  if (!value) return '';
  return Array.isArray(value)
    ? value.map((a) => a.text).join(', ')
    : value.text;
}

/**
 * Pilot-readiness audit follow-up (email delivery, deliberately deferred at
 * #698 -- now built, per explicit human decision, on Gmail SMTP with an app
 * password). Proves `POST /v1/cases/:id/report-versions/:versionId/
 * send-email` end to end through a REAL SMTP conversation -- a real local
 * `smtp-server` instance this test spins up itself, not a mocked
 * `sendEmail()`/`nodemailer` call, matching this repo's own "test the real
 * thing" culture (`case-sign-out.e2e-spec.ts`'s own real-Keycloak-token
 * precedent, applied here to the new outbound-SMTP dependency instead).
 * `apps/api/src/email/email.client.ts`'s own `SMTP_SECURE=false` escape
 * hatch exists specifically so this test can point at a plain local
 * listener instead of a real Gmail account -- no real Gmail credentials are
 * ever involved in this suite.
 */
describe('Case report email (e2e)', () => {
  let app: INestApplication<App>;
  let smtpServer: SMTPServer;
  let smtpPort: number;
  let receivedMessages: ParsedMail[];
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens
  let tokenVerifier: string; // test-user-4: technologist+verifier, tenant A -- has `verify`, needed only to finalize the fixture case
  let tokenQa: string; // test-user-5: qa, tenant A -- manage_org_settings, needed only for the per-tenant SMTP test
  let testDefinitionId: string;

  async function createOrder(patientId: string): Promise<string> {
    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const catalog = catalogRes.body as {
      tests: { id: string; code: string }[];
    };
    if (!testDefinitionId) {
      const found = catalog.tests.find((t) => t.code === TENANT_A_GLUCOSE_CODE);
      if (!found) {
        throw new Error(
          `expected db/seed/chemistry-catalog.sql fixture '${TENANT_A_GLUCOSE_CODE}' in /v1/catalog`,
        );
      }
      testDefinitionId = found.id;
    }
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [testDefinitionId] })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  /** A fully lineage-complete, signed-out case (1 part, 1 block, 1 slide,
   * finalized) -- ready to have its report emailed. Same minimal fixture
   * shape as case-sign-out.e2e-spec.ts's own createFinalizableCase(). */
  async function createSignedOutCase(patientId: string): Promise<{
    caseId: string;
    versionId: string;
  }> {
    const orderId = await createOrder(patientId);
    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    const caseId = (caseRes.body as { resourceId: string }).resourceId;

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const [part] = (lineage.body as { parts: { id: string }[] }).parts;
    const blockRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/blocks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ specimenId: part.id })
      .expect(201);
    const blockId = (blockRes.body as { resourceId: string }).resourceId;
    await request(app.getHttpServer())
      .post(`/v1/blocks/${blockId}/slides`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);

    const finalizeRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/finalize`)
      .set('Authorization', `Bearer ${tokenVerifier}`)
      .expect(200);
    const versionId = (finalizeRes.body as { reportVersion: { id: string } })
      .reportVersion.id;

    return { caseId, versionId };
  }

  async function createPatient(email?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'ReportEmail', lastName: 'Fixture', sex: 'U', email })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  beforeAll(async () => {
    // A real, local SMTP listener -- authOptional so nodemailer's own
    // AUTH LOGIN handshake (driven by SMTP_USER/SMTP_APP_PASSWORD, which
    // this test sets to dummy values, never a real Gmail credential) just
    // succeeds without this test double needing to replicate Gmail's own
    // auth semantics; onData captures the real, fully-formed MIME message
    // nodemailer actually put on the wire.
    receivedMessages = [];
    smtpServer = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      // authOptional alone doesn't make smtp-server accept AUTH -- with no
      // onAuth handler it advertises AUTH but rejects every attempt with
      // "535 Authentication not implemented" (confirmed live: nodemailer's
      // own transporter always attempts AUTH here since `auth` is set on
      // the transport config). Accept any credentials -- SMTP_USER/
      // SMTP_APP_PASSWORD are dummy values regardless, real auth
      // enforcement is Gmail's own job in production, not this test's.
      onAuth(auth, _session, callback) {
        callback(null, { user: auth.username });
      },
      onData(stream, _session, callback) {
        simpleParser(stream)
          .then((parsed) => {
            receivedMessages.push(parsed);
            callback();
          })
          .catch(callback);
      },
    });
    await new Promise<void>((resolve) => {
      smtpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = smtpServer.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected the local SMTP test server to bind a TCP port');
    }
    smtpPort = address.port;
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(smtpPort);
    process.env.SMTP_SECURE = 'false';
    process.env.SMTP_USER = 'lis-test@example.invalid';
    process.env.SMTP_APP_PASSWORD = 'not-a-real-credential';
    process.env.SMTP_FROM = 'lis-noreply@example.invalid';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    [tokenA, tokenVerifier, tokenQa] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      // Real Authorization Code + PKCE flow, not Direct Grant -- finalize's
      // own StepUpGuard needs a genuinely fresh auth_time (same reasoning
      // case-sign-out.e2e-spec.ts's own header comment gives).
      getKeycloakFreshToken('test-user-4', 'test-password-4'),
      getKeycloakToken('test-user-5', 'test-password-5'),
    ]);
  });

  afterEach(() => {
    receivedMessages = [];
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
  });

  it('sends the signed report PDF to an explicit recipient over a real SMTP conversation', async () => {
    const patientId = await createPatient();
    const { caseId, versionId } = await createSignedOutCase(patientId);

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/report-versions/${versionId}/send-email`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ to: 'recipient@example.invalid' })
      .expect(200);

    expect(receivedMessages).toHaveLength(1);
    const [message] = receivedMessages;
    expect(addressText(message.to)).toContain('recipient@example.invalid');
    expect(message.attachments).toHaveLength(1);
    const [attachment] = message.attachments;
    expect(attachment.contentType).toBe('application/pdf');
    expect(attachment.filename).toBe(`case-report-${caseId}-v1.pdf`);
    // The real proof this is an actual PDF, not just a content-type label --
    // every PDF file begins with this exact magic-number header.
    expect(attachment.content.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it("resolves the patient's own on-file email when `to` is omitted", async () => {
    const patientId = await createPatient('patient-on-file@example.invalid');
    const { caseId, versionId } = await createSignedOutCase(patientId);

    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/report-versions/${versionId}/send-email`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(200);

    expect(receivedMessages).toHaveLength(1);
    expect(addressText(receivedMessages[0].to)).toContain(
      'patient-on-file@example.invalid',
    );
  });

  it('rejects with a real 400 when the patient has no email on file and no `to` was given', async () => {
    const patientId = await createPatient(); // no email
    const { caseId, versionId } = await createSignedOutCase(patientId);

    const res = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/report-versions/${versionId}/send-email`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(400);

    expect((res.body as { detail?: string }).detail).toMatch(
      /no email on file/i,
    );
    expect(receivedMessages).toHaveLength(0);
  });

  it('rejects a caller without manage_specimens (403)', async () => {
    const patientId = await createPatient();
    const { caseId, versionId } = await createSignedOutCase(patientId);

    const noRoleToken = await getKeycloakToken(
      'test-user-3',
      'test-password-3',
    );
    await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/report-versions/${versionId}/send-email`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .send({ to: 'recipient@example.invalid' })
      .expect(403);

    expect(receivedMessages).toHaveLength(0);
  });

  it("uses the tenant's own configured SMTP account, not the platform-wide default, once org-settings has one on file", async () => {
    // A second, independent local SMTP listener -- the real proof this
    // isn't just "email.client.ts always works," but that the tenant's own
    // credentials genuinely route the send to a *different* server than
    // the shared default `smtpServer` this whole file's own beforeAll sets
    // up. Only accepts the specific username the tenant will configure
    // below; the shared default's SMTP_USER ('lis-test@example.invalid')
    // would be rejected here, matching Gmail's own real behavior for a
    // wrong-account app password.
    const tenantMessages: ParsedMail[] = [];
    const tenantSmtpServer = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onAuth(auth, _session, callback) {
        if (auth.username !== 'tenant-lab@example.invalid') {
          callback(new Error('535 authentication failed'));
          return;
        }
        callback(null, { user: auth.username });
      },
      onData(stream, _session, callback) {
        simpleParser(stream)
          .then((parsed) => {
            tenantMessages.push(parsed);
            callback();
          })
          .catch(callback);
      },
    });
    await new Promise<void>((resolve) =>
      tenantSmtpServer.listen(0, '127.0.0.1', resolve),
    );
    const tenantAddress = tenantSmtpServer.server.address();
    if (!tenantAddress || typeof tenantAddress === 'string') {
      throw new Error(
        'expected the tenant SMTP test server to bind a TCP port',
      );
    }

    try {
      // email.client.ts's own host/port/secure stay the fixed
      // SMTP_HOST/PORT/SECURE env vars (this feature only overrides the
      // account being sent *from*, not the transport endpoint, matching
      // its own "Gmail app password, for now" scope) -- so this test's own
      // tenant-SMTP server must run on that SAME host/port the shared
      // default already points at, just accepting a different account.
      // Point the shared listener's own credentials check at this second
      // server isn't possible without a real second host/port; instead,
      // this test temporarily repoints the process-wide SMTP_PORT at the
      // tenant server for the duration of this one call, then restores it
      // -- the tenant-vs-default distinction being tested is *which
      // account* authenticates, not the transport address.
      const originalPort = process.env.SMTP_PORT;
      process.env.SMTP_PORT = String(tenantAddress.port);

      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${tokenQa}`)
        .send({
          smtpUser: 'tenant-lab@example.invalid',
          smtpAppPassword: 'tenant-own-app-password',
          smtpFrom: 'reports@tenant-lab.example.invalid',
        })
        .expect(200);

      const patientId = await createPatient();
      const { caseId, versionId } = await createSignedOutCase(patientId);

      await request(app.getHttpServer())
        .post(`/v1/cases/${caseId}/report-versions/${versionId}/send-email`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ to: 'recipient@example.invalid' })
        .expect(200);

      process.env.SMTP_PORT = originalPort;

      expect(tenantMessages).toHaveLength(1);
      expect(tenantMessages[0].from?.text).toContain(
        'reports@tenant-lab.example.invalid',
      );
      // The shared default server (this file's own beforeAll) never saw
      // this message -- the send genuinely went through the tenant's own
      // configured account/transport, not a fallback.
      expect(receivedMessages).toHaveLength(0);
    } finally {
      await request(app.getHttpServer())
        .put('/v1/org-settings')
        .set('Authorization', `Bearer ${tokenQa}`)
        .send({ smtpUser: null, smtpAppPassword: null, smtpFrom: null });
      await new Promise<void>((resolve) =>
        tenantSmtpServer.close(() => resolve()),
      );
    }
  });
});
