CREATE TYPE "public"."tenant_isolation_tier" AS ENUM('shared', 'dedicated_schema', 'dedicated_db');--> statement-breakpoint
-- RLS-exempt per ADR-0039 (tenant registry table -- cannot be scoped by the tenant_id it is the source of; see also ADR-0038)
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"isolation_tier" "tenant_isolation_tier" DEFAULT 'shared' NOT NULL,
	"schema_name" text,
	"connection_ref" text,
	"region" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
