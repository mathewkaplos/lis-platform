ALTER TABLE "patient" ADD COLUMN "merged_into" uuid;--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_merged_into_patient_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."patient"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_patient_merged_into" ON "patient" USING btree ("merged_into");--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "ck_patient_merged_into_not_self" CHECK ("patient"."merged_into" IS NULL OR "patient"."merged_into" != "patient"."id");