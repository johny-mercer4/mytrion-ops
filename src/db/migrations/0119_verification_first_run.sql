-- First-run inbox state on verification_cases (Mytrion owns WHEN; CP inbox owns HOW).
-- Hand-written: verification_cases is not in drizzle.config schema (stale snapshot — see 0117).
-- Idempotent DDL. Do not apply to Render unless opted in.

ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS first_run_status text NOT NULL DEFAULT 'idle';
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS first_run_step text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS first_run_inbox_id integer;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS first_run_error text;
--> statement-breakpoint
ALTER TABLE verification_cases
  ADD COLUMN IF NOT EXISTS cp_owner_username text;
