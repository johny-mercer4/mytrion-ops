-- Persisted spend ledger for metered verification vendors (iSoftPull; Plaid /get later).
--
-- HAND-WRITTEN, not generated. No verification schema file is registered in `drizzle.config.ts`
-- (see the NOTE there), so `pnpm db:generate` cannot see this table — and pointing it at
-- verification files would emit every other team's pending drift alongside this change.
-- Idempotent throughout. The in-memory WeakSet is only the forge-proof token; a live metered
-- pull must insert here before the vendor HTTP leaves the process.

CREATE TABLE IF NOT EXISTS verification_vendor_spend_attempts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  vendor_id text NOT NULL,
  case_id text NOT NULL,
  status text NOT NULL,
  requested_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS verification_vendor_spend_attempts_tenant_vendor_idx
  ON verification_vendor_spend_attempts (tenant_id, vendor_id, created_at);
