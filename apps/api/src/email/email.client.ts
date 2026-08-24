import nodemailer, { type Transporter } from 'nodemailer';

// Pilot-readiness audit follow-up (email delivery, deliberately deferred at
// #698 until now): the first email infrastructure in this repo. Gmail SMTP
// with an app password -- a real named account, not a transactional-email
// provider (SendGrid/SES/etc.) -- per explicit human decision, "for now."
// Same requiredEnv-style enforcement, read fresh per call (not memoized at
// module scope), object-storage.client.ts's own convention already
// establishes for exactly this reason: never risk a stale/placeholder value
// baked in by whatever bundling step a given call site goes through.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** Per-tenant email delivery follow-up: `credentials` overrides the
 * platform-wide `SMTP_USER`/`SMTP_APP_PASSWORD` env vars with a specific
 * tenant's own decrypted app password (`org-settings.controller.ts`'s
 * `getTenantSmtpConfig`) -- `host`/`port`/`secure` stay the fixed Gmail
 * config either way, matching this feature's "Gmail app password, for now"
 * scope; only the account being sent *from* is ever tenant-specific. */
function buildTransportOptions(credentials?: {
  user: string;
  appPassword: string;
}) {
  return {
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 465),
    // Port 465 is implicit TLS -- Gmail's own documented app-password
    // config, and the real default. `SMTP_SECURE=false` exists only so
    // case-report-email.e2e-spec.ts (and case-report-email.spec.ts's own
    // real MailHog instance) can point this at a local test double (plain
    // SMTP, no TLS listener) -- not a production-facing knob.
    secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
    auth: {
      user: credentials?.user ?? requiredEnv('SMTP_USER'),
      pass: credentials?.appPassword ?? requiredEnv('SMTP_APP_PASSWORD'),
    },
  };
}

// Memoizing the Transporter itself (not the env values it reads) is safe --
// same reasoning object-storage.client.ts's own getClient() already
// documents: it's stateless SMTP-connection configuration, not a long-lived
// open connection the way a DB client is (nodemailer opens/closes a
// connection per send by default). Only the platform-wide-config path is
// memoized -- a tenant-specific send always builds a fresh Transporter
// (cheap: this is just configuration, the real connection cost is per-send
// either way), since memoizing across different tenants' own credentials
// under one module-scope variable would leak one tenant's transport
// (silently sending under the wrong identity) into another's request.
let defaultTransporter: Transporter | undefined;

function getTransporter(credentials?: {
  user: string;
  appPassword: string;
}): Transporter {
  if (credentials) {
    return nodemailer.createTransport(buildTransportOptions(credentials));
  }
  if (!defaultTransporter) {
    defaultTransporter = nodemailer.createTransport(buildTransportOptions());
  }
  return defaultTransporter;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Per-tenant email delivery follow-up: send from this tenant's own
   * Gmail account instead of the platform-wide `SMTP_USER`/
   * `SMTP_APP_PASSWORD`/`SMTP_FROM` env config. Omitted (the default):
   * exactly the pre-per-tenant behavior, unchanged. */
  from?: { user: string; appPassword: string; displayFrom?: string | null };
}

/** Real SMTP send -- no dev-mode stub/no-op branch. A misconfigured
 * SMTP_USER/SMTP_APP_PASSWORD (or, for a tenant-specific send, a bad
 * decrypted app password) fails loudly (a thrown error the caller's own
 * route surfaces as a 500), matching this repo's own "no silent fallback on
 * a real external dependency" convention (object-storage.client.ts's own
 * requiredEnv has the identical shape). */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const credentials = input.from
    ? { user: input.from.user, appPassword: input.from.appPassword }
    : undefined;
  const fromAddress = input.from
    ? (input.from.displayFrom ?? input.from.user)
    : (process.env.SMTP_FROM ?? requiredEnv('SMTP_USER'));
  await getTransporter(credentials).sendMail({
    from: fromAddress,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: input.attachments,
  });
}
