/**
 * Touchpoints client (/v1/touchpoints/:key) — one generic call over the backend's
 * touchpoint catalog (legacy Deluge functions + servercrm endpoints). Typed via
 * TouchpointMap; identity is server-injected from the session, the UI only sends its
 * department view (like every other surface).
 */
import { getSession } from './session';
import { request } from './transport';
import type { TouchpointKey, TouchpointMap } from './touchpointTypes';

export async function callTouchpoint<K extends TouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
  opts: {
    departmentAccess?: string[];
    signal?: AbortSignal;
    /** Authorized administrators may explicitly bypass the read cache. */
    force?: boolean;
    /** Stable mutation identity; important writes should reuse it across retries. */
    idempotencyKey?: string;
  } = {},
): Promise<TouchpointMap[K]['result']> {
  const res = (await request('POST', `/touchpoints/${encodeURIComponent(key)}`, {
    signal: opts.signal,
    headers: {
      ...(opts.force ? { 'x-cache-refresh': '1' } : {}),
      ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
    },
    body: {
      departmentAccess: opts.departmentAccess ?? ['sales'],
      params,
    },
  })) as { data: TouchpointMap[K]['result'] };
  return res.data;
}

/**
 * Catalog ids that differ from the Zoho widget's `config.action` log key.
 *
 * These exist so ONE automation is ONE row type regardless of which surface fired it. Three were
 * missing and split their automation across two names in the log: Horizon wrote `balance`,
 * `account_status` and `unit_driver` while the widget kept writing `balance_check` (822 rows),
 * `account_status_check` (229) and `unit_driver_change` (13) — same automations, same agents, two
 * entries in every filter dropdown and two partial histories. The widget's key wins because the
 * history is already under it.
 *
 * (The hyphenated `account-status` / `card-last-used` / `efs-login` / `wex-tasks` rows in the table
 * are dead residue: they all stop in mid-July 2026, when the hyphen→underscore normalisation below
 * landed. No live caller writes them, so they need no alias.)
 */
const LOG_TYPE_ALIASES: Record<string, string> = {
  'close-app': 'close-wex-application',
  reactivation: 'account-reactivation',
  'wex-apps': 'wex-apps-application',
  balance: 'balance-check',
  'account-status': 'account-status-check',
  'unit-driver': 'unit-driver-change',
};

/**
 * Widget-parity usage log. ONE row per submit click, written when the run settles — never a
 * second row for the click itself. Legacy callers may omit lifecycle fields and remain a single
 * succeeded row.
 * Fire-and-forget — a logging blip must never change the automation result shown to the worker.
 *
 * Matches zoho-octane `_logOpsAutomation`: hyphen→underscore type, local triggerDate /
 * triggerTime, agent display name from the session.
 */
export function logAutomation(
  automationType: string,
  lifecycle?: {
    runId: string;
    phase: 'succeeded' | 'failed';
    durationMs?: number;
    errorCode?: string;
  },
): void {
  const agentName =
    getSession()?.worker.userName?.trim()
    || getSession()?.worker.email?.trim()
    || undefined;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const triggerDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const triggerTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const raw = LOG_TYPE_ALIASES[automationType] ?? automationType;
  const type = String(raw || 'automation').replace(/-/g, '_');
  void request('POST', '/automation/logs', {
    body: {
      automationType: type,
      ...(agentName ? { agentName } : {}),
      triggerTime,
      triggerDate,
      // Every call from this app is Horizon by definition. The legacy Zoho widget posts to the same
      // endpoint and sends no origin, which is why the server's fallback is 'Mytrion Zoho'.
      originSource: 'Mytrion Horizon',
      ...(lifecycle
        ? {
            runId: lifecycle.runId,
            phase: lifecycle.phase,
            ...(lifecycle.durationMs !== undefined ? { durationMs: lifecycle.durationMs } : {}),
            ...(lifecycle.errorCode ? { errorCode: lifecycle.errorCode } : {}),
          }
        : {}),
    },
  }).catch(() => undefined);
}

/** Stable, non-sensitive failure buckets for lifecycle analytics. */
export function automationErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/timeout|timed out/.test(message)) return 'timeout';
  if (/network|failed to fetch|connection/.test(message)) return 'network';
  if (/forbidden|not allowed|permission|unauthorized/.test(message)) return 'authorization';
  if (/required|invalid|validation/.test(message)) return 'validation';
  return 'automation_failed';
}
