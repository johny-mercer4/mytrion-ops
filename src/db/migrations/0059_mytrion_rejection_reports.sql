-- Sales Mytrion → Data Center → Rejection Reports: our own record of every card decline.
--
-- Written at the moment the Zoho Desk Deluge automation creates the rejection ticket (it POSTs
-- /v1/rejection-reports/webhook right after `zoho.desk.create`), so a decline survives here even if
-- the Desk ticket is later edited, and the list can be scoped to ONE agent instead of being
-- re-derived from a lossy Desk recency scan on every read.
--
-- Ownership: a decline arrives with a carrier_id, not an agent. The webhook resolves the owning
-- Sales agent from the DWH carrier→agent mapping and stores BOTH the Zoho user id and the agent
-- NAME, because the two do not reliably agree — dim_company.agent_zoho_user_id is frequently unset
-- or carries a different org prefix than a worker's session id, and reads therefore have to match
-- id-or-name exactly the way dwhClientRoster's buildOwnedCte already does. Both stay nullable: an
-- unresolvable carrier is still recorded (owner_source='unresolved') rather than dropped.

CREATE TABLE IF NOT EXISTS "mytrion_rejection_reports" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  -- Zoho Desk ticket id from `zoho.desk.create` — the idempotency key for Deluge retries.
  "zoho_ticket_id" text,
  -- EFS decline code: 12 entry-mode, 17 PIN/unit, 18 item, 25 limit, 3 fraud, 787 balance.
  "error_code" text NOT NULL,
  "error_description" text,
  "carrier_id" text NOT NULL,
  "application_id" text,
  "company_name" text,
  -- Fleet card number as received. The Desk ticket already carries it verbatim (cf_card_number);
  -- it is never written to logs or audit detail, and card_last4 exists so the UI can display
  -- without reading the full value.
  "card_number" text,
  "card_last4" text,
  "driver_name" text,
  "driver_id" text,
  "unit_number" text,
  "location_name" text,
  "location_city" text,
  "location_state" text,
  "station_name" text,
  -- Branch flags the Deluge computed, kept so the SMS it chose stays explainable after the fact.
  "is_network" boolean DEFAULT false NOT NULL,
  "is_fraud" boolean DEFAULT false NOT NULL,
  "payment_type" text,
  "automated_response" text,
  "agent_zoho_user_id" text,
  "agent_name" text,
  -- 'dim_company' | 'zoho_deal' | 'unresolved'
  "owner_source" text DEFAULT 'unresolved' NOT NULL,
  -- 'new' | 'acknowledged' | 'resolved' — text, not an enum, so a new step needs no ALTER TYPE.
  "status" text DEFAULT 'new' NOT NULL,
  "handled_at" timestamp with time zone,
  "handled_by_zoho_user_id" text,
  -- When the decline happened at source, not when we stored it.
  "occurred_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The agent's own feed — the primary read.
CREATE INDEX IF NOT EXISTS "mytrion_rejection_reports_tenant_agent_idx"
  ON "mytrion_rejection_reports" ("tenant_id","agent_zoho_user_id","occurred_at");
--> statement-breakpoint
-- Name-keyed twin, for the id-mismatch fallback arm of the ownership match.
CREATE INDEX IF NOT EXISTS "mytrion_rejection_reports_tenant_agent_name_idx"
  ON "mytrion_rejection_reports" ("tenant_id","agent_name","occurred_at");
--> statement-breakpoint
-- A client's decline history (carrier drilldown).
CREATE INDEX IF NOT EXISTS "mytrion_rejection_reports_tenant_carrier_idx"
  ON "mytrion_rejection_reports" ("tenant_id","carrier_id","occurred_at");
--> statement-breakpoint
-- Triage by decline type across the book.
CREATE INDEX IF NOT EXISTS "mytrion_rejection_reports_tenant_error_idx"
  ON "mytrion_rejection_reports" ("tenant_id","error_code");
--> statement-breakpoint
-- Idempotent Deluge retries: at most one row per (tenant, ticket) when the id is present.
CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_rejection_reports_tenant_ticket_uk"
  ON "mytrion_rejection_reports" ("tenant_id","zoho_ticket_id")
  WHERE "zoho_ticket_id" IS NOT NULL;
