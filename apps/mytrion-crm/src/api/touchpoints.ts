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
 * These exist so ONE automation is ONE row type regardless of which surface fired it. Two were
 * missing and split their automation across two names in the log: Horizon wrote `balance` and
 * `account_status` from 2026-07 while the widget kept writing `balance_check` (820 rows) and
 * `account_status_check` (228) — same automations, same agents, two entries in every filter
 * dropdown and two partial histories. The widget's key wins because the history is already under it.
 */
const LOG_TYPE_ALIASES: Record<string, string> = {
  'close-app': 'close-wex-application',
  reactivation: 'account-reactivation',
  'wex-apps': 'wex-apps-application',
  balance: 'balance-check',
  'account-status': 'account-status-check',
};

/**
 * Widget-parity usage log: one row per successful automation run. Fire-and-forget —
 * a logging blip must never mark a successful run as failed.
 *
 * Matches zoho-octane `_logOpsAutomation`: hyphen→underscore type, local triggerDate /
 * triggerTime, agent display name from the session.
 */
export function logAutomation(automationType: string): void {
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
    },
  }).catch(() => undefined);
}
