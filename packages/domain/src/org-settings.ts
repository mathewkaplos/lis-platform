import { z } from "zod";

/**
 * Issue #692 (`preferredSynopticSourceStandard`): an org-wide default
 * reporting standard preference (e.g. 'CAP', 'ICCR'), read by the synoptic
 * recording page (apps/web) to auto-resolve its own #690 "Choose reporting
 * standard" picker when a preference is set and exactly one eligible
 * protocol matches it. Free text, not an enum -- matches
 * `synopticProtocolSchema.sourceStandard`'s own existing unconstrained-text
 * convention (never enum-constrained in this schema). `null` means "no
 * preference" -- the #690 picker keeps showing, unchanged.
 *
 * Issue #706: extended with real organization profile fields (name,
 * address, phone, email, logo, currency) -- previously only `name` existed,
 * set once at signup and never editable. `currency` is free text (ISO 4217
 * code), same "never enum-constrain this class of field" convention as
 * `preferredSynopticSourceStandard` itself -- the web form's own `<select>`
 * of common codes is the UI-level constraint, not a schema-level one.
 */
export const orgSettingsSchema = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  logoUrl: z.string().nullable(),
  currency: z.string().nullable(),
  preferredSynopticSourceStandard: z.string().nullable(),
  // Pilot-readiness audit follow-up: per-tenant report-email sender.
  // `smtpUser`/`smtpFrom` are plain email addresses, not secrets -- safe to
  // read back exactly like every other field here. The app password itself
  // is NEVER returned, encrypted or otherwise (packages/db/src/
  // secret-encryption.ts's own ciphertext never leaves the DB) --
  // `smtpConfigured` is the only signal the client gets that one is on
  // file, the same "write-only credential, boolean status only" shape a
  // real password-change form uses.
  smtpUser: z.string().nullable(),
  smtpFrom: z.string().nullable(),
  smtpConfigured: z.boolean(),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const orgSettingsUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  preferredSynopticSourceStandard: z.string().nullable().optional(),
  smtpUser: z.string().nullable().optional(),
  smtpFrom: z.string().nullable().optional(),
  // Plaintext on the way IN only -- the server encrypts before storage
  // (org-settings.controller.ts's own update()). Omitted key: leave the
  // currently-stored app password (if any) unchanged. Explicit `null`:
  // clear it. A non-empty string: replace it. Never round-tripped back out
  // via orgSettingsSchema -- this field only ever appears in the request.
  smtpAppPassword: z.string().nullable().optional(),
});
export type OrgSettingsUpdate = z.infer<typeof orgSettingsUpdateSchema>;
