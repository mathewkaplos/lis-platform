import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  wholeSlideImageSchema,
  wholeSlideImageTilePathQuerySchema,
  type WholeSlideImage,
  type WholeSlideImageStatus,
} from '@lis/domain';
import { slide, wholeSlideImage } from '@lis/db';
import { eq } from 'drizzle-orm';
// Side-effect only: @fastify/multipart's own ambient FastifyRequest.file()
// augmentation must be part of THIS file's own compilation unit -- same
// reasoning image-attachment.controller.ts's own identical import already
// documents (generate-openapi.ts's ts-node program never reaches main.ts).
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import { getPresignedDownloadUrl } from '../storage/object-storage.client';
import { unzipDziToObjectStorage } from './dzi-unzip.service';

const slideIdParamSchema = z.object({ slideId: z.uuid() });
class SlideIdParamDto extends createZodDto(slideIdParamSchema) {}

const idParamSchema = z.object({ id: z.uuid() });
class IdParamDto extends createZodDto(idParamSchema) {}

class WholeSlideImageDto extends createZodDto(wholeSlideImageSchema) {}
class TilePathQueryDto extends createZodDto(
  wholeSlideImageTilePathQuerySchema,
) {}

function toWholeSlideImageDto(
  row: typeof wholeSlideImage.$inferSelect,
): WholeSlideImage {
  return {
    ...row,
    status: row.status as WholeSlideImageStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * FEAT-067 (ADR-0055, docs/plans/feat-067-wsi-viewer.md). `manage_specimens`
 * gates the upload route, same reasoning `image-attachment.controller.ts`
 * already uses -- no dedicated imaging/pathologist role exists in Keycloak
 * yet. Reads (`getById`, the tile redirect) carry no capability gate,
 * matching `case.controller.ts`'s own read-route precedent.
 *
 * Not `@Audit()`'d -- same reasoning `image-attachment.controller.ts`'s own
 * upload route already gives (neither returns the `{resourceId, before,
 * after}` shape `AuditInterceptor` requires, and this isn't yet a
 * clinically-significant *action* the way a result verification or case
 * sign-out is).
 */
@Controller('v1/whole-slide-images')
export class WholeSlideImageController {
  @Post('slides/:slideId')
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: WholeSlideImageDto, status: 201 })
  async upload(
    @Param(new ZodValidationPipe(slideIdParamSchema))
    { slideId }: SlideIdParamDto,
    @Req() request: RequestWithGrantingRole & FastifyRequest,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<WholeSlideImage> {
    const [slideRow] = await tx
      .select({ id: slide.id })
      .from(slide)
      .where(eq(slide.id, slideId))
      .limit(1);
    if (!slideRow) {
      throw new BadRequestException(`Unknown slide id: ${slideId}`);
    }

    const file = await request.file();
    if (!file) {
      throw new BadRequestException('No file part in the multipart request');
    }

    const tenantId = request.authContext.tenantId;
    const tileObjectPrefix = `${tenantId}/wsi/${slideId}/${Date.now()}/`;

    const [row] = await tx
      .insert(wholeSlideImage)
      .values({
        tenantId,
        slideId,
        status: 'processing',
        tileObjectPrefix,
        uploadedByUserId: request.authContext.sub,
      })
      .returning();

    try {
      const { dziObjectKey } = await unzipDziToObjectStorage(
        file.file,
        tileObjectPrefix,
      );
      const [updated] = await tx
        .update(wholeSlideImage)
        .set({ status: 'ready', dziObjectKey })
        .where(eq(wholeSlideImage.id, row.id))
        .returning();
      return toWholeSlideImageDto(updated);
    } catch (err) {
      const [updated] = await tx
        .update(wholeSlideImage)
        .set({
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        })
        .where(eq(wholeSlideImage.id, row.id))
        .returning();
      return toWholeSlideImageDto(updated);
    }
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: WholeSlideImageDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<WholeSlideImage> {
    const [row] = await tx
      .select()
      .from(wholeSlideImage)
      .where(eq(wholeSlideImage.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Whole-slide image not found');
    }
    return toWholeSlideImageDto(row);
  }

  /**
   * A `?path=` query parameter, not a wildcard path segment (ADR-0055:
   * sidesteps `api-design` Skill entry #11's own cross-harness
   * routing-syntax risk entirely -- a query parameter needs no new NestJS/
   * Fastify route syntax at all). Redirects to a fresh, short-lived (60s)
   * presigned GET URL for the exact object requested -- never proxies tile
   * bytes through the API itself, extending ADR-0054's "reads never proxy
   * bytes" principle to a request shape (hundreds of small sequential
   * fetches per viewing session) FEAT-061 itself never had to handle.
   */
  @Get(':id/tiles')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @Redirect()
  async getTile(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Query(new ZodValidationPipe(wholeSlideImageTilePathQuerySchema))
    { path }: TilePathQueryDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<{ url: string; statusCode: number }> {
    const [row] = await tx
      .select({ tileObjectPrefix: wholeSlideImage.tileObjectPrefix })
      .from(wholeSlideImage)
      .where(eq(wholeSlideImage.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Whole-slide image not found');
    }
    const url = await getPresignedDownloadUrl(
      `${row.tileObjectPrefix}${path}`,
      60,
    );
    return { url, statusCode: 302 };
  }
}
