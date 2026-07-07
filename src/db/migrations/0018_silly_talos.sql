ALTER TABLE "carrier_users" ALTER COLUMN "carrier_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_users" ALTER COLUMN "profile" SET DEFAULT 'owner';--> statement-breakpoint
UPDATE "carrier_users" SET "profile" = 'owner' WHERE "profile" IS NULL OR "profile" NOT IN ('owner', 'driver');--> statement-breakpoint
ALTER TABLE "carrier_users" ALTER COLUMN "profile" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "carrier_users" ADD COLUMN "parent_user_id" text;--> statement-breakpoint
ALTER TABLE "carrier_users" ADD COLUMN "card_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_users_tenant_application_idx" ON "carrier_users" USING btree ("tenant_id","application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_users_tenant_parent_idx" ON "carrier_users" USING btree ("tenant_id","parent_user_id");