import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // List table files explicitly (not the index.ts barrel). drizzle-kit 0.24's loader
  // resolves ESM `.js` specifiers literally and cannot remap them to `.ts`; the barrel's
  // value re-exports would fail. Each table file below imports only third-party packages
  // plus elided `import type` — so it loads cleanly. Add new tables here.
  schema: [
    './src/db/schema/tenants.ts',
    './src/db/schema/users.ts',
    './src/db/schema/carrier_users.ts',
    './src/db/schema/carrier_invitations.ts',
    './src/db/schema/registered_mini_app_companies.ts',
    './src/db/schema/mini_app_notifications.ts',
    './src/db/schema/client_news.ts',
    './src/db/schema/support_bot_chats.ts',
    './src/db/schema/conversations.ts',
    './src/db/schema/messages.ts',
    './src/db/schema/tool_calls.ts',
    './src/db/schema/knowledge_docs.ts',
    './src/db/schema/knowledge_chunks.ts',
    './src/db/schema/audit_log.ts',
    './src/db/schema/automation_logs.ts',
    './src/db/schema/scope_risk_items.ts',
    './src/db/schema/money_code_requests.ts',
    './src/db/schema/agent_runs.ts',
    './src/db/schema/agent_tasks.ts',
    './src/db/schema/file_assets.ts',
    './src/db/schema/approvals.ts',
    './src/db/schema/agent_memories.ts',
    './src/db/schema/retention_cases.ts',
    './src/db/schema/retention_claim_requests.ts',
    './src/db/schema/retention_ownership_transfers.ts',
    './src/db/schema/retention_rr_cursors.ts',
    './src/db/schema/inbox_events.ts',
    './src/db/schema/mytrion_profile_defaults.ts',
    './src/db/schema/worker_mytrion_access.ts',
    './src/db/schema/payment_transactions.ts',
    './src/db/schema/payment_carrier_memory.ts',
    './src/db/schema/payment_returns.ts',
    './src/db/schema/mytrion_calls.ts',
  ],
  out: './src/db/migrations',
  dialect: 'postgresql',
  // Mytrion OPS external Postgres (DATABASE_URL kept only as a legacy alias).
  // drizzle-kit hands the URL straight to pg and IGNORES a separate `ssl` option, so the SSL mode
  // must live IN the URL. Managed Postgres (Render) requires SSL → append `sslmode=require` (encrypt
  // without CA verify, matching the runtime app's rejectUnauthorized:false). Local docker needs none.
  dbCredentials: (() => {
    const raw = process.env.MYTRION_OPS_DATABASE_URL || process.env.DATABASE_URL || '';
    const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(raw);
    const url =
      !raw || isLocal || /[?&]sslmode=/.test(raw)
        ? raw
        : `${raw}${raw.includes('?') ? '&' : '?'}sslmode=require`;
    return { url };
  })(),
  strict: true,
  verbose: true,
});
