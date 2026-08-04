ALTER TABLE "order" ALTER COLUMN "status" SET DEFAULT 'ordered';--> statement-breakpoint
ALTER TABLE "ordered_test" ALTER COLUMN "status" SET DEFAULT 'ordered';--> statement-breakpoint
ALTER TABLE "order" ADD COLUMN "priority" text DEFAULT 'routine' NOT NULL;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "ck_order_status" CHECK ("order"."status" IN ('ordered','cancelled'));--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "ck_order_priority" CHECK ("order"."priority" IN ('routine','stat'));--> statement-breakpoint
ALTER TABLE "ordered_test" ADD CONSTRAINT "ck_ordered_test_status" CHECK ("ordered_test"."status" IN ('ordered','collected','received','in_process','resulted','verified','reported','cancelled','rejected'));