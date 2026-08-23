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

// Memoizing the Transporter itself (not the env values it reads) is safe --
// same reasoning object-storage.client.ts's own getClient() already
// documents: it's stateless SMTP-connection configuration, not a long-lived
// open connection the way a DB client is (nodemailer opens/closes a
// connection per send by default).
let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 465),
      // Port 465 is implicit TLS -- Gmail's own documented app-password
      // config, and the real default. `SMTP_SECURE=false` exists only so
      // case-report-email.e2e-spec.ts can point this at a real local
      // `smtp-server` test double (plain SMTP, no TLS listener) -- not a
      // production-facing knob.
      secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
      auth: {
        user: requiredEnv('SMTP_USER'),
        pass: requiredEnv('SMTP_APP_PASSWORD'),
      },
    });
  }
  return transporter;
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
}

/** Real SMTP send -- no dev-mode stub/no-op branch. A misconfigured
 * SMTP_USER/SMTP_APP_PASSWORD fails loudly (a thrown error the caller's own
 * route surfaces as a 500), matching this repo's own "no silent fallback on
 * a real external dependency" convention (object-storage.client.ts's own
 * requiredEnv has the identical shape). */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM ?? requiredEnv('SMTP_USER'),
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: input.attachments,
  });
}
