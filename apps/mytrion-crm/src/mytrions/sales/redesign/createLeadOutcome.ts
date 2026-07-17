/**
 * Parse mytrioncreatelead / leads.create touchpoint output (widget parity).
 * DUPLICATE_DATA nests the existing lead id under `response.details.id`.
 */
import type { CreateLeadResult } from '@/api/touchpointTypes';

export function resolveCreateLeadOutcome(res: CreateLeadResult): {
  ok: boolean;
  duplicate: boolean;
  leadId: string;
  message: string;
} {
  const topId = res.leadId != null && String(res.leadId) !== '' ? String(res.leadId) : '';
  if (res.success === true) {
    return { ok: true, duplicate: false, leadId: topId, message: res.message || '' };
  }
  if (res.success !== false && topId) {
    return { ok: true, duplicate: false, leadId: topId, message: res.message || '' };
  }
  let duplicateId = '';
  const raw = res.response;
  try {
    const zohoErr =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown> | null);
    if (zohoErr && zohoErr.code === 'DUPLICATE_DATA') {
      const details = zohoErr.details as { id?: string | number } | undefined;
      if (details?.id != null) duplicateId = String(details.id);
    }
  } catch {
    /* ignore */
  }
  const leadId = topId || duplicateId;
  if (leadId) {
    return { ok: true, duplicate: true, leadId, message: res.message || 'Lead already exists.' };
  }
  return { ok: false, duplicate: false, leadId: '', message: res.message || 'Lead was not created.' };
}
