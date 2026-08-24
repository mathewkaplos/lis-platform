ALTER TABLE "tenant" ADD COLUMN "smtp_user" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "smtp_app_password_encrypted" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "smtp_from" text;