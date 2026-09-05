import { z } from "zod";

/**
 * FEAT-068 (EPIC-013, docs/plans/feat-068-specimen-processing-batch-qc.md).
 * Single source of truth for both request validation (nestjs-zod's
 * ZodValidationPipe) and OpenAPI generation. Mirrors
 * packages/db/src/schema/specimen-processing-qc.ts's actual columns/CHECK
 * constraints exactly — never a parallel, hand-maintained list.
 *
 * Each of the seven criteria below is the exact two-named-state judgment the
 * design partner's own real tracking sheet uses — a fixed, coded value set,
 * not a boolean or free text (domain/specimen-lifecycle Skill entry #5's own
 * precedent). Every enum's literal values must mirror the matching
 * `ck_specimen_processing_batch_*` CHECK constraint exactly, or a value this
 * schema accepts could still 500 at the database instead of 400ing here.
 */
export const tissueFixationSchema = z.enum(["adequate", "inadequate"]);
export type TissueFixation = z.infer<typeof tissueFixationSchema>;

export const processingQualitySchema = z.enum(["optimal", "suboptimal"]);
export type ProcessingQuality = z.infer<typeof processingQualitySchema>;

export const sectionThicknessSchema = z.enum(["acceptable", "unacceptable"]);
export type SectionThickness = z.infer<typeof sectionThicknessSchema>;

export const tissueFoldsTearsSchema = z.enum(["present", "absent"]);
export type TissueFoldsTears = z.infer<typeof tissueFoldsTearsSchema>;

export const stainingQualitySchema = z.enum(["acceptable", "unacceptable"]);
export type StainingQuality = z.infer<typeof stainingQualitySchema>;

export const coverslippingSchema = z.enum(["artefacts", "no_artefacts"]);
export type Coverslipping = z.infer<typeof coverslippingSchema>;

export const tissueOrientationSchema = z.enum(["satisfactory", "unsatisfactory"]);
export type TissueOrientation = z.infer<typeof tissueOrientationSchema>;

/**
 * One manifest row per accessioned Case this batch covers ("Lab No." /
 * "No. of Slides" / "Doctor's Remarks" on the real tracking sheet) — proposal
 * §5 item 1/2: `caseId` is `case.accessionNumber`'s own Case, not
 * `specimen.accessionNumber`.
 */
export const specimenProcessingBatchCaseInputSchema = z.object({
  caseId: z.uuid(),
  slideCount: z.number().int().min(1),
  pathologistRemarks: z.string().optional(),
});
export type SpecimenProcessingBatchCaseInput = z.infer<
  typeof specimenProcessingBatchCaseInputSchema
>;

export const specimenProcessingBatchCreateSchema = z.object({
  histoTechName: z.string().min(1),
  grossingDate: z.iso.datetime(),
  slidesForwardedDate: z.iso.datetime(),
  tissueFixation: tissueFixationSchema,
  processing: processingQualitySchema,
  sectionThickness: sectionThicknessSchema,
  tissueFoldsTears: tissueFoldsTearsSchema,
  stainingQuality: stainingQualitySchema,
  coverslipping: coverslippingSchema,
  tissueOrientation: tissueOrientationSchema,
  comments: z.string().optional(),
  correctiveAction: z.string().optional(),
  cases: z.array(specimenProcessingBatchCaseInputSchema).min(1),
});
export type SpecimenProcessingBatchCreateInput = z.infer<
  typeof specimenProcessingBatchCreateSchema
>;

export const specimenProcessingBatchCaseResultSchema =
  specimenProcessingBatchCaseInputSchema.extend({
    id: z.uuid(),
    // Populated on read (list()/getById()) the same way case.controller.ts's
    // own list() joins case -> order -> patient — never required, so
    // create()'s {resourceId, before, after} audited response (which doesn't
    // run through @ZodResponse) isn't forced to populate it.
    accessionNumber: z.string().optional(),
    patientFirstName: z.string().optional(),
    patientLastName: z.string().optional(),
  });
export type SpecimenProcessingBatchCaseResult = z.infer<
  typeof specimenProcessingBatchCaseResultSchema
>;

export const specimenProcessingBatchSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  grossingPathologistUserId: z.uuid(),
  histoTechName: z.string(),
  grossingDate: z.iso.datetime(),
  slidesForwardedDate: z.iso.datetime(),
  tissueFixation: tissueFixationSchema,
  processing: processingQualitySchema,
  sectionThickness: sectionThicknessSchema,
  tissueFoldsTears: tissueFoldsTearsSchema,
  stainingQuality: stainingQualitySchema,
  coverslipping: coverslippingSchema,
  tissueOrientation: tissueOrientationSchema,
  comments: z.string().nullable(),
  correctiveAction: z.string().nullable(),
  createdAt: z.iso.datetime(),
  cases: z.array(specimenProcessingBatchCaseResultSchema).optional(),
});
export type SpecimenProcessingBatch = z.infer<typeof specimenProcessingBatchSchema>;

export const specimenProcessingBatchListQuerySchema = z.object({
  createdFrom: z.iso.datetime().optional(),
  createdTo: z.iso.datetime().optional(),
});
export type SpecimenProcessingBatchListQuery = z.infer<
  typeof specimenProcessingBatchListQuerySchema
>;

/** Matches every other capped list route's own established convention
 * (engineering/api-design Skill entry #4). */
export const SPECIMEN_PROCESSING_BATCH_LIST_RESULT_LIMIT = 100;
