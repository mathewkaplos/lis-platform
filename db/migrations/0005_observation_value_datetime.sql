ALTER TABLE "observation" DROP CONSTRAINT "ck_observation_datetime_value";--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "value_datetime" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "ck_observation_datetime_value" CHECK (("observation"."data_type" <> 'datetime') OR ("observation"."value_datetime" IS NOT NULL));