import { z } from 'zod';

/** Parse a '0'/'1'/'true'/'false' style flag into a boolean, with a default. */
const flag = (def: '0' | '1') =>
  z
    .string()
    .default(def)
    .transform((value) => value === '1' || value.toLowerCase() === 'true');

/**
 * Inbound shared secrets — the keys OTHER systems present to reach this engine.
 *
 * Split out of `env.ts` for the 600-line cap, and they group cleanly: every one is a per-caller
 * shared secret on a webhook or an inbound API surface, each deliberately dedicated so revoking one
 * integration never takes another down.
 */
export const inboundSecretsEnvShape = {
  // --- Inbound server API key (callers present this to reach this engine) ---
  API_KEY: z.string().default(''),

  // --- Telegram support-bot gateway (service-to-service only) ---
  // Deliberately separate from API_KEY: compromise of the bot process must not grant access to
  // unrelated admin/API routes. The gateway presents this only as x-support-bot-key.
  SUPPORT_BOT_GATEWAY_API_KEY: z.string().default(''),
  // Render URL for the separately deployed gateway monitor, plus the gateway's MONITOR_TOKEN.
  // The backend injects the token server-side after authenticating an Octane admin/service caller.
  SUPPORT_BOT_GATEWAY_MONITOR_URL: z.string().url().or(z.literal('')).default(''),
  SUPPORT_BOT_GATEWAY_MONITOR_TOKEN: z.string().default(''),

  // --- Billing payment-ingest webhook (Zapier → payment_transactions). A dedicated shared
  //     secret, scoped to just the ingest endpoint (NOT the full API_KEY). ---
  BILLING_INGEST_SECRET: z.string().default(''),

  // --- Inbox-message webhook (Zoho CRM Org_Module → mytrion_inbox_messages). A dedicated shared
  //     secret in the `x-inbox-secret` header, scoped to just that endpoint (NOT the full API_KEY). ---
  INBOX_WEBHOOK_SECRET: z.string().default(''),

  // --- HR attendance webhook (Hikvision / servercrm → hr_attendance_punches). Header
  //     `x-attendance-webhook-secret`. Blank → route answers 503 (boot still succeeds). ---
  HR_ATTENDANCE_WEBHOOK_SECRET: z.string().default(''),

  // --- Rejection-report webhook (Zoho Desk Deluge → mytrion_rejection_reports). A dedicated shared
  //     secret in the `x-rejection-secret` header, scoped to just that endpoint (NOT the full
  //     API_KEY). Blank is allowed: the route answers 503 at request time rather than blocking boot. ---
  REJECTION_WEBHOOK_SECRET: z.string().default(''),

  // --- Manager EFS Console (proxies servercrm /api/efs/console) ---
  // Two flags, not one. The master switch defaults OFF, and even with it on nothing is sent unless
  // the action's key is listed in MANAGER_EFS_LIVE_ACTIONS. Arming is therefore one money-moving
  // call at a time rather than ~30 at once, none of which has ever been sent to EFS.
  // Note this is OUR gate; servercrm has its own (EFS_TOUCHPOINTS_WRITES_ENABLED) which we do not
  // control and which currently reports writesEnabled: true.
  FF_MANAGER_EFS_WRITES_ENABLED: flag('0'),
  /** Comma-separated action keys, e.g. `cards.pin,moneyCodes.void`. Empty means none. */
  MANAGER_EFS_LIVE_ACTIONS: z.string().default(''),

  // --- Sales KPI collection + external worker-task intake ---
  // Collection is independently gated so migrations/UI can deploy before cron and browser telemetry.
  FF_KPI_COLLECTION_ENABLED: flag('0'),
  // Local Sales Mytrion presence/activity collection and usage rollups. Independent from the
  // external KPI collectors, whose four kpi.sales.* queues remain parked.
  FF_MYTRION_USAGE_COLLECTION_ENABLED: flag('0'),
  KPI_REPORTING_TZ: z.string().default('America/New_York'),
  // One rotatable, task-create-only HMAC credential for trusted external automations.
  MYTRION_TASK_WEBHOOK_KEY_ID: z.string().default('external-automation'),
  MYTRION_TASK_WEBHOOK_SECRET: z.string().default(''),
};
