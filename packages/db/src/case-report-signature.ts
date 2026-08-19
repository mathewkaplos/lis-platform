import { createHash, createHmac } from "node:crypto";
import { stableStringify } from "./audit";

const MIN_SECRET_BYTES = 32;

/**
 * FEAT-059 (proposal §5/§10 Q2). Server-held HMAC-SHA256, not per-user
 * asymmetric PKI — no user-held keypair exists anywhere in this system, and
 * this mirrors the audit trail's own already-accepted hash-chain security
 * model (KB-11: symmetric hashing, not PKI, is treated as sufficient
 * tamper-evidence) rather than a heavier, inconsistent crypto posture
 * invented only for this one feature.
 *
 * A function, not a module-scope constant — same reasoning as
 * apps/web/auth/secret.ts's getSessionSecret(): read fresh on every call
 * rather than risk a stale/placeholder value baked in by whatever bundling
 * step a given call site goes through.
 */
function getSigningSecret(): string {
  const value = process.env.SIGNING_SECRET;
  if (!value) {
    throw new Error("SIGNING_SECRET is not set");
  }
  if (Buffer.byteLength(value, "utf8") < MIN_SECRET_BYTES) {
    throw new Error(`SIGNING_SECRET must be at least ${MIN_SECRET_BYTES} bytes for HMAC-SHA256`);
  }
  return value;
}

export interface CaseReportContent {
  case: unknown;
  parts: unknown;
  synopticResponses: unknown;
  narrative: unknown; // issue #636: a real value snapshot, never a reference
}

/**
 * sha256 hex over the canonicalized (stableStringify) content — same
 * canonicalize-then-hash convention as audit.ts's own writeAuditEvent and
 * TASK-058's computeReportContentHash, reused rather than a third
 * independently-drifting copy.
 */
export function computeCaseReportContentHash(content: CaseReportContent): string {
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

export interface CaseReportSignatureInput {
  caseId: string;
  contentHash: string;
  actorPrincipalId: string;
  authTimeUsed: number; // epoch seconds, the auth_time claim value being bound
}

/**
 * The actual digital signature (ADR-0051): HMAC-SHA256 over a canonical
 * envelope binding the specific report-version's content hash to the actor
 * and the exact fresh step-up assertion (authTimeUsed) used to authorize it
 * — not just the content hash alone. Verifiable later by any caller holding
 * SIGNING_SECRET via verifyCaseReportSignature, same non-repudiation
 * property the audit hash chain already provides for the audit trail.
 */
export function signCaseReportContent(input: CaseReportSignatureInput): Buffer {
  const canonical = stableStringify({
    caseId: input.caseId,
    contentHash: input.contentHash,
    actorPrincipalId: input.actorPrincipalId,
    authTimeUsed: input.authTimeUsed,
  });
  return createHmac("sha256", getSigningSecret()).update(canonical).digest();
}

export function verifyCaseReportSignature(
  input: CaseReportSignatureInput,
  signature: Buffer,
): boolean {
  const expected = signCaseReportContent(input);
  return (
    expected.length === signature.length && expected.equals(signature)
  );
}
