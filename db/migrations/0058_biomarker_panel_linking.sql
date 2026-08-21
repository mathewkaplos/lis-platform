CREATE TABLE "synoptic_protocol_linked_panel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organ_protocol_id" uuid NOT NULL,
	"panel_protocol_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "synoptic_protocol" ADD COLUMN "is_panel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "synoptic_protocol_linked_panel" ADD CONSTRAINT "synoptic_protocol_linked_panel_organ_protocol_id_synoptic_protocol_id_fk" FOREIGN KEY ("organ_protocol_id") REFERENCES "public"."synoptic_protocol"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synoptic_protocol_linked_panel" ADD CONSTRAINT "synoptic_protocol_linked_panel_panel_protocol_id_synoptic_protocol_id_fk" FOREIGN KEY ("panel_protocol_id") REFERENCES "public"."synoptic_protocol"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ux_synoptic_protocol_linked_panel_organ_panel" ON "synoptic_protocol_linked_panel" USING btree ("organ_protocol_id","panel_protocol_id");