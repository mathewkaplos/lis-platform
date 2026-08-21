import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import fastifyMultipart from '@fastify/multipart';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { createDb, imageAttachment, synopticProtocolVersion } from '@lis/db';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { objectExists } from '../src/storage/object-storage.client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

/**
 * FEAT-061 (ADR-0052, docs/plans/feat-061-image-attachments-annotations.md).
 * Proves issue #540's own two ACs against a real MinIO instance, real
 * Postgres, real Keycloak tokens -- matching `case.e2e-spec.ts`'s own
 * standard.
 */
describe('Image attachments + annotations (e2e)', () => {
  // The real Fastify adapter, not the Express default every other e2e spec
  // in this repo uses (Test.createTestingModule().createNestApplication()
  // with no adapter arg) -- @fastify/multipart's request.file() only exists
  // on a Fastify request at all (api-design Skill entry #10's own
  // documented "every e2e spec defaults to Express, never the real Fastify
  // adapter" gap). Unlike every prior feature, this route's core function
  // structurally cannot run under Express -- it is not merely an extra
  // verification step here, it is the only way this route is testable
  // through the e2e harness at all.
  let app: NestFastifyApplication;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens
  let noRoleToken: string;

  async function createCaseWithBlock(): Promise<{
    caseId: string;
    blockId: string;
  }> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ firstName: 'ImageAttachment', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const glu = (
      catalogRes.body as { tests: { id: string; code: string }[] }
    ).tests.find((t) => t.code === 'GLU');
    if (!glu) {
      throw new Error("expected db/seed/chemistry-catalog.sql fixture 'GLU'");
    }

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId, testDefinitionIds: [glu.id] })
      .expect(201);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

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

    return { caseId, blockId };
  }

  /** A real discrete, analyte-bound Observation representing "a specific
   * synoptic finding" (proposal §5/§10 Q3) -- recorded via FEAT-058's real
   * synoptic-response flow, same real ICCR-seeded colorectal protocol
   * `synoptic-protocol.e2e-spec.ts` already proves. */
  async function recordARealSynopticFinding(caseId: string): Promise<string> {
    const lineageRes = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const lineageBody = lineageRes.body as {
      orderId: string;
      parts: { id: string }[];
    };
    const orderId = lineageBody.orderId;
    const specimenId = lineageBody.parts[0].id;
    const ordRes = await request(app.getHttpServer())
      .get(`/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const orderedTestId = (ordRes.body as { orderedTests: { id: string }[] })
      .orderedTests[0].id;

    const protocolsRes = await request(app.getHttpServer())
      .get('/v1/synoptic-protocols')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const colorectal = (
      protocolsRes.body as { protocols: { id: string; name: string }[] }
    ).protocols.find((p) => p.name === 'Colorectal Cancer');
    if (!colorectal) {
      throw new Error(
        "expected db/seed/synoptic-protocol-colorectal.sql's 'Colorectal Cancer' protocol",
      );
    }
    const [{ id: versionId }] = await db
      .select({ id: synopticProtocolVersion.id })
      .from(synopticProtocolVersion)
      .where(
        and(
          eq(synopticProtocolVersion.synopticProtocolId, colorectal.id),
          eq(synopticProtocolVersion.status, 'published'),
        ),
      )
      .limit(1);

    // The full required-element set (synoptic-protocol.e2e-spec.ts's own
    // baseColorectalResponses) -- the recorder rejects an incomplete
    // response set (every visible `required` element must be present), so
    // a couple of hand-picked responses alone (rejected, found for real
    // against this same real seeded protocol) isn't enough here.
    const responseRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/synoptic-responses`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        orderedTestId,
        specimenId,
        synopticProtocolVersionId: versionId,
        responses: [
          { elementKey: 'neoadjuvant_therapy', value: 'not_given' },
          { elementKey: 'operative_procedure', value: 'sigmoidectomy' },
          { elementKey: 'tumor_site', value: 'sigmoid_colon' },
          { elementKey: 'tumor_max_dimension_mm', value: 45 },
          { elementKey: 'tumor_perforation', value: 'not_identified' },
          {
            elementKey: 'histological_tumor_type',
            value: 'adenocarcinoma_nos',
          },
          { elementKey: 'histological_tumor_grade', value: 'low_grade' },
          { elementKey: 'extent_of_invasion_pt', value: 'pT3' },
          { elementKey: 'lymphovascular_invasion', value: 'not_identified' },
          { elementKey: 'perineural_invasion', value: 'not_identified' },
          { elementKey: 'lymph_node_status', value: 'pN0' },
          { elementKey: 'tumor_deposits', value: 'not_identified' },
          { elementKey: 'margin_status', value: 'not_involved' },
          { elementKey: 'distant_metastasis_pm', value: 'not_applicable' },
          { elementKey: 'pathological_stage', value: 'Stage IIA' },
        ],
      })
      .expect(201);
    const body = responseRes.body as {
      results: { elementKey: string; observationId: string }[];
    };
    const grade = body.results.find(
      (r) => r.elementKey === 'histological_tumor_grade',
    );
    if (!grade) {
      throw new Error(
        `expected a histological_tumor_grade result, got ${JSON.stringify(body)}`,
      );
    }
    return grade.observationId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.register(fastifyMultipart);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    [tokenA, noRoleToken] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken('test-user-3', 'test-password-3'),
    ]);

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC #1: a gross or microscopic image can be attached to a block and is stored in object storage, not inline in Postgres', async () => {
    const { blockId } = await createCaseWithBlock();

    const res = await request(app.getHttpServer())
      .post(`/v1/images/block/${blockId}?category=microscopic`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('fake jpeg bytes'), {
        filename: 'slide.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const body = res.body as {
      id: string;
      resourceType: string;
      resourceId: string;
      category: string;
      objectKey: string;
      sizeBytes: number;
    };
    expect(body.resourceType).toBe('block');
    expect(body.resourceId).toBe(blockId);
    expect(body.category).toBe('microscopic');
    expect(body.sizeBytes).toBe(Buffer.from('fake jpeg bytes').byteLength);

    // Not inline in Postgres -- the row's own schema has no bytea/blob
    // column at all (packages/db/src/schema/image-attachment.ts), only
    // `objectKey`; the real bytes genuinely exist in MinIO, confirmed
    // directly against the bucket, not just trusted from the upload call's
    // own return value.
    const [row] = await db
      .select()
      .from(imageAttachment)
      .where(eq(imageAttachment.id, body.id));
    expect(row.objectKey).toBe(body.objectKey);
    expect(await objectExists(body.objectKey)).toBe(true);

    // GET returns a presigned URL that actually resolves the same bytes.
    const getRes = await request(app.getHttpServer())
      .get(`/v1/images/${body.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const { downloadUrl } = getRes.body as { downloadUrl: string };
    const fetched = await fetch(downloadUrl);
    expect(await fetched.text()).toBe('fake jpeg bytes');
  });

  it('rejects an upload for an unknown block id (400)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/images/block/${randomUUID()}?category=gross`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('x'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
  });

  it('denies a caller with no manage_specimens-granting role (403) on upload', async () => {
    const { blockId } = await createCaseWithBlock();
    await request(app.getHttpServer())
      .post(`/v1/images/block/${blockId}?category=gross`)
      .set('Authorization', `Bearer ${noRoleToken}`)
      .attach('file', Buffer.from('x'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      })
      .expect(403);
  });

  it('AC #2: an annotation with coordinate metadata can be attached to an image and linked to a specific synoptic finding', async () => {
    const { caseId, blockId } = await createCaseWithBlock();
    const observationId = await recordARealSynopticFinding(caseId);

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/images/block/${blockId}?category=microscopic`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('fake jpeg bytes'), {
        filename: 'slide.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const imageId = (uploadRes.body as { id: string }).id;

    const annotateRes = await request(app.getHttpServer())
      .post(`/v1/images/${imageId}/annotations`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        coordinates: { x: 0.25, y: 0.3, width: 0.15, height: 0.1 },
        observationId,
        label: 'invasive front',
      })
      .expect(201);
    const annotation = annotateRes.body as {
      id: string;
      coordinates: { x: number; y: number; width: number; height: number };
      observationId: string;
      label: string;
    };
    expect(annotation.coordinates).toEqual({
      x: 0.25,
      y: 0.3,
      width: 0.15,
      height: 0.1,
    });
    expect(annotation.observationId).toBe(observationId);
    expect(annotation.label).toBe('invasive front');

    const listRes = await request(app.getHttpServer())
      .get(`/v1/images/${imageId}/annotations`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const { annotations } = listRes.body as {
      annotations: { id: string; observationId: string | null }[];
    };
    expect(annotations).toHaveLength(1);
    expect(annotations[0].observationId).toBe(observationId);
  });

  it('an annotation with no finding link is allowed (observationId optional)', async () => {
    const { blockId } = await createCaseWithBlock();
    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/images/block/${blockId}?category=gross`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('x'), {
        filename: 'gross.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const imageId = (uploadRes.body as { id: string }).id;

    const res = await request(app.getHttpServer())
      .post(`/v1/images/${imageId}/annotations`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ coordinates: { x: 0, y: 0, width: 1, height: 1 } })
      .expect(201);
    const body = res.body as { observationId: string | null };
    expect(body.observationId).toBeNull();
  });

  it('rejects an annotation referencing an unknown observation id (400)', async () => {
    const { blockId } = await createCaseWithBlock();
    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/images/block/${blockId}?category=gross`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('x'), {
        filename: 'gross.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    const imageId = (uploadRes.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/v1/images/${imageId}/annotations`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        coordinates: { x: 0, y: 0, width: 1, height: 1 },
        observationId: randomUUID(),
      })
      .expect(400);
  });

  it('returns 404 for an unknown image id', async () => {
    await request(app.getHttpServer())
      .get(`/v1/images/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);
  });
});
