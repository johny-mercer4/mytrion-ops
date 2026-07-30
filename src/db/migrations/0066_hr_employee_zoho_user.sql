-- Map a signing-in Zoho CRM user to their HR employee row — the anchor for Mytrion HR RBAC.
--
-- Two Zoho products, two id spaces: hr_employees.zoho_record_id is a Zoho PEOPLE record, while portal
-- sign-in is Zoho CRM OAuth. Nothing links them, so the link is resolved by matching work EMAIL
-- (lower/trim) — the only field both sides carry. NULL means "unresolved", which RBAC treats as no
-- access rather than as a wildcard.
--
-- The backfill below is deliberately CONSERVATIVE: it only writes a link where the normalised email is
-- unique on the employee side. Ambiguous emails are left NULL and surfaced by the mapping report, since
-- a wrong link here shows one person another person's private record.

ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "zoho_user_id" text;
--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "zoho_user_id_source" text;
--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN IF NOT EXISTS "zoho_user_linked_at" timestamp with time zone;
--> statement-breakpoint

-- One CRM user maps to AT MOST one employee. Without this the mapping can fan out and two rows both
-- answer "who is this session" — an RBAC hole, not a data-quality nit. Partial so the many unresolved
-- NULLs do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employees_tenant_zoho_user_uk"
  ON "hr_employees" ("tenant_id","zoho_user_id")
  WHERE "zoho_user_id" IS NOT NULL;
--> statement-breakpoint

-- Case-insensitive email lookup, so the resolver does not seq-scan 200+ rows per sign-in. The existing
-- (tenant_id, email) index cannot serve LOWER(email).
CREATE INDEX IF NOT EXISTS "hr_employees_tenant_email_lower_idx"
  ON "hr_employees" ("tenant_id", LOWER(TRIM("email")))
  WHERE "email" IS NOT NULL;
