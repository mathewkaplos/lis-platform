import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  imageAnnotationCreateSchema,
  imageAnnotationListSchema,
  imageAttachmentSchema,
  imageAttachmentWithUrlSchema,
  imageCategorySchema,
  imageResourceTypeSchema,
  type ImageAnnotation,
  type ImageAnnotationCreateInput,
  type ImageAnnotationList,
  type ImageAttachment,
  type ImageAttachmentWithUrl,
  type ImageCategory,
  type ImageResourceType,
} from '@lis/domain';
import {
  block,
  caseTable,
  imageAnnotation,
  imageAttachment,
  observation,
  slide,
  specimen,
} from '@lis/db';
import { desc, eq, sql } from 'drizzle-orm';
// Side-effect only: @fastify/multipart's own `declare module 'fastify' {
// interface FastifyRequest { file: ... } }` ambient augmentation must be
// part of THIS file's own compilation unit, not just main.ts's -- found for
// real, not hypothetical: `tsc --noEmit -p .` (whole-project) picks up the
// augmentation transitively via main.ts either way, but
// `generate-openapi.ts`'s own ts-node invocation builds a program rooted at
// its own entry point and never reaches main.ts, so without this explicit
// import `request.file()` below fails to typecheck only in that one script.
import '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { createZodDto, ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';
import type { RequestWithGrantingRole } from '../auth/capability.guard';
import { CapabilityGuard } from '../auth/capability.guard';
import { DbTx } from '../auth/db-tx.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireCapability } from '../auth/require-capability.decorator';
import type { RequestWithTx } from '../auth/tenant-context.interceptor';
import { TenantContextInterceptor } from '../auth/tenant-context.interceptor';
import {
  getPresignedDownloadUrl,
  putObjectStream,
} from '../storage/object-storage.client';

const resourceParamSchema = z.object({
  resourceType: imageResourceTypeSchema,
  resourceId: z.uuid(),
});
class ResourceParamDto extends createZodDto(resourceParamSchema) {}

const uploadQuerySchema = z.object({ category: imageCategorySchema });
class UploadQueryDto extends createZodDto(uploadQuerySchema) {}

const idParamSchema = z.object({ id: z.uuid() });
class IdParamDto extends createZodDto(idParamSchema) {}

class ImageAttachmentDto extends createZodDto(imageAttachmentSchema) {}
class ImageAttachmentWithUrlDto extends createZodDto(
  imageAttachmentWithUrlSchema,
) {}
class ImageAnnotationCreateDto extends createZodDto(
  imageAnnotationCreateSchema,
) {}
class ImageAnnotationListDto extends createZodDto(imageAnnotationListSchema) {}

