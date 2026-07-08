ALTER TABLE "carrier_invitations" ADD COLUMN "company_type" text;--> statement-breakpoint
ALTER TABLE "carrier_invitations" ADD COLUMN "card_count" integer;--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN "company_type" text;--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN "card_count" integer;