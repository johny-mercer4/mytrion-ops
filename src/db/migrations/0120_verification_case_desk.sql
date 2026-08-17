-- Decision Desk parity fields on verification_cases (offer, Plaid, SLA timestamps).
-- Hand-written: verification_cases is not in drizzle.config schema (stale snapshot — see 0117/0119).
-- Idempotent DDL. Do not apply to Render unless opted in.

ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS approved_limit text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS payment_type text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS billing_cycle text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS plaid_status text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS plaid_link_url text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS plaid_mode text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS cp_claimed_at timestamptz;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS cp_review_updated_at timestamptz;
