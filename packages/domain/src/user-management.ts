import { z } from "zod";

/**
 * Issue #703 (EPIC #697): the assignable human staff roles -- deliberately
 * excludes `clinician`/`patient` (external, portal-only, provisioned
 * through their own distinct flows -- FEAT-038/FEAT-039, not this screen)
 * and every machine role (`gateway-ingest`/`interop-ingest`/
 * `platform-analytics`, never assigned to a human). Shared between the API
 * (validates the create/role-change body against this exact set) and
 * `apps/web`'s role picker, so the two can never drift.
 */
export const ASSIGNABLE_STAFF_ROLES = [
  "reception",
  "technologist",
  "pathologist",
  "qa",
  "cashier",
  "lab_admin",
] as const;
export const assignableStaffRoleSchema = z.enum(ASSIGNABLE_STAFF_ROLES);
export type AssignableStaffRole = z.infer<typeof assignableStaffRoleSchema>;

export const userSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  enabled: z.boolean(),
  roles: z.array(z.string()),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userListResponseSchema = z.object({
  items: z.array(userSummarySchema),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const createUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: assignableStaffRoleSchema,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserRoleSchema = z.object({
  role: assignableStaffRoleSchema,
});
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

export const updateUserEnabledSchema = z.object({
  enabled: z.boolean(),
});
export type UpdateUserEnabledInput = z.infer<typeof updateUserEnabledSchema>;
