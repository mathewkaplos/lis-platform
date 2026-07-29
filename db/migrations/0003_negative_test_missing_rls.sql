-- DELIBERATE NEGATIVE TEST — proves the Constitution gate blocks a real
-- violation of Law #4 (structural RLS). Tracked in #132 / ADR-0004's
-- acceptance criteria. This table is intentionally tenant-scoped with NO
-- RLS policy, and this file is removed before the real migration merges.
CREATE TABLE "specimen_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
