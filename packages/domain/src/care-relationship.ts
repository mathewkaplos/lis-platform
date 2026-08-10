import { z } from "zod";

/**
 * FEAT-038: `POST /v1/patients/:patientId/care-relationships` request body —
 * a lab-staff user assigns a clinician (raw Keycloak `sub`, real subs are
 * UUID-shaped, same convention `care_relationship.clinicianUserId` already
 * uses) to a patient. The one new mechanism this task adds so a
 * `care_relationship` row can come to exist outside a direct DB insert
 * (proposal §10 Q1).
 */
export const careRelationshipCreateSchema = z.object({
  clinicianUserId: z.uuid(),
});
export type CareRelationshipCreateInput = z.infer<
  typeof careRelationshipCreateSchema
>;

export const careRelationshipSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  clinicianUserId: z.uuid(),
  patientId: z.uuid(),
  createdAt: z.string(),
});
export type CareRelationship = z.infer<typeof careRelationshipSchema>;
