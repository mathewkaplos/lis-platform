import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import fastifyMultipart from '@fastify/multipart';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { createDb, wholeSlideImage } from '@lis/db';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { AppModule } from './../src/app.module';
import { getKeycloakToken } from './get-keycloak-token';
import { objectExists } from '../src/storage/object-storage.client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B_TOKEN_USER = 'test-user-2';

const db = createDb(process.env.APP_DATABASE_URL, { max: 1 });

const FIXTURES_DIR = join(__dirname, 'fixtures');
const VALID_ZIP = readFileSync(join(FIXTURES_DIR, 'test-dzi.zip'));
const NO_DZI_ZIP = readFileSync(join(FIXTURES_DIR, 'no-dzi.zip'));
const TWO_DZI_ZIP = readFileSync(join(FIXTURES_DIR, 'two-dzi.zip'));

/**
 * FEAT-067 (ADR-0054, ADR-0055, docs/plans/feat-067-wsi-viewer.md). Proves
 * the proposal's own §7 acceptance criteria against a real MinIO instance,
 * real Postgres, real Keycloak tokens. Uses the real Fastify adapter, same
 * reasoning `image-attachment.e2e-spec.ts`'s own header comment already
 * establishes: `request.file()` only exists on Fastify requests
 * (`api-design` Skill entry #10's "every e2e spec defaults to Express"
 * gap) -- this route's core function structurally cannot run under Express.
 */
