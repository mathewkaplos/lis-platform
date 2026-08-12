import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ImageAttachmentController } from './image-attachment.controller';
import { ensureBucketExists } from '../storage/object-storage.client';

const logger = new Logger('ObjectStorageBootstrap');

/**
 * FEAT-061 (ADR-0052). Ensures the configured object-storage bucket exists
 * before any upload request can reach it -- self-hosted MinIO has no
 * out-of-band provisioning step (proposal §2's own
 * `object-storage.client.ts` header comment), so the app takes
 * responsibility for its own bucket existing at boot, same
 * `OnModuleInit`-provider shape `ReflexCommandRegistration`
 * (`reflex.module.ts`) already establishes for a different kind of
 * one-time startup registration.
 *
 * A real, live incident, not a hypothetical: MinIO is deliberately not yet
 * wired into `infra/docker-compose.staging.yml` (issue #564 -- no memory
 * headroom on the current droplet), so `OBJECT_STORAGE_*` is unset on
 * staging. An unconditional `ensureBucketExists()` throws synchronously
 * during Nest bootstrap when those env vars are missing
 * (`object-storage.client.ts`'s own `requiredEnv()`), which would crash the
 * *entire* API process on every deploy -- not just make image upload
 * unavailable -- the exact same class of regression this repo's own
 * `critical-notification` Skill precedent already documents for a missing
 * `SCHEDULER_DATABASE_URL`. Caught before it could take staging down
 * (deploy-staging.yml's own `deploy` job was already mid-run when this was
 * found) by logging a warning and continuing instead of letting the app
 * fail to boot -- image upload itself still fails cleanly at actual
 * request time (`object-storage.client.ts`'s own `requiredEnv()` throws
 * there instead), isolated to that one feature rather than the whole API.
 */
@Injectable()
class ObjectStorageBootstrap implements OnModuleInit {
  async onModuleInit() {
    try {
      await ensureBucketExists();
    } catch (err) {
      logger.warn(
        `object storage is not configured/reachable -- image upload will fail at request time until this is fixed: ${(err as Error).message}`,
      );
    }
  }
}

@Module({
  controllers: [ImageAttachmentController],
  providers: [ObjectStorageBootstrap],
})
export class ImageAttachmentModule {}
