CREATE TABLE "whole_slide_image" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slide_id" uuid NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"tile_object_prefix" text NOT NULL,
	"dzi_object_key" text,
	"error_message" text,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_whole_slide_image_status" CHECK ("whole_slide_image"."status" IN ('processing','ready','failed'))
);
--> statement-breakpoint
ALTER TABLE "whole_slide_image" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whole_slide_image" ADD CONSTRAINT "whole_slide_image_slide_id_slide_id_fk" FOREIGN KEY ("slide_id") REFERENCES "public"."slide"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_whole_slide_image_tenant_slide" ON "whole_slide_image" USING btree ("tenant_id","slide_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whole_slide_image" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);