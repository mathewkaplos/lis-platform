import type { CaseStatus } from '@lis/domain';

/**
 * Issue #672. Single source of truth for `case.status`'s derived sets --
 * previously independently re-declared in `cases-table.tsx`, `cases/page.tsx`,
 * and `cases/[caseId]/page.tsx` (four separate literal lists over the same
 * 5-value enum, `@lis/domain`'s own `CaseStatus`).
 *
 * The Sign-out and Return-to-screening cards both render for a
 * `pending_review` case (`NOT_YET_SIGNED_STATUSES` and the literal
 * `'pending_review'` check in `[caseId]/page.tsx` overlap there) --
 * confirmed intentional, not a bug: `pending_review` is the only status a
 * two-tier-review case can ever be finalized from (#671's own derivation
 * of the real transition graph directly from `case.controller.ts`), and a
 * verifier reviewing a `pending_review` case genuinely has two legitimate
 * next actions -- sign it out, or send it back for correction. Showing
 * both is correct UX, left unchanged.
 */
export const SCREENABLE_STATUSES: ReadonlySet<CaseStatus> = new Set([
  'accessioned',
  'in_process',
]);

// issue #621: exactly the complement of AMENDABLE_STATUSES over the
// 5-value enum -- a case is never in both sets at once.
export const NOT_YET_SIGNED_STATUSES: ReadonlySet<CaseStatus> = new Set([
  'accessioned',
  'in_process',
  'pending_review',
]);

export const AMENDABLE_STATUSES: ReadonlySet<CaseStatus> = new Set([
  'signed_out',
  'amended',
]);

export const STATUS_VARIANT: Record<CaseStatus, 'outline' | 'secondary' | 'destructive'> = {
  accessioned: 'outline',
  in_process: 'outline',
  pending_review: 'secondary',
  signed_out: 'secondary',
  amended: 'secondary',
};

// issue #613 (BUG-CYTO-01): `GET /v1/cases` excludes `signed_out`/`amended`
// cases by default, and accepts a single `status` value to see any one
// status -- no "all" sentinel. `key: undefined` reproduces today's default
// (omit `status` entirely, not an empty string).
export const STATUS_TABS = [
  { key: undefined, label: 'Active' },
  { key: 'pending_review', label: 'Pending Review' },
  { key: 'signed_out', label: 'Signed Out' },
  { key: 'amended', label: 'Amended' },
] as const;
