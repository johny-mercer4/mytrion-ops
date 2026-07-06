ALTER TABLE "audit_log" ADD COLUMN "user_name" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "profile" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "caller_role" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "impersonator_user_id" text;