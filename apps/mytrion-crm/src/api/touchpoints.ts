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
  opts: { departmentAccess?: string[] } = {},
): Promise<TouchpointMap[K]['result']> {
  const res = (await request('POST', `/touchpoints/${encodeURIComponent(key)}`, {
    body: {
      departmentAccess: opts.departmentAccess ?? ['sales'],
      params,
    },
  })) as { data: TouchpointMap[K]['result'] };
  return res.data;
}

/**
 * Widget-parity usage log: one row per successful automation run. Fire-and-forget —
 * a logging blip must never mark a successful run as failed.
 */
export function logAutomation(automationType: string): void {
  const agentName = getSession()?.worker.userName ?? undefined;
  void request('POST', '/automation/logs', {
    body: { automationType, ...(agentName ? { agentName } : {}) },
  }).catch(() => undefined);
}
