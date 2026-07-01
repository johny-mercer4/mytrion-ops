ALTER TABLE "money_code_requests" DROP CONSTRAINT "money_code_requests_carrier_id_invoice_id_key";--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "money_code_requests" ADD COLUMN "void_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "money_code_requests_active_carrier_invoice_uniq" ON "money_code_requests" USING btree ("carrier_id","invoice_id") WHERE "money_code_requests"."status" <> 'VOIDED';