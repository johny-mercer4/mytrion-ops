/** Privacy-limited Sales telemetry: semantic names and opaque CRM ids only. */
import { request } from './transport';

export type KpiActivityName =
  | 'navigation.tab_open'
  | 'crm.lead_open'
  | 'crm.deal_open'
  | 'crm.call_click'
  | 'crm.edit_open'
  | 'crm.edit_save_success'
  | 'crm.edit_save_failed';

export interface KpiActivityEvent {
  clientEventId: string;
  eventName: KpiActivityName;
  sessionId?: string;
  entityType?: 'lead' | 'deal' | 'tab';
  entityId?: string;
  outcome?: 'success' | 'failed' | 'attempted';
  occurredAt?: string;
}

export async function postKpiPresence(
  sessionId: string,
  events: Array<{
    clientEventId: string;
    state: 'active' | 'idle' | 'hidden' | 'ended';
    occurredAt: string;
  }>,
): Promise<void> {
  await request('POST', '/kpi/presence', {
    body: { sessionId, events },
    impersonate: false,
  });
}

export async function postKpiActivity(events: KpiActivityEvent[]): Promise<void> {
  await request('POST', '/kpi/activity-events', {
    body: { events },
    impersonate: false,
  });
}
