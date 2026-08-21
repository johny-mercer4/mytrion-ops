import { z } from 'zod';

/** Parse a '0'/'1'/'true'/'false' style flag into a boolean, with a default. */
const flag = (def: '0' | '1') =>
  z
    .string()
    .default(def)
    .transform((value) => value === '1' || value.toLowerCase() === 'true');

/**
 * Feature flags — the on/off switches, all defaulted so an unset environment is a working one.
 *
 * Split out of `env.ts` for the 600-line cap. `operationalEnvShape` holds the flags that come with
 * their own configuration; these are the bare switches.
 */
export const featureFlagEnvShape = {
  // --- Feature flags ---
  FF_PARTNER_AUDIENCE_ENABLED: flag('1'),
  FF_KNOWLEDGE_INGEST_ENABLED: flag('1'),
  // Mini-app self-service WRITE actions (C-16 override, C-1/C-3 activate/deactivate, C-4/5 limits,
  // C-26 unit/driver, C-10 fraud request) — carrier-scoped, rate-limited, audit-logged. Off by
  // default: enable per environment once the pilot carrier is briefed.
  FF_MINIAPP_CARD_WRITES_ENABLED: flag('0'),
  // Postgres-backed idempotency/fencing for support-bot writes. Enable only after migration 0058
  // and the gateway operation-metadata rollout; metadata headers are mandatory when ON.
  FF_SUPPORT_BOT_IDEMPOTENCY: flag('0'),
  /** Comma-separated carrier ids piloted for notification pollers (card_status diff). Empty =
   *  the cron job no-ops — per-carrier rollout, Onzmove first (see notification ultraplan). */
  NOTIFY_POLL_CARRIERS: z.string().default(''),
  // Mini-app C-17 money-code preview/draw (servercrm owns the limit math). Off by default.
  FF_MINIAPP_MONEY_CODE_ENABLED: flag('0'),
  /** Mini-app "add a manager" invite creation. OFF by owner decision 2026-07-22 — managers are
   *  onboarded by Octane agents only; the roster (list/revoke) in the mini-app stays available. */
  FF_MINIAPP_MANAGER_INVITES_ENABLED: flag('0'),
  // Cap on a single mini-app limit CHANGE (C-4/5). Bigger adjustments go through CS.
  MINIAPP_LIMIT_CHANGE_MAX: z.coerce.number().positive().max(350).default(350),
  // Always-on RAG: inject RBAC-scoped pgvector passages into every chat turn.
  FF_RAG_ENABLED: flag('1'),
  // Hybrid retrieval (vector + full-text RRF fusion). Requires the content_tsv migration.
  FF_RAG_HYBRID: flag('0'),
  // Agentic retrieval loop (multi-query planning + CRAG grade + refine/fallback + citations).
  FF_AGENTIC_RAG: flag('1'),
  // Optional LLM rerank of fused candidates (adds a model call per retrieval).
  FF_RAG_RERANK: flag('0'),
  // Expose Zoho MCP tools to the chat agent (read tools only unless FF_ZOHO_MCP_WRITES). Off by default.
  FF_ZOHO_MCP_ENABLED: flag('0'),
  // Additionally expose Zoho MCP WRITE tools (create/update/upsert). Off by default (read-only posture).
  FF_ZOHO_MCP_WRITES: flag('0'),
  // Connect the hosted dbt MCP (warehouse analytics + query-memory RAG). ON by default — agents
  // reach the DWH only through dbt MCP (not the direct DWH_DATABASE_URL pool). Requires
  // DBT_MCP_URL + client credentials. See integrations/dbtMcp.ts + dbtMcpTools.ts.
  FF_DBT_MCP_ENABLED: flag('1'),
  // Expose dbt MCP WRITE tools (`run` / `test`). Off by default (read-only posture).
  FF_DBT_MCP_WRITES: flag('0'),
  FF_AUDIT_LOG_ENABLED: flag('1'),
  // Dev-only route that mints a validly-signed Telegram initData for a fake user (local mini-app
  // testing without a real Telegram client). Off by default — gating solely on NODE_ENV!=='production'
  // is not enough, since NODE_ENV defaults to 'development' when unset (a misconfigured staging/
  // preview env sharing the prod bot token would otherwise expose it). Explicit opt-in required.
  FF_DEV_MOCK_TELEGRAM_ENABLED: flag('0'),
  // Dev-only: the Zoho user id the static API_KEY session should present as. The API_KEY context
  // has no Zoho identity (userId: 'system'), so every owner-scoped read — CS Home tiles, retention
  // desk quota — fails closed locally with "No Zoho user id on the request for owner-scoped data".
  // A real Zoho login sets `zoho:<id>` and is unaffected. Blank = off, and it is IGNORED in
  // production regardless (see systemContext) — same reasoning as FF_DEV_MOCK_TELEGRAM_ENABLED:
  // NODE_ENV alone is not a sufficient gate, so this must also be set explicitly.
  DEV_MOCK_ZOHO_USER_ID: z.string().default(''),
  // Sales workers may run DESTRUCTIVE touchpoints (card deactivate/limits, money-code draw,
  // fraud release, EFS override) — widget parity, ON by default. 0 = admin-only, no code change.
  FF_TOUCHPOINT_DESTRUCTIVE_SALES: flag('1'),
  // DeepAgents orchestrator endpoint (POST /v1/agent/deep). Off by default; lazy-loaded when on.
  FF_DEEP_AGENTS_ENABLED: flag('0'),
  // Composio external tool-calling (adds the external-tools subagent + /v1/integrations/composio/*).
  FF_COMPOSIO_ENABLED: flag('1'),
  // Expose Composio WRITE/destructive tools (create/update/delete/…) to the agent. Off = read-only
  // (hard-rule #7), mirroring FF_ZOHO_MCP_WRITES. Even when on, the subagent stays admin-gated.
  FF_COMPOSIO_WRITES: flag('0'),
  // Expose the native Telegram toolkit (send/get tools) to the agent. Sends are write-risk →
  // admin-gated by the dispatcher regardless; this just registers the toolkit.
  FF_TELEGRAM_ENABLED: flag('1'),
  // Strict customer isolation: requests carrying customer markers (carrier_id / application_id /
  // chat_id) get a locked-down 'customer' context — client-supplied department_scope /
  // allDepartments / profile / role / user_name are IGNORED and scope derives solely from the
  // company id. ON by default (hardening pass 2026-07): set to 0 only as a temporary rollback
  // while a legacy client (Telegram shim) still sends worker-style scope fields.
  FF_CUSTOMER_SCOPE_STRICT: flag('1'),
  // Strict worker departments: bound a verified NON-admin worker's department view by the
  // departments derived from their Zoho profile/role (deriveWorkerDepartments). Off until the
  // profile→department mapping is validated against the live Zoho roster — an unmapped profile
  // would silently drop the worker to Global-only knowledge.
  FF_WORKER_DEPT_STRICT: flag('0'),
  // Session-authoritative department access on the direct routes (Desk / Data Center /
  // RingCentral / Retention / Knowledge): verified sessions IGNORE the x-department-access /
  // x-all-departments headers; a non-admin worker's departments are derived from their Zoho
  // profile/role. ON by default (security fix 2026-07: header trust let any authenticated user
  // self-elevate). Set to 0 ONLY as an emergency rollback if live Zoho profiles don't map onto
  // KNOWN_DEPARTMENTS (watch the "department claims ignored" warn log).
  FF_SESSION_DEPT_AUTHORITATIVE: flag('1'),
  // Zoho OAuth worker sign-in (/v1/auth/zoho/*) + Bearer-session identity on caller routes.
  // ON by default — the portal always expects Zoho OAuth; set to 0 only for emergency static-key bypass.
  FF_ZOHO_OAUTH_ENABLED: flag('1'),
};
