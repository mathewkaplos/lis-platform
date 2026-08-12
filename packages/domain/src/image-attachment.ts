import { z } from "zod";

/**
 * FEAT-061 (ADR-0052, docs/plans/feat-061-image-attachments-annotations.md):
 * single source of truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1) — mirrors
 * packages/db/src/schema/image-attachment.ts's actual columns/CHECK
 * constraints exactly.
 */

/** Mirrors `ck_image_attachment_resource_type` — the four resource types an
 * image can attach to (Case/Specimen/Block/Slide, KB-17). */
export const imageResourceTypeSchema = z.enum(["case", "specimen", "block", "slide"]);
export type ImageResourceType = z.infer<typeof imageResourceTypeSchema>;

/** Mirrors `ck_image_attachment_category` — KB-17's own two image
 * categories. */
export const imageCategorySchema = z.enum(["gross", "microscopic"]);
export type ImageCategory = z.infer<typeof imageCategorySchema>;

export const imageAttachmentSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  resourceType: imageResourceTypeSchema,
  resourceId: z.uuid(),
  category: imageCategorySchema,
  objectKey: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  uploadedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;

/** `GET /v1/images/:id` response — the row plus a short-lived presigned GET
 * URL (proposal §5: reads never proxy bytes through the API itself). */
export const imageAttachmentWithUrlSchema = z.object({
  ...imageAttachmentSchema.shape,
  downloadUrl: z.url(),
});
export type ImageAttachmentWithUrl = z.infer<typeof imageAttachmentWithUrlSchema>;

/** Normalized 0-1 fractions of the image's own width/height, not pixel
 * values (packages/db/src/schema/image-attachment.ts's own header
 * comment). */
export const imageAnnotationCoordinatesSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export type ImageAnnotationCoordinates = z.infer<typeof imageAnnotationCoordinatesSchema>;

/** `POST /v1/images/:id/annotations` body. `observationId` is the
 * "specific synoptic finding" an annotation ties back to (proposal §5/§10
 * Q3: the discrete per-response Observation FEAT-058's own
 * assembleAndPersistSynopticResponse writes) — optional, since a plain
 * gross-photo region marker may have no synoptic correlate yet. */
export const imageAnnotationCreateSchema = z.object({
  coordinates: imageAnnotationCoordinatesSchema,
  observationId: z.uuid().optional(),
  label: z.string().min(1).optional(),
});
export type ImageAnnotationCreateInput = z.infer<typeof imageAnnotationCreateSchema>;

export const imageAnnotationSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  imageAttachmentId: z.uuid(),
  coordinates: imageAnnotationCoordinatesSchema,
  observationId: z.uuid().nullable(),
  label: z.string().nullable(),
  annotatedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type ImageAnnotation = z.infer<typeof imageAnnotationSchema>;

export const imageAnnotationListSchema = z.object({
  annotations: z.array(imageAnnotationSchema),
});
export type ImageAnnotationList = z.infer<typeof imageAnnotationListSchema>;
