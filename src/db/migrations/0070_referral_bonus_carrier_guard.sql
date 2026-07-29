-- A one-time referral award belongs to the economic carrier, not to one Zoho Child_Referral row.
-- Several child records can point at the same carrier, so the older child-id partial unique index
-- alone does not prevent the same company receiving the $50 award twice.

CREATE UNIQUE INDEX IF NOT EXISTS "mytrion_referral_bonuses_one_time_carrier_uq"
  ON "mytrion_referral_bonuses" ("tenant_id", "carrier_id", "bonus_type")
  WHERE "bonus_type" IN ('gallons_parent', 'gallons_child')
    AND "carrier_id" IS NOT NULL;