describe('Whole-slide images (e2e)', () => {
  let app: NestFastifyApplication;
  let tokenA: string; // test-user: technologist, tenant A -- manage_specimens
  let tokenB: string; // test-user-2: tenant B

  async function createSlide(token: string = tokenA): Promise<string> {
    const patientRes = await request(app.getHttpServer())
      .post('/v1/patients')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: 'Wsi', lastName: 'Fixture', sex: 'U' })
      .expect(201);
    const patientId = (patientRes.body as { resourceId: string }).resourceId;

    const catalogRes = await request(app.getHttpServer())
      .get('/v1/catalog')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const glu = (
      catalogRes.body as { tests: { id: string; code: string }[] }
    ).tests.find((t) => t.code === 'GLU');
    if (!glu) {
      throw new Error("expected db/seed/chemistry-catalog.sql fixture 'GLU'");
    }

    const orderRes = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId, testDefinitionIds: [glu.id] })
      .expect(201);
    const orderId = (orderRes.body as { resourceId: string }).resourceId;

    const caseRes = await request(app.getHttpServer())
      .post('/v1/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, parts: [{ specimenType: 'tissue' }] })
      .expect(201);
    const caseId = (caseRes.body as { resourceId: string }).resourceId;

    const lineage = await request(app.getHttpServer())
      .get(`/v1/cases/${caseId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const [part] = (lineage.body as { parts: { id: string }[] }).parts;

    const blockRes = await request(app.getHttpServer())
      .post(`/v1/cases/${caseId}/blocks`)
      .set('Authorization', `Bearer ${token}`)
      .send({ specimenId: part.id })
      .expect(201);
    const blockId = (blockRes.body as { resourceId: string }).resourceId;

    const slideRes = await request(app.getHttpServer())
      .post(`/v1/blocks/${blockId}/slides`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return (slideRes.body as { resourceId: string }).resourceId;
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

    [tokenA, tokenB] = await Promise.all([
      getKeycloakToken('test-user', 'test-password'),
      getKeycloakToken(TENANT_B_TOKEN_USER, 'test-password-2'),
    ]);

    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${TENANT_A}, false)`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('AC: a zipped pre-tiled DZI pyramid uploaded against a real Slide reaches status ready, every tile + the .dzi descriptor exist in object storage', async () => {
    const slideId = await createSlide();

    const res = await request(app.getHttpServer())
      .post(`/v1/whole-slide-images/slides/${slideId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', VALID_ZIP, {
        filename: 'test-dzi.zip',
        contentType: 'application/zip',
      })
      .expect(201);
    const body = res.body as {
      id: string;
      status: string;
      slideId: string;
      dziObjectKey: string | null;
      tileObjectPrefix: string;
    };
    expect(body.status).toBe('ready');
    expect(body.slideId).toBe(slideId);
    expect(body.dziObjectKey).toBe(`${body.tileObjectPrefix}fixture.dzi`);

    // Not just trusting the row's own status -- every real tile plus the
    // .dzi descriptor genuinely exist in the bucket.
    expect(await objectExists(`${body.tileObjectPrefix}fixture.dzi`)).toBe(
      true,
    );
    expect(
      await objectExists(`${body.tileObjectPrefix}fixture_files/0/0_0.jpeg`),
    ).toBe(true);
    expect(
      await objectExists(`${body.tileObjectPrefix}fixture_files/2/0_0.jpeg`),
    ).toBe(true);

    const [row] = await db
      .select()
      .from(wholeSlideImage)
      .where(eq(wholeSlideImage.id, body.id));
    expect(row.status).toBe('ready');
    expect(row.dziObjectKey).toBe(body.dziObjectKey);
  });

  it('AC: a malformed zip with no .dzi file reaches status failed with a real errorMessage', async () => {
    const slideId = await createSlide();

    const res = await request(app.getHttpServer())
      .post(`/v1/whole-slide-images/slides/${slideId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', NO_DZI_ZIP, {
        filename: 'no-dzi.zip',
        contentType: 'application/zip',
      })
      .expect(201);
    const body = res.body as { status: string; errorMessage: string | null };
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toMatch(/no \.dzi descriptor/i);
  });

  it('AC: a malformed zip with two .dzi files reaches status failed with a real errorMessage', async () => {
    const slideId = await createSlide();

    const res = await request(app.getHttpServer())
      .post(`/v1/whole-slide-images/slides/${slideId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', TWO_DZI_ZIP, {
        filename: 'two-dzi.zip',
        contentType: 'application/zip',
      })
      .expect(201);
    const body = res.body as { status: string; errorMessage: string | null };
    expect(body.status).toBe('failed');
    expect(body.errorMessage).toMatch(/expected exactly one \.dzi/i);
  });

  it('rejects an upload for an unknown slide id (400)', async () => {
    await request(app.getHttpServer())
      .post(`/v1/whole-slide-images/slides/${randomUUID()}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', VALID_ZIP, {
        filename: 'test-dzi.zip',
        contentType: 'application/zip',
      })
      .expect(400);
  });

  it('AC: the tile-redirect route resolves the exact uploaded bytes when followed, and is tenant-isolated', async () => {
    const slideId = await createSlide();

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/whole-slide-images/slides/${slideId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', VALID_ZIP, {
        filename: 'test-dzi.zip',
        contentType: 'application/zip',
      })
      .expect(201);
    const wsiId = (uploadRes.body as { id: string }).id;

    const tileRes = await request(app.getHttpServer())
      .get(`/v1/whole-slide-images/${wsiId}/tiles`)
      .query({ path: 'fixture_files/0/0_0.jpeg' })
      .set('Authorization', `Bearer ${tokenA}`)
      .redirects(0)
      .expect(302);
    const presignedUrl = tileRes.headers.location;
    const fetched = await fetch(presignedUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    const expectedBytes = readFileSync(join(FIXTURES_DIR, 'fixture-tile.jpeg'));
    expect(fetchedBytes.equals(expectedBytes)).toBe(true);

    // Tenant-isolated: a cross-tenant WSI id 404s (RLS makes it structurally
    // invisible, engineering/api-design entry #7), not just a wrong-tenant
    // 403 or a leaked "exists but forbidden" signal.
    await request(app.getHttpServer())
      .get(`/v1/whole-slide-images/${wsiId}/tiles`)
      .query({ path: 'fixture_files/0/0_0.jpeg' })
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('AC: GET /v1/cases/:id surfaces the ready WSI summary on the matching slide, null on a slide with none', async () => {
    const slideWithWsiId = await createSlide();
    const slideWithoutWsiId = await createSlide();

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/whole-slide-images/slides/${slideWithWsiId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', VALID_ZIP, {
        filename: 'test-dzi.zip',
        contentType: 'application/zip',
      })
      .expect(201);
    const wsiId = (uploadRes.body as { id: string }).id;

    // Both slides live on their own separate cases -- fetch each case and
    // check the matching slide's own wholeSlideImage summary.
    const casesRes = await request(app.getHttpServer())
      .get('/v1/cases')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    type LineageSlide = {
      id: string;
      wholeSlideImage: { id: string; status: string } | null;
    };
    type CaseSummary = { id: string };
    const caseIds = (casesRes.body as { items: CaseSummary[] }).items.map(
      (c) => c.id,
    );

    let foundWithWsi: LineageSlide | undefined;
    let foundWithoutWsi: LineageSlide | undefined;
    for (const caseId of caseIds) {
      const lineageRes = await request(app.getHttpServer())
        .get(`/v1/cases/${caseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const slides: LineageSlide[] = (
        lineageRes.body as {
          parts: { blocks: { slides: LineageSlide[] }[] }[];
        }
      ).parts.flatMap((p) => p.blocks.flatMap((b) => b.slides));
      foundWithWsi ??= slides.find((s) => s.id === slideWithWsiId);
      foundWithoutWsi ??= slides.find((s) => s.id === slideWithoutWsiId);
    }

    expect(foundWithWsi?.wholeSlideImage).toEqual({
      id: wsiId,
      status: 'ready',
    });
    expect(foundWithoutWsi?.wholeSlideImage).toBeNull();
  });
});
