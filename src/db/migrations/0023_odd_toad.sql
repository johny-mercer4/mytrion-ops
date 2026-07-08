ALTER TABLE "carrier_invitations" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN "profile" text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "registered_mini_app_companies" ADD COLUMN "card_id" text;