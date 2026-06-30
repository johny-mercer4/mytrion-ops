CREATE TABLE IF NOT EXISTS "money_code_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"carrier_id" bigint NOT NULL,
	"invoice_id" bigint NOT NULL,
	"invoice_amount" numeric(14, 2),
	"limit_pct" numeric(6, 2),
	"money_code_amount" numeric(14, 2),
	"billing_type" text,
	"valid_until" date,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"efs_money_code" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "money_code_requests_carrier_id_invoice_id_key" UNIQUE("carrier_id","invoice_id")
);
