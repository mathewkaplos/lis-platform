import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ImageAttachmentController } from './image-attachment.controller';
import { ensureBucketExists } from '../storage/object-storage.client';

/**
 * FEAT-061 (ADR-0052). Ensures the configured object-storage bucket exists
 * before any upload request can reach it -- self-hosted MinIO has no
 * out-of-band provisioning step (proposal §2's own
 * `object-storage.client.ts` header comment), so the app takes
 * responsibility for its own bucket existing at boot, same
 * `OnModuleInit`-provider shape `ReflexCommandRegistration`
 * (`reflex.module.ts`) already establishes for a different kind of
 * one-time startup registration.
 */
@Injectable()
class ObjectStorageBootstrap implements OnModuleInit {
  async onModuleInit() {
    await ensureBucketExists();
  }
}

@Module({
  controllers: [ImageAttachmentController],
  providers: [ObjectStorageBootstrap],
})
export class ImageAttachmentModule {}
