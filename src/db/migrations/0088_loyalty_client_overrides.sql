CREATE TABLE IF NOT EXISTS "loyalty_client_overrides" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "carrier_id" text NOT NULL,
  "company_name" text NOT NULL,
  "enterprise_mode" text,
  "enterprise_gold_target_gallons" numeric(14, 2),
  "enabled_reward_ids" jsonb,
  "note" text,
  "updated_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "loyalty_client_overrides_enterprise_mode_check"
    CHECK ("enterprise_mode" IS NULL OR "enterprise_mode" IN ('normal_billing', 'volume_target')),
  CONSTRAINT "loyalty_client_overrides_target_check"
    CHECK ("enterprise_gold_target_gallons" IS NULL OR "enterprise_gold_target_gallons" > 0),
  CONSTRAINT "loyalty_client_overrides_rewards_check"
    CHECK (
      "enabled_reward_ids" IS NULL
      OR jsonb_typeof("enabled_reward_ids") = 'array'
    )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_client_overrides_tenant_carrier_uq"
  ON "loyalty_client_overrides" ("tenant_id", "carrier_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "loyalty_client_overrides_tenant_idx"
  ON "loyalty_client_overrides" ("tenant_id", "updated_at");
