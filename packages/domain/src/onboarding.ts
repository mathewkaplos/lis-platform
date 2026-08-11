import { z } from "zod";

/**
 * FEAT-049 (docs/plans/feat-049-self-service-onboarding.md): single source
 * of truth for both `apps/api`'s `POST /onboarding/signup` request
 * validation and `apps/web`'s signup form's client-side field errors —
 * same "one schema, not a hand-maintained parallel copy" discipline
 * `patient.ts`'s own header comment establishes.
 */
export const signUpSchema = z.object({
  orgName: z.string().min(2).max(200),
  adminFirstName: z.string().min(1).max(100),
  adminLastName: z.string().min(1).max(100),
  adminEmail: z.email(),
  adminPassword: z.string().min(8).max(200),
});
export type SignUpInput = z.infer<typeof signUpSchema>;
