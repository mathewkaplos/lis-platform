CREATE TABLE "specimen_processing_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"grossing_pathologist_user_id" uuid NOT NULL,
	"histo_tech_name" text NOT NULL,
	"grossing_date" timestamp with time zone NOT NULL,
	"slides_forwarded_date" timestamp with time zone NOT NULL,
	"tissue_fixation" text NOT NULL,
	"processing" text NOT NULL,
	"section_thickness" text NOT NULL,
	"tissue_folds_tears" text NOT NULL,
	"staining_quality" text NOT NULL,
	"coverslipping" text NOT NULL,
	"tissue_orientation" text NOT NULL,
	"comments" text,
	"corrective_action" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_specimen_processing_batch_tissue_fixation" CHECK ("specimen_processing_batch"."tissue_fixation" IN ('adequate','inadequate')),
	CONSTRAINT "ck_specimen_processing_batch_processing" CHECK ("specimen_processing_batch"."processing" IN ('optimal','suboptimal')),
	CONSTRAINT "ck_specimen_processing_batch_section_thickness" CHECK ("specimen_processing_batch"."section_thickness" IN ('acceptable','unacceptable')),
	CONSTRAINT "ck_specimen_processing_batch_tissue_folds_tears" CHECK ("specimen_processing_batch"."tissue_folds_tears" IN ('present','absent')),
	CONSTRAINT "ck_specimen_processing_batch_staining_quality" CHECK ("specimen_processing_batch"."staining_quality" IN ('acceptable','unacceptable')),
	CONSTRAINT "ck_specimen_processing_batch_coverslipping" CHECK ("specimen_processing_batch"."coverslipping" IN ('artefacts','no_artefacts')),
	CONSTRAINT "ck_specimen_processing_batch_tissue_orientation" CHECK ("specimen_processing_batch"."tissue_orientation" IN ('satisfactory','unsatisfactory'))
);
--> statement-breakpoint
ALTER TABLE "specimen_processing_batch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "specimen_processing_batch_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"slide_count" integer NOT NULL,
	"pathologist_remarks" text
);
--> statement-breakpoint
ALTER TABLE "specimen_processing_batch_case" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "specimen_processing_batch_case" ADD CONSTRAINT "specimen_processing_batch_case_batch_id_specimen_processing_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."specimen_processing_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specimen_processing_batch_case" ADD CONSTRAINT "specimen_processing_batch_case_case_id_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_specimen_processing_batch_tenant_created" ON "specimen_processing_batch" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_specimen_processing_batch_case_batch_case" ON "specimen_processing_batch_case" USING btree ("batch_id","case_id");--> statement-breakpoint
CREATE INDEX "ix_specimen_processing_batch_case_batch" ON "specimen_processing_batch_case" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "ix_specimen_processing_batch_case_case" ON "specimen_processing_batch_case" USING btree ("case_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "specimen_processing_batch" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "specimen_processing_batch_case" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);