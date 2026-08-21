-- Issue #692: org-wide default reporting standard preference (e.g. 'CAP',
-- 'ICCR') for the #690 synoptic-protocol disambiguation picker -- see
-- packages/db/src/schema/tenant.ts's own column comment for the full
-- explanation. Nullable, no default -- 'no preference' is the correct
-- default for every existing tenant.
ALTER TABLE "tenant" ADD COLUMN "preferred_synoptic_source_standard" text;
