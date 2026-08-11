CREATE TABLE "antimicrobial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_system_value_id" uuid NOT NULL,
	"display" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "antimicrobial_code_system_value_id_unique" UNIQUE("code_system_value_id")
);
--> statement-breakpoint
CREATE TABLE "breakpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"breakpoint_table_id" uuid NOT NULL,
	"organism_id" uuid NOT NULL,
	"antimicrobial_id" uuid NOT NULL,
	"method" text NOT NULL,
	"susceptible_max" numeric NOT NULL,
	"resistant_min" numeric NOT NULL,
	"source_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breakpoint_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publisher" text NOT NULL,
	"version" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organism" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_system_value_id" uuid NOT NULL,
	"display" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organism_code_system_value_id_unique" UNIQUE("code_system_value_id")
);
--> statement-breakpoint
ALTER TABLE "antimicrobial" ADD CONSTRAINT "antimicrobial_code_system_value_id_code_system_value_id_fk" FOREIGN KEY ("code_system_value_id") REFERENCES "public"."code_system_value"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakpoint" ADD CONSTRAINT "breakpoint_breakpoint_table_id_breakpoint_table_id_fk" FOREIGN KEY ("breakpoint_table_id") REFERENCES "public"."breakpoint_table"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakpoint" ADD CONSTRAINT "breakpoint_organism_id_organism_id_fk" FOREIGN KEY ("organism_id") REFERENCES "public"."organism"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakpoint" ADD CONSTRAINT "breakpoint_antimicrobial_id_antimicrobial_id_fk" FOREIGN KEY ("antimicrobial_id") REFERENCES "public"."antimicrobial"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organism" ADD CONSTRAINT "organism_code_system_value_id_code_system_value_id_fk" FOREIGN KEY ("code_system_value_id") REFERENCES "public"."code_system_value"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_breakpoint_organism_antimicrobial" ON "breakpoint" USING btree ("organism_id","antimicrobial_id");--> statement-breakpoint
CREATE INDEX "ix_breakpoint_table" ON "breakpoint" USING btree ("breakpoint_table_id");