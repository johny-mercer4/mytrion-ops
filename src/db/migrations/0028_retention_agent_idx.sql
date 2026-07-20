-- Speed agent case lists (tenant + assigned agent) when querying from a remote app DB.
CREATE INDEX IF NOT EXISTS "retention_cases_tenant_agent_idx"
  ON "retention_cases" ("tenant_id", "assigned_agent_zoho_user_id");
