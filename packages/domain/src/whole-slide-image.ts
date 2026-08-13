import { z } from "zod";

/**
 * FEAT-067 (ADR-0055, docs/plans/feat-067-wsi-viewer.md): single source of
 * truth for both request validation and OpenAPI generation
 * (engineering/api-design Skill entry #1) — mirrors
 * packages/db/src/schema/whole-slide-image.ts's actual columns/CHECK
 * constraints exactly.
 */

/** Mirrors `ck_whole_slide_image_status`. */
export const wholeSlideImageStatusSchema = z.enum(["processing", "ready", "failed"]);
export type WholeSlideImageStatus = z.infer<typeof wholeSlideImageStatusSchema>;

export const wholeSlideImageSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  slideId: z.uuid(),
  status: wholeSlideImageStatusSchema,
  tileObjectPrefix: z.string(),
  dziObjectKey: z.string().nullable(),
  errorMessage: z.string().nullable(),
  uploadedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type WholeSlideImage = z.infer<typeof wholeSlideImageSchema>;

/** `GET /v1/whole-slide-images/:id/tiles` query -- the relative path (within
 * this WSI's own tileObjectPrefix) of the object being requested, e.g. the
 * .dzi descriptor itself or one tile (`image_files/8/3_2.jpeg`). A query
 * parameter, not a wildcard path segment (ADR-0055: sidesteps
 * engineering/api-design Skill entry #11's own cross-harness routing-syntax
 * risk entirely). */
export const wholeSlideImageTilePathQuerySchema = z.object({
  path: z.string().min(1),
});
export type WholeSlideImageTilePathQuery = z.infer<typeof wholeSlideImageTilePathQuerySchema>;

/** The per-slide summary `GET /v1/cases/:id`'s lineage response embeds --
 * just enough for the case detail page to know whether to show a "View
 * whole-slide image" link or an upload form, without a second round trip. */
export const wholeSlideImageSummarySchema = z.object({
  id: z.uuid(),
  status: wholeSlideImageStatusSchema,
});
export type WholeSlideImageSummary = z.infer<typeof wholeSlideImageSummarySchema>;
