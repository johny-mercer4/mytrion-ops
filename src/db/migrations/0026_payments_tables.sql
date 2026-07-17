CREATE TABLE IF NOT EXISTS "payment_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_module" text,
	"source_record_id" text NOT NULL,
	"carrier_id" text,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'USD',
	"occurred_at" timestamp with time zone,
	"name" text,
	"status" text,
	"txn_type" text,
	"external_txn_id" text,
	"sender_name" text,
	"memo" text,
	"description" text,
	"email" text,
	"card_brand" text,
	"card_last4" text,
	"customer_ref" text,
	"receipt_url" text,
	"is_invoice_mapped" boolean DEFAULT false NOT NULL,
	"mapping_type" text,
	"mapped_by" text,
	"mapped_at" timestamp with time zone,
	"cmp_ref" jsonb,
	"split_allocations" jsonb,
	"proposed_carrier_ids" text,
	"is_returned" boolean DEFAULT false NOT NULL,
	"returned_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_carrier_memory" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_name" text NOT NULL,
	"company_name_lc" text NOT NULL,
	"carrier_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_returns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_record_id" text NOT NULL,
	"return_type" text,
	"carrier_id" text,
	"customer_name" text,
	"reference_number" text,
	"last4" text,
	"amount" numeric(14, 2),
	"return_date" timestamp with time zone,
	"reason" text,
	"matched" boolean DEFAULT false NOT NULL,
	"original_transaction_id" bigint,
	"match_note" text,
	"matched_by" text,
	"matched_at" timestamp with time zone,
	"is_reversed" boolean DEFAULT false NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_source_record_uniq" ON "payment_transactions" USING btree ("source","source_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_occurred_idx" ON "payment_transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_carrier_idx" ON "payment_transactions" USING btree ("carrier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_mapped_idx" ON "payment_transactions" USING btree ("is_invoice_mapped","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_source_idx" ON "payment_transactions" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_transactions_returned_idx" ON "payment_transactions" USING btree ("is_returned") WHERE "is_returned";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_carrier_memory_company_carrier_uniq" ON "payment_carrier_memory" USING btree ("company_name_lc","carrier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_carrier_memory_company_idx" ON "payment_carrier_memory" USING btree ("company_name_lc");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_returns_source_record_uniq" ON "payment_returns" USING btree ("source","source_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_returns_matched_idx" ON "payment_returns" USING btree ("matched");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_returns_carrier_idx" ON "payment_returns" USING btree ("carrier_id");
