import { z } from "zod";

/**
 * FEAT-066 (docs/plans/feat-066-patient-contact-referring-facility.md,
 * ADR-0053): single source of truth for `apps/api`'s referring-facility
 * routes and `apps/web`'s admin list/create form. Mirrors
 * packages/db/src/schema/referring-facility.ts's row shape 1:1, same
 * discipline patient.ts's own header comment establishes.
 */
export const referringFacilityCreateSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});
export type ReferringFacilityCreateInput = z.infer<typeof referringFacilityCreateSchema>;

export const referringFacilitySchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReferringFacility = z.infer<typeof referringFacilitySchema>;
