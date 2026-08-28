import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { SMTPServer } from 'smtp-server';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { createDb, testDefinition } from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

// mailparser types `ParsedMail.to` as `AddressObject | AddressObject[] |
// undefined` -- same normalization `case-report-email.e2e-spec.ts` already
// establishes for this exact type shape.
function addressText(
  value: AddressObject | AddressObject[] | undefined,
): string {
  if (!value) return '';
  return Array.isArray(value)
    ? value.map((a) => a.text).join(', ')
    : value.text;
}

/**
 * Issue #711 (docs/plans/task-711-invoice-email-delivery.md, approved
 * proposal §10 Q1: plain-text body, no PDF attachment -- no invoice PDF
 * generator exists in this repo). Mirrors `case-report-email.e2e-spec.ts`'s
 * own real-SMTP-conversation approach exactly: a real local `smtp-server`
 * instance this test spins up itself, not a mocked `sendEmail()` call. The
 * per-tenant-SMTP-account path is NOT re-tested here -- `email.client.ts`'s
 * `from` resolution is identical code already fully proven by that same
 * file's own dedicated test; duplicating it here would prove nothing new.
 */
describe('Invoice email (e2e)', () => {
  let app: INestApplication<App>;
  let smtpServer: SMTPServer;
  let smtpPort: number;
  let receivedMessages: ParsedMail[];
  let tokenA: string; // test-user: technologist, tenant A -- manage_billing
  let glucoseId: string;
  const GLUCOSE_PRICE_CENTS = 500;

  async function createPatient(email?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'InvoiceEmail', lastName: 'Fixture', sex: 'U', email })
      .expect(201);
    return (res.body as { resourceId: string }).resourceId;
  }

  async function createInvoice(patientId: string): Promise<string> {
    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glucoseId] })
      .expect(201);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    const invoiceRes = await request(app.getHttpServer())
      .post(`/v1/orders/${orderId}/invoice`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(201);
    return (invoiceRes.body as { resourceId: string }).resourceId;
  }

  beforeAll(async () => {
    // Real, local SMTP listener -- same authOptional/onAuth/onData shape
    // `case-report-email.e2e-spec.ts` already establishes for the identical
    // reason (nodemailer always attempts AUTH; no real Gmail credentials
    // anywhere in this suite).
    receivedMessages = [];
    smtpServer = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
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

    tokenA = await getKeycloakToken('test-user', 'test-password');

    const db = createDb();
    const [glucose] = await db
      .select({ id: testDefinition.id })
      .from(testDefinition)
      .where(
        and(
          eq(testDefinition.tenantId, TENANT_A),
          eq(testDefinition.code, 'GLU'),
        ),
      );
    if (!glucose) {
      throw new Error(
        'expected db/seed/chemistry-catalog.sql fixture (GLU) to exist under TENANT_A',
      );
    }
    glucoseId = glucose.id;
    await db
      .update(testDefinition)
      .set({ billingCode: 'GLU-CPT', priceCents: GLUCOSE_PRICE_CENTS })
      .where(eq(testDefinition.id, glucoseId));
  });

  afterEach(() => {
    receivedMessages = [];
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
  });

  it('emails a plain-text invoice summary to an explicit recipient over a real SMTP conversation', async () => {
    const patientId = await createPatient();
    const invoiceId = await createInvoice(patientId);

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send-email`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ to: 'recipient@example.invalid' })
      .expect(200);

    expect(receivedMessages).toHaveLength(1);
    const [message] = receivedMessages;
    expect(addressText(message.to)).toContain('recipient@example.invalid');
    expect(message.subject).toContain('Invoice');
    // No PDF -- proposal §10 Q1's own approved scope.
    expect(message.attachments).toHaveLength(0);
    expect(message.text).toContain('GLU-CPT');
    expect(message.text).toContain((GLUCOSE_PRICE_CENTS / 100).toFixed(2));
  });

  it("resolves the patient's own on-file email when `to` is omitted", async () => {
    const patientId = await createPatient('patient-on-file@example.invalid');
    const invoiceId = await createInvoice(patientId);

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send-email`)
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
    const invoiceId = await createInvoice(patientId);

    const res = await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send-email`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({})
      .expect(400);

    expect((res.body as { detail?: string }).detail).toMatch(
      /no email on file/i,
    );
    expect(receivedMessages).toHaveLength(0);
  });

  it('rejects a caller without manage_billing (403)', async () => {
    const patientId = await createPatient();
    const invoiceId = await createInvoice(patientId);

    const noRoleToken = await getKeycloakToken(
      'test-user-3',
      'test-password-3',
    );
    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send-email`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .send({ to: 'recipient@example.invalid' })
      .expect(403);

    expect(receivedMessages).toHaveLength(0);
  });
});
