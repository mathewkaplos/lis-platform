# Implementation Proposal: Single source of truth for case-status derived sets (issue #672)
Status: APPROVED
ADR: none    Date: 2026-08-21    Backlog ID: issue #672

## 1. Goal

`case.status`'s 5-value enum is independently re-derived in four places:
`STATUS_TABS`/`STATUS_VARIANT` (case-list page) and
`SCREENABLE_STATUSES`/`NOT_YET_SIGNED_STATUSES`/`AMENDABLE_STATUSES`
(case-detail page). A future status addition needs all four updated by
hand. One confirmed side effect of the overlap: a verifier viewing a
`pending_review` case sees both the *Sign out* and *Return to screening*
cards at once.

## 2. Resolving the co-rendering question (issue's own required decision)

**Accepted as intended, not a bug.** Per #671's own derivation of the real
transition graph directly from `case.controller.ts`: `pending_review` is
the *only* status a two-tier-review case can ever be finalized from, and
`finalize()` succeeds from `pending_review` for every case type. A
verifier reviewing a `pending_review` case genuinely has two legitimate
next actions -- sign it out, or send it back for correction -- so showing
both cards simultaneously is correct UX, not overlap to eliminate.
Documented explicitly in the consolidated module so this reads as a
decision, not an oversight.

## 3. Design

One shared module, `apps/web/app/(app)/cases/case-status.ts`, reusing
`@lis/domain`'s existing `CaseStatus` type (not a re-invented literal
list):

```ts
import type { CaseStatus } from '@lis/domain';

export const SCREENABLE_STATUSES: ReadonlySet<CaseStatus> = new Set(['accessioned', 'in_process']);
export const NOT_YET_SIGNED_STATUSES: ReadonlySet<CaseStatus> = new Set(['accessioned', 'in_process', 'pending_review']);
export const AMENDABLE_STATUSES: ReadonlySet<CaseStatus> = new Set(['signed_out', 'amended']);

export const STATUS_VARIANT: Record<CaseStatus, 'outline' | 'secondary' | 'destructive'> = { ... };

export const STATUS_TABS = [ ... ] as const;
```

Names kept as-is (no rename churn beyond relocating them) -- the issue
asks for one source of truth, not a renaming pass. Each of the four call
sites (`cases-table.tsx`, `cases/page.tsx`, `cases/[caseId]/page.tsx`)
imports from this module instead of declaring its own copy.

## 4. Acceptance criteria (from the issue, restated)

- Case-status-derived sets defined once, consumed by all four current
  call sites.
- The Sign-out/Return-to-screening co-rendering question is resolved and
  reflected in code (§2 -- accepted as intended, documented).

## 5. Out of scope

- Any backend/schema change (frontend-only, per the issue's own
  exclusion).

## 6. Testing

Frontend-only, no new backend behavior -- `pnpm --filter web typecheck`
+ `pnpm --filter web lint`, plus a manual/browser check of the case-list
tabs, badges, and case-detail action cards for a case in each status
(effort permitting given this session's known browser-tooling
flakiness).

## 7. Questions requiring human approval

None -- the one open question the issue itself flags (§2) is resolved
here with a concrete, derived rationale.
