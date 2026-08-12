import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  deleteObject,
  ensureBucketExists,
  getPresignedDownloadUrl,
  objectExists,
  putObjectStream,
} from '../src/storage/object-storage.client';

/**
 * FEAT-061 (ADR-0052). Real MinIO round-trip -- no mocking of
 * `@aws-sdk/client-s3`/`@aws-sdk/lib-storage`, matching this repo's own
 * "verify for real" standard already established for Postgres/Keycloak.
 * Lives in `test/` (not `src/`) since it depends on the real local `minio`
 * container being up, the same class of dependency every other e2e spec in
 * this directory already has on Postgres/Keycloak.
 */
describe('Object storage client (e2e, real MinIO)', () => {
  const key = `e2e-test/${randomUUID()}.txt`;
  const content = 'hello from object-storage.e2e-spec.ts';

  beforeAll(async () => {
    await ensureBucketExists();
  });

  afterEach(async () => {
    await deleteObject(key).catch(() => undefined);
  });

  it('putObjectStream + objectExists: an uploaded object genuinely exists in the bucket', async () => {
    await putObjectStream(
      key,
      Readable.from([Buffer.from(content)]),
      'text/plain',
    );
    expect(await objectExists(key)).toBe(true);
  });

  it('objectExists returns false for a key that was never uploaded', async () => {
    expect(
      await objectExists(`e2e-test/${randomUUID()}-never-uploaded.txt`),
    ).toBe(false);
  });

  it('getPresignedDownloadUrl produces a URL that actually resolves the uploaded bytes when fetched directly', async () => {
    await putObjectStream(
      key,
      Readable.from([Buffer.from(content)]),
      'text/plain',
    );
    const url = await getPresignedDownloadUrl(key, 60);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(content);
  });

  it('deleteObject actually removes the object from the bucket', async () => {
    await putObjectStream(
      key,
      Readable.from([Buffer.from(content)]),
      'text/plain',
    );
    expect(await objectExists(key)).toBe(true);
    await deleteObject(key);
    expect(await objectExists(key)).toBe(false);
  });

  it('ensureBucketExists is idempotent -- calling it again on an already-existing bucket does not throw', async () => {
    await expect(ensureBucketExists()).resolves.not.toThrow();
  });
});
