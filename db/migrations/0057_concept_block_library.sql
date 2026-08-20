CREATE TABLE "concept_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_block_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "concept_block_element" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_block_version_id" uuid NOT NULL,
	"parent_element_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"data_type" text NOT NULL,
	"requirement" text NOT NULL,
	"analyte_id" uuid NOT NULL,
	"unit_id" uuid,
	"visibility_condition" jsonb,
	"display_order" integer DEFAULT 0 NOT NULL,
	"repeatable" boolean DEFAULT false NOT NULL,
	"identity_element_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_concept_block_element_data_type" CHECK ("concept_block_element"."data_type" IN ('coded','quantity','text','coded_multi')),
	CONSTRAINT "ck_concept_block_element_requirement" CHECK ("concept_block_element"."requirement" IN ('required','recommended','conditional')),
	CONSTRAINT "ck_concept_block_element_identity_requires_repeatable" CHECK ("concept_block_element"."identity_element_key" IS NULL OR "concept_block_element"."repeatable" = true)
);
--> statement-breakpoint
CREATE TABLE "concept_block_element_response_option" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_block_element_id" uuid NOT NULL,
	"code" text NOT NULL,
	"display" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concept_block_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"concept_block_id" uuid NOT NULL,
	"source_standard" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_concept_block_version_status" CHECK ("concept_block_version"."status" IN ('draft','in_review','published','archived'))
);
--> statement-breakpoint
ALTER TABLE "concept_block_element" ADD CONSTRAINT "concept_block_element_concept_block_version_id_concept_block_version_id_fk" FOREIGN KEY ("concept_block_version_id") REFERENCES "public"."concept_block_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_block_element" ADD CONSTRAINT "concept_block_element_parent_element_id_concept_block_element_id_fk" FOREIGN KEY ("parent_element_id") REFERENCES "public"."concept_block_element"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_block_element" ADD CONSTRAINT "concept_block_element_analyte_id_analyte_id_fk" FOREIGN KEY ("analyte_id") REFERENCES "public"."analyte"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_block_element" ADD CONSTRAINT "concept_block_element_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_block_element_response_option" ADD CONSTRAINT "concept_block_element_response_option_concept_block_element_id_concept_block_element_id_fk" FOREIGN KEY ("concept_block_element_id") REFERENCES "public"."concept_block_element"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_block_version" ADD CONSTRAINT "concept_block_version_concept_block_id_concept_block_id_fk" FOREIGN KEY ("concept_block_id") REFERENCES "public"."concept_block"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_concept_block_element_version_key" ON "concept_block_element" USING btree ("concept_block_version_id","key");--> statement-breakpoint
CREATE INDEX "ix_concept_block_element_parent" ON "concept_block_element" USING btree ("parent_element_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_concept_block_element_response_option_element_value" ON "concept_block_element_response_option" USING btree ("concept_block_element_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_concept_block_version_block_standard_published" ON "concept_block_version" USING btree ("concept_block_id","source_standard") WHERE "concept_block_version"."status" = 'published';