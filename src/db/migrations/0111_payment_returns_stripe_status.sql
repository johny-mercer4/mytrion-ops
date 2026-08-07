-- Raw Stripe dispute status (needs_response/under_review/won/lost/…) at ingest time — informational
-- only, no lifecycle logic reads it back. A non-creation stage (won/lost/closed/refunded) never
-- reaches this table at all (the ingest route no-ops before writing), so this only ever holds the
-- status the dispute had WHEN the row was created/last refreshed, not a live-updated field.
ALTER TABLE "payment_returns"
  ADD COLUMN IF NOT EXISTS "stripe_status" text;
