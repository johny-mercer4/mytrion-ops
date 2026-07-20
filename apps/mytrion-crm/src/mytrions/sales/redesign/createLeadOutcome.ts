/**
 * Parse mytrioncreatelead / leads.create touchpoint output (widget parity).
 * DUPLICATE_DATA nests the existing lead id under `response.details.id`
 * (sometimes as a JSON string, sometimes under a Zoho `data[]` envelope).
 */
import type { CreateLeadResult } from '@/api/touchpointTypes';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Pull the existing lead id out of a Zoho DUPLICATE_DATA payload (any nesting). */
export function extractDuplicateLeadId(raw: unknown): string {
  const walk = (node: unknown, depth: number): string => {
    if (depth > 4 || node == null) return '';
    if (typeof node === 'string') {
      const t = node.trim();
      if (!t) return '';
      try {
        return walk(JSON.parse(t) as unknown, depth + 1);
      } catch {
        return '';
      }
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const id = walk(item, depth + 1);
        if (id) return id;
      }
      return '';
    }
    const obj = asRecord(node);
    if (!obj) return '';
    if (obj.code === 'DUPLICATE_DATA') {
      const details = asRecord(obj.details);
      if (details?.id != null && String(details.id) !== '') return String(details.id);
    }
    for (const key of ['response', 'data', 'details', 'Result', 'output'] as const) {
      if (key in obj) {
        const id = walk(obj[key], depth + 1);
        if (id) return id;
      }
    }
    return '';
  };
  return walk(raw, 0);
}

function isSuccessFlag(v: unknown): boolean {
  return v === true || v === 'true' || v === 'success';
}

function isFailureFlag(v: unknown): boolean {
  return v === false || v === 'false' || v === 'error' || v === 'failure';
}

export function resolveCreateLeadOutcome(res: CreateLeadResult): {
  ok: boolean;
  duplicate: boolean;
  leadId: string;
  message: string;
} {
  const topId = res.leadId != null && String(res.leadId) !== '' ? String(res.leadId) : '';
  const message = res.message || '';

  if (isSuccessFlag(res.success)) {
    return { ok: true, duplicate: false, leadId: topId, message };
  }

  // Widget: only treat as "Already exists" when Zoho returns DUPLICATE_DATA + id.
  const duplicateId = extractDuplicateLeadId(res.response) || extractDuplicateLeadId(res);
  if (duplicateId) {
    return {
      ok: true,
      duplicate: true,
      leadId: duplicateId,
      message: message || 'Lead already exists.',
    };
  }

  // Soft success: some unwrap paths omit success but still return a leadId.
  if (!isFailureFlag(res.success) && topId) {
    return { ok: true, duplicate: false, leadId: topId, message };
  }

  return {
    ok: false,
    duplicate: false,
    leadId: '',
    message: message || 'Lead was not created.',
  };
}