function toImageAttachmentDto(
  row: typeof imageAttachment.$inferSelect,
): ImageAttachment {
  return {
    ...row,
    resourceType: row.resourceType as ImageResourceType,
    category: row.category as ImageCategory,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * FEAT-061 (ADR-0052, docs/plans/feat-061-image-attachments-annotations.md).
 * `/v1/images` -- data model + upload/download/annotation API only, no
 * WSI viewer (issue #549, deferred).
 *
 * `manage_specimens` gates every mutation here, same reasoning
 * `case.controller.ts`/`synoptic-protocol.controller.ts` already use -- no
 * dedicated imaging/pathologist role exists in Keycloak yet.
 *
 * Direct multipart upload through the API, not presigned browser-direct
 * URLs (proposal §5/§10 Q2) -- `POST` streams straight to object storage
 * via `putObjectStream` (`@aws-sdk/lib-storage`'s `Upload`, handles a Node
 * `Readable` of unknown length). `GET /v1/images/:id` returns a short-lived
 * presigned GET URL instead of proxying bytes through the API (keeps large
 * binary transfer off the API's own request path on the read side even
 * though writes don't get that benefit).
 *
 * No `@Audit()`/`AuditInterceptor` on the upload/annotate routes -- neither
 * returns the `{resourceId, before, after}` shape that interceptor requires
 * (api-design Skill entry #15), and an image/annotation create is not yet a
 * clinically-significant *action* the same way a result verification or
 * case sign-out is (api-design Skill entry #6's own "only mutating,
 * clinically/operationally significant actions are audited" scoping) --
 * revisit if a future feature needs a full audit trail for image
 * provenance specifically.
 */
@Controller('v1/images')
export class ImageAttachmentController {
  /**
   * Confirms `resourceId` resolves to a real, tenant-visible row of
   * `resourceType` before accepting an upload -- mirrors
   * `case.controller.ts`'s own "look the parent up first, 400/404 if not
   * found" shape rather than trusting a caller-supplied id blindly.
   */
  private async resourceExists(
    tx: RequestWithTx['tx'],
    resourceType: ImageResourceType,
    resourceId: string,
  ): Promise<boolean> {
    const table = { case: caseTable, specimen, block, slide }[resourceType];
    const [row] = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, resourceId))
      .limit(1);
    return !!row;
  }

  @Post(':resourceType/:resourceId')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: ImageAttachmentDto, status: 201 })
  async upload(
    @Param(new ZodValidationPipe(resourceParamSchema))
    { resourceType, resourceId }: ResourceParamDto,
    @Query(new ZodValidationPipe(uploadQuerySchema))
    { category }: UploadQueryDto,
    @Req() request: RequestWithGrantingRole & FastifyRequest,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<ImageAttachment> {
    if (!(await this.resourceExists(tx, resourceType, resourceId))) {
      throw new BadRequestException(
        `Unknown ${resourceType} id: ${resourceId}`,
      );
    }

    const file = await request.file();
    if (!file) {
      throw new BadRequestException('No file part in the multipart request');
    }

    const objectKey = `${request.authContext.tenantId}/${resourceType}/${resourceId}/${Date.now()}-${file.filename}`;
    // Buffered, not streamed directly from file.file -- simpler (sizeBytes
    // falls out of buffer.byteLength for free) and sufficient for gross/
    // microscopic photos (proposal §5: not WSI-scale, no size cap in this
    // v1 scope). putObjectStream itself still supports true streaming
    // (Readable.from here is a thin wrapper, not a redesign) for a future
    // caller that needs it.
    const buffer = await file.toBuffer();
    await putObjectStream(objectKey, Readable.from(buffer), file.mimetype);

    const [row] = await tx
      .insert(imageAttachment)
      .values({
        tenantId: request.authContext.tenantId,
        resourceType,
        resourceId,
        category,
        objectKey,
        contentType: file.mimetype,
        sizeBytes: buffer.byteLength,
        uploadedByUserId: request.authContext.sub,
      })
      .returning();

    return toImageAttachmentDto(row);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: ImageAttachmentWithUrlDto, status: 200 })
  async getById(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<ImageAttachmentWithUrl> {
    const [row] = await tx
      .select()
      .from(imageAttachment)
      .where(eq(imageAttachment.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException('Image not found');
    }
    const downloadUrl = await getPresignedDownloadUrl(row.objectKey);
    return { ...toImageAttachmentDto(row), downloadUrl };
  }

  @Post(':id/annotations')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, CapabilityGuard)
  @RequireCapability('manage_specimens')
  @UseInterceptors(TenantContextInterceptor)
  async annotate(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @Body(new ZodValidationPipe(imageAnnotationCreateSchema))
    body: ImageAnnotationCreateDto,
    @Req() request: RequestWithGrantingRole,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<ImageAnnotation> {
    const [imageRow] = await tx
      .select({ id: imageAttachment.id })
      .from(imageAttachment)
      .where(eq(imageAttachment.id, id))
      .limit(1);
    if (!imageRow) {
      throw new NotFoundException('Image not found');
    }

    if (body.observationId) {
      const [obsRow] = await tx
        .select({ id: observation.id })
        .from(observation)
        .where(eq(observation.id, body.observationId))
        .limit(1);
      if (!obsRow) {
        throw new BadRequestException(
          `Unknown observation id: ${body.observationId}`,
        );
      }
    }

    // Composite FK into observation(id, created_at) -- server-side subquery
    // (returns NULL when observationId itself is NULL, keeping both columns
    // consistently null-together), never a JS-parsed Date (database-design
    // Skill entry #10's own documented precision-mismatch trap).
    const [row] = await tx
      .insert(imageAnnotation)
      .values({
        tenantId: request.authContext.tenantId,
        imageAttachmentId: id,
        coordinates: body.coordinates,
        observationId: body.observationId ?? null,
        observationCreatedAt: body.observationId
          ? sql`(SELECT created_at FROM observation WHERE id = ${body.observationId})`
          : null,
        label: body.label ?? null,
        annotatedByUserId: request.authContext.sub,
      })
      .returning();

    return {
      ...row,
      coordinates: row.coordinates as ImageAnnotationCreateInput['coordinates'],
      createdAt: row.createdAt.toISOString(),
    };
  }

  @Get(':id/annotations')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(TenantContextInterceptor)
  @ZodResponse({ type: ImageAnnotationListDto, status: 200 })
  async listAnnotations(
    @Param(new ZodValidationPipe(idParamSchema)) { id }: IdParamDto,
    @DbTx() tx: RequestWithTx['tx'],
  ): Promise<ImageAnnotationList> {
    const rows = await tx
      .select()
      .from(imageAnnotation)
      .where(eq(imageAnnotation.imageAttachmentId, id))
      .orderBy(desc(imageAnnotation.createdAt));
    return {
      annotations: rows.map((row) => ({
        ...row,
        coordinates: row.coordinates as ImageAnnotation['coordinates'],
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
