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
});
export type PatientCreateInput = z.infer<typeof patientCreateSchema>;

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
  createdAt: z.iso.datetime(),
});
export type Patient = z.infer<typeof patientSchema>;

/**
 * Exact-match only, per FEAT-011's own AC ("searchable by national ID and MRN") —
 * free-text/name search is TASK-041's own future concern, not built ahead of it.
 * At least one of mrn/nationalId must be supplied.
 */
export const patientSearchQuerySchema = z
  .object({
    mrn: z.string().min(1).optional(),
    nationalId: z.string().min(1).optional(),
  })
  .refine((query) => query.mrn !== undefined || query.nationalId !== undefined, {
    message: "mrn or nationalId is required",
  });
export type PatientSearchQuery = z.infer<typeof patientSearchQuerySchema>;
