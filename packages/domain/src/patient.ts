import { z } from "zod";

/**
 * KB-02 Patient aggregate, TASK-039 scope (docs/plans/feat-011-patient-management.md,
 * ADR-0013): single source of truth for both request validation (nestjs-zod's
 * ZodValidationPipe) and OpenAPI generation — never a parallel, hand-maintained
 * schema. Mirrors packages/db/src/schema/patient.ts's KB-02-minimal core exactly;
 * `mrn` is deliberately absent from the create schema (server-generated, TASK-039
 * proposal §10 Q1).
 */
export const patientSexSchema = z.enum(["M", "F", "U"]);
export type PatientSex = z.infer<typeof patientSexSchema>;

export const patientCreateSchema = z.object({
  nationalId: z.string().min(1).optional(),
  firstName: z.string().min(1),
  middleName: z.string().min(1).optional(),
  lastName: z.string().min(1),
  sex: patientSexSchema,
  birthDate: z.iso.date().optional(),
  // FEAT-066 (ADR-0053, docs/plans/feat-066-patient-contact-referring-facility.md):
  // real design-partner field set, blended into the KB-02-minimal core.
  phone: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  nextOfKinName: z.string().min(1).optional(),
  nextOfKinPhone: z.string().min(1).optional(),
});
export type PatientCreateInput = z.infer<typeof patientCreateSchema>;

/**
 * `PUT /v1/patients/:id` body (issue #747, docs/plans/task-747-patient-
 * demographic-editing.md). Every field optional (an omitted key leaves the
 * existing value untouched, matching org-settings.controller.ts's own
 * `!== undefined` partial-update convention) — `mrn`/`tenantId` are
 * deliberately absent (system-issued at registration, not editable). Unlike
 * `patientCreateSchema`, the nullable-in-the-DB fields here also accept an
 * explicit `null` so a caller can clear a previously-set value, not just
 * replace it.
 */
export const patientUpdateSchema = z.object({
  firstName: z.string().min(1).optional(),
  middleName: z.string().min(1).nullable().optional(),
  lastName: z.string().min(1).optional(),
  sex: patientSexSchema.optional(),
  birthDate: z.iso.date().nullable().optional(),
  nationalId: z.string().min(1).nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  email: z.string().min(1).nullable().optional(),
  address: z.string().min(1).nullable().optional(),
  nextOfKinName: z.string().min(1).nullable().optional(),
  nextOfKinPhone: z.string().min(1).nullable().optional(),
});
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;

export const patientSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  mrn: z.string(),
  nationalId: z.string().nullable(),
  firstName: z.string(),
  middleName: z.string().nullable(),
  lastName: z.string(),
  sex: patientSexSchema,
  birthDate: z.iso.date().nullable(),
  // FEAT-065 (ADR-0052, docs/plans/feat-065-patient-merge.md). Set only on
  // a merged-away (loser) row -- null for every ordinary/surviving patient.
  mergedInto: z.uuid().nullable(),
  // FEAT-066 (ADR-0053): see patientCreateSchema's own comment above.
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  nextOfKinName: z.string().nullable(),
  nextOfKinPhone: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Patient = z.infer<typeof patientSchema>;

/**
 * FEAT-065. `GET /v1/patients/:id`'s own response shape -- adds the
 * computed reverse lookup (`mergedFrom`: which patients were merged into
 * this one) on top of the plain DB-mirroring `patientSchema` every other
 * consumer reuses. Not a stored column, so it does not belong on
 * `patientSchema` itself (that file's own "mirrors the DB row 1:1"
 * convention).
 */
export const patientDetailSchema = z.object({
  ...patientSchema.shape,
  mergedFrom: z.array(z.uuid()),
});
export type PatientDetail = z.infer<typeof patientDetailSchema>;

/**
 * `POST /v1/patients/:id/merge` body -- `:id` is the surviving patient,
 * `loserPatientId` is merged into it. `reason` is required, matching
 * `caseAmendRequestSchema`'s own "required for a correction" convention
 * (FEAT-059).
 */
export const patientMergeRequestSchema = z.object({
  loserPatientId: z.uuid(),
  reason: z.string().min(1),
});
export type PatientMergeRequestInput = z.infer<typeof patientMergeRequestSchema>;

/**
 * Four mutually-exclusive lookup modes. mrn/nationalId are exact-match
 * (FEAT-011's own AC: "searchable by national ID and MRN"). firstName+
 * lastName+birthDate together is TASK-040's own duplicate-detection check (a
 * "possible match" review signal, not general search UX) — see
 * docs/plans/feat-011-patient-management.md's TASK-040 revision §10 Q1. `q`
 * is TASK-041's free-text search (name/MRN/national ID), added last — see
 * that revision's §2.
 */
export const patientSearchQuerySchema = z
  .object({
    mrn: z.string().min(1).optional(),
    nationalId: z.string().min(1).optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    birthDate: z.iso.date().optional(),
    q: z.string().min(1).optional(),
    // Issue #716 (EPIC #697): a fifth lookup mode -- "no search term, just
    // show the most recently registered patients" -- for the default
    // `/patients` view. Deliberately a distinct literal flag, not "q absent
    // means recent," so an absent-and-invalid query still fails loudly
    // (ADR-0013's own fail-closed precedent) rather than silently falling
    // back to a mode the caller never asked for.
    recent: z.literal("true").optional(),
  })
  .refine(
    (query) =>
      query.mrn !== undefined ||
      query.nationalId !== undefined ||
      query.q !== undefined ||
      query.recent !== undefined ||
      (query.firstName !== undefined &&
        query.lastName !== undefined &&
        query.birthDate !== undefined),
    {
      message:
        "mrn, nationalId, q, recent, or firstName+lastName+birthDate together is required",
    },
  );
export type PatientSearchQuery = z.infer<typeof patientSearchQuerySchema>;

/** TASK-041 §2/§5: no cursor pagination yet (ADR-0013 §Decision 4) — a fixed
 * cap on the free-text search instead, revisited once real volume needs one. */
export const PATIENT_SEARCH_RESULT_LIMIT = 50;

/** Issue #716: a much tighter cap than free-text search -- "recent
 * patients" is a glanceable default view, not a second full listing. */
export const PATIENT_RECENT_RESULT_LIMIT = 20;
