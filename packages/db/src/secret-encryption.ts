import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Pilot-readiness audit follow-up (per-tenant email delivery): the first
// encryption-at-rest infrastructure in this repo. AES-256-GCM (authenticated
// encryption, not a plain cipher -- a tampered ciphertext fails to decrypt
// rather than silently producing garbage), the standard modern choice for
// symmetric secret-at-rest encryption. Used today only for
// tenant.smtp_app_password_encrypted (a real Gmail app password), but named
// generically -- this is the one place any future "store a real credential"
// need in this codebase should reuse, not reinvent.
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM's own recommended IV length

/**
 * Same requiredEnv-per-call convention every other secret in this repo uses
 * (object-storage.client.ts, case-report-signature.ts's getSigningSecret,
 * apps/web/auth/secret.ts) -- read fresh, never memoized, so a stale/
 * placeholder value baked in by whatever bundling step a given call site
 * goes through is never risked.
 */
function getEncryptionKey(): Buffer {
  const value = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!value) {
    throw new Error("SETTINGS_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(value, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SETTINGS_ENCRYPTION_KEY must be a ${KEY_BYTES}-byte key, hex-encoded (${KEY_BYTES * 2} hex characters) -- got ${key.length} bytes`,
    );
  }
  return key;
}

/** iv:authTag:ciphertext, each base64 -- a fresh random IV per call (GCM's
 * own hard requirement: reusing an IV with the same key breaks its
 * authentication guarantee entirely, not just weakens it). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Throws (never returns a garbage string) if the ciphertext or its auth
 * tag was tampered with, or if it was encrypted under a different key --
 * GCM's own authentication check, not this function's own validation. */
export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("malformed encrypted secret: expected iv:authTag:ciphertext");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
