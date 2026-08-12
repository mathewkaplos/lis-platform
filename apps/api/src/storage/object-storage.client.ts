import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// FEAT-061 (ADR-0052). The first object-storage infrastructure in this
// repo -- self-hosted MinIO (S3-API-compatible), not a real cloud provider
// (proposal §5/§10 Q1: no external account this session can provision).
// Using the real @aws-sdk/client-s3 (not a MinIO-specific SDK) against
// MinIO's S3-compatible API means a future move to real cloud S3/GCS is a
// config change, not a rewrite.
//
// requiredEnv-style enforcement, read fresh per call (not memoized at
// module scope) -- same convention apps/web/auth/secret.ts and
// packages/db/src/case-report-signature.ts already established, for the
// same reason: never risk a stale/placeholder value baked in by whatever
// bundling step a given call site goes through.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getBucket(): string {
  return requiredEnv('OBJECT_STORAGE_BUCKET');
}

// Memoizing the S3Client instance itself (not the env values it reads) is
// safe -- the client is stateless HTTP-request-signing configuration, not a
// long-lived open connection/pool the way a DB client is.
let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: requiredEnv('OBJECT_STORAGE_ENDPOINT'),
      region: 'us-east-1', // MinIO ignores region; required by the SDK regardless
      // MinIO (and most self-hosted S3-compatible stores) serves buckets as
      // path segments (http://host:port/bucket/key), not the AWS-default
      // virtual-hosted-style subdomain (http://bucket.host:port/key) --
      // required for a self-hosted single-host deployment with no per-bucket
      // DNS.
      forcePathStyle: true,
      credentials: {
        accessKeyId: requiredEnv('OBJECT_STORAGE_ACCESS_KEY'),
        secretAccessKey: requiredEnv('OBJECT_STORAGE_SECRET_KEY'),
      },
    });
  }
  return client;
}

/**
 * Streams `body` to object storage under `key`. Uses `@aws-sdk/lib-storage`'s
 * `Upload` (not a bare `PutObjectCommand`) because a `@fastify/multipart`
 * file part is a Node `Readable` of unknown total length -- `PutObjectCommand`
 * requires a known `ContentLength` for a stream body; `Upload` chunks it into
 * a real S3 multipart upload instead, which needs no upfront length.
 */
export async function putObjectStream(
  key: string,
  body: Readable,
  contentType: string,
): Promise<void> {
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  });
  await upload.done();
}

/** Confirms an object genuinely exists (not just that the upload call
 * returned successfully) -- used by tests to prove bytes actually landed in
 * the bucket, not just that the client wrapper claims they did. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({ Bucket: getBucket(), Key: key }),
    );
    return true;
  } catch {
    return false;
  }
}

/** A short-lived, signed GET URL -- reads never proxy bytes through the API
 * itself, keeping large binary transfer off its own request path even
 * though writes are a direct multipart upload (proposal §5). */
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

/**
 * Creates the configured bucket if it doesn't already exist. Called once at
 * module init (`ImageAttachmentModule`) -- self-hosted MinIO has no
 * out-of-band provisioning step (unlike a real cloud account where a bucket
 * would typically be created via Terraform/console ahead of time), so the
 * app takes responsibility for its own bucket existing, the same way
 * `db-reset.sh` takes responsibility for the database schema existing.
 * Idempotent: a `BucketAlreadyOwnedByYou` (or already-exists) error from a
 * concurrent second caller is swallowed, not treated as a failure.
 */
export async function ensureBucketExists(): Promise<void> {
  const bucket = getBucket();
  const client = getClient();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return; // already exists
  } catch {
    // Fall through to create -- HeadBucket 404s (or any error) when the
    // bucket is genuinely missing, which is the expected first-run case.
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    // Idempotent under concurrent startup (e.g. multiple API replicas) --
    // a real "already exists" race is not a failure.
    const code = (err as { name?: string })?.name;
    if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') {
      throw err;
    }
  }
}
