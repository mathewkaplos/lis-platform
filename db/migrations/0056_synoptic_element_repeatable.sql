-- Issue #666: repeating element groups (e.g. CAP Breast's multifocal
-- Tumor Characteristics, repeated up to 5x, keyed by "Tumor Identifier").
-- Additive, defaulted, no backfill.
ALTER TABLE "synoptic_element" ADD COLUMN "repeatable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "synoptic_element" ADD COLUMN "identity_element_key" text;--> statement-breakpoint
ALTER TABLE "synoptic_element" ADD CONSTRAINT "ck_synoptic_element_identity_requires_repeatable" CHECK ("synoptic_element"."identity_element_key" IS NULL OR "synoptic_element"."repeatable" = true);