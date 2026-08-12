import { describe, expect, it, beforeAll } from 'vitest';
import {
  computeCaseReportContentHash,
  signCaseReportContent,
  verifyCaseReportSignature,
} from '@lis/db';

describe('computeCaseReportContentHash', () => {
  it('is deterministic for identical content', () => {
    const content = { case: { id: '1' }, parts: [], synopticResponses: [] };
    expect(computeCaseReportContentHash(content)).toBe(
      computeCaseReportContentHash(content),
    );
  });

  it('is order-independent for object key order (stableStringify)', () => {
    const a = {
      case: { id: '1', accessionNumber: 'C1' },
      parts: [],
      synopticResponses: [],
    };
    const b = {
      synopticResponses: [],
      parts: [],
      case: { accessionNumber: 'C1', id: '1' },
    };
    expect(computeCaseReportContentHash(a)).toBe(
      computeCaseReportContentHash(b),
    );
  });

  it('differs for different content', () => {
    const a = { case: { id: '1' }, parts: [], synopticResponses: [] };
    const b = { case: { id: '2' }, parts: [], synopticResponses: [] };
    expect(computeCaseReportContentHash(a)).not.toBe(
      computeCaseReportContentHash(b),
    );
  });
});

describe('signCaseReportContent / verifyCaseReportSignature', () => {
  beforeAll(() => {
    process.env.SIGNING_SECRET = 'a'.repeat(32);
  });

  const base = {
    caseId: 'case-1',
    contentHash: 'hash-1',
    actorPrincipalId: 'user-1',
    authTimeUsed: 1_700_000_000,
  };

  it('is deterministic for identical input', () => {
    expect(signCaseReportContent(base)).toEqual(signCaseReportContent(base));
  });

  it('changes when authTimeUsed changes — the signature is bound to the exact fresh step-up assertion, not just the content', () => {
    const other = { ...base, authTimeUsed: base.authTimeUsed + 1 };
    expect(signCaseReportContent(base)).not.toEqual(
      signCaseReportContent(other),
    );
  });

  it('changes when the actor changes', () => {
    const other = { ...base, actorPrincipalId: 'user-2' };
    expect(signCaseReportContent(base)).not.toEqual(
      signCaseReportContent(other),
    );
  });

  it('verifies a genuine signature', () => {
    const signature = signCaseReportContent(base);
    expect(verifyCaseReportSignature(base, signature)).toBe(true);
  });

  it('rejects a tampered content hash against an unrelated signature', () => {
    const signature = signCaseReportContent(base);
    const tampered = { ...base, contentHash: 'tampered-hash' };
    expect(verifyCaseReportSignature(tampered, signature)).toBe(false);
  });

  it('throws if SIGNING_SECRET is unset', () => {
    const original = process.env.SIGNING_SECRET;
    delete process.env.SIGNING_SECRET;
    expect(() => signCaseReportContent(base)).toThrow(
      'SIGNING_SECRET is not set',
    );
    process.env.SIGNING_SECRET = original;
  });

  it('throws if SIGNING_SECRET is too short', () => {
    const original = process.env.SIGNING_SECRET;
    process.env.SIGNING_SECRET = 'too-short';
    expect(() => signCaseReportContent(base)).toThrow(/at least 32 bytes/);
    process.env.SIGNING_SECRET = original;
  });
});
