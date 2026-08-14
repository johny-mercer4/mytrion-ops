-- The last of the SOP's eleven manager-review indicators: "banking inconsistent with reported
-- operations". A judgement rather than a number, so it needs its own flag — no stored figure
-- expresses "these statements do not look like the business the applicant described".
--
-- Hand-written and idempotent, like 0121. Do not apply to Render unless opted in.

ALTER TABLE verification_banking_reviews
  ADD COLUMN IF NOT EXISTS banking_inconsistent_with_operations boolean NOT NULL DEFAULT false;
