CREATE TABLE "image_annotation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"image_attachment_id" uuid NOT NULL,
	"coordinates" jsonb NOT NULL,
	"observation_id" uuid,
	"observation_created_at" timestamp with time zone,
	"label" text,
	"annotated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_annotation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "image_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"category" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_image_attachment_resource_type" CHECK ("image_attachment"."resource_type" IN ('case','specimen','block','slide')),
	CONSTRAINT "ck_image_attachment_category" CHECK ("image_attachment"."category" IN ('gross','microscopic'))
);
--> statement-breakpoint
ALTER TABLE "image_attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "image_annotation" ADD CONSTRAINT "image_annotation_image_attachment_id_image_attachment_id_fk" FOREIGN KEY ("image_attachment_id") REFERENCES "public"."image_attachment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_annotation" ADD CONSTRAINT "image_annotation_observation_id_created_at_fk" FOREIGN KEY ("observation_id","observation_created_at") REFERENCES "public"."observation"("id","created_at") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_image_annotation_tenant_image" ON "image_annotation" USING btree ("tenant_id","image_attachment_id");--> statement-breakpoint
CREATE INDEX "ix_image_annotation_observation" ON "image_annotation" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "ix_image_attachment_tenant_resource" ON "image_attachment" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "image_annotation" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "image_attachment" AS PERMISSIVE FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::uuid);