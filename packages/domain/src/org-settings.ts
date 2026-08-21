import { z } from "zod";

/**
 * Issue #692: an org-wide default reporting standard preference (e.g. 'CAP',
 * 'ICCR'), read by the synoptic recording page (apps/web) to auto-resolve
 * its own #690 "Choose reporting standard" picker when a preference is set
 * and exactly one eligible protocol matches it. Free text, not an enum --
 * matches `synopticProtocolSchema.sourceStandard`'s own existing
 * unconstrained-text convention (never enum-constrained in this schema).
 * `null` means "no preference" -- the #690 picker keeps showing, unchanged.
 */
export const orgSettingsSchema = z.object({
  preferredSynopticSourceStandard: z.string().nullable(),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const orgSettingsUpdateSchema = z.object({
  preferredSynopticSourceStandard: z.string().nullable(),
});
export type OrgSettingsUpdate = z.infer<typeof orgSettingsUpdateSchema>;
