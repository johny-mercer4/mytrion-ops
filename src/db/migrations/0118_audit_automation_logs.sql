-- Audit + Automation log enrichment.
--
-- 1. automation_logs.origin_source — which surface fired the automation. Existing rows came from
--    either the legacy Zoho widget or Horizon and are indistinguishable after the fact, so the
--    backfill default is the honest one ('Mytrion Zoho'); only a caller that explicitly claims
--    'Mytrion Horizon' gets that value.
-- 2. audit_log indexes for the new agent-name / profile / role filters, the Logins + Mytrion-access
--    views, and the login-throttle lookback. Filtering these columns was a seq scan over the
--    whole table before this.
--
-- Idempotent (IF NOT EXISTS throughout) so it is safe on a fresh DB and on an existing one.

ALTER TABLE "automation_logs"
  ADD COLUMN IF NOT EXISTS "origin_source" text NOT NULL DEFAULT 'Mytrion Zoho';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_logs_origin_idx"
  ON "automation_logs" ("tenant_id","origin_source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_logs_agent_idx"
  ON "automation_logs" ("tenant_id","agent_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_name_idx"
  ON "audit_log" ("tenant_id","user_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_profile_idx"
  ON "audit_log" ("tenant_id","profile");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_role_idx"
  ON "audit_log" ("tenant_id","role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_caller_role_idx"
  ON "audit_log" ("tenant_id","caller_role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_action_created_idx"
  ON "audit_log" ("tenant_id","action","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_resource_idx"
  ON "audit_log" ("tenant_id","resource_type","resource_id");
