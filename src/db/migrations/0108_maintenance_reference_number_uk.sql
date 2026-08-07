-- Reference numbers were never actually unique-checked (the old generator's uniqueness was
-- "accidental" via a Postgres sequence's atomicity) — closing that gap now that generation moves
-- to a random draw with an application-level collision retry (CS feedback 2026-08-07: the
-- sequence's monotonic output was predictable, e.g. "500000005"). Partial, mirroring
-- maintenance_cases_zoho_uk: legacy Zoho rows (and, in principle, a future manual entry) can leave
-- this blank. Verified live: zero existing duplicates among 2,724 non-null values, so this applies
-- cleanly with no backfill.
CREATE UNIQUE INDEX IF NOT EXISTS "maintenance_cases_reference_number_uk"
  ON "maintenance_cases" ("reference_number")
  WHERE "reference_number" IS NOT NULL;
