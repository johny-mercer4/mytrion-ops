/**
 * Field-name casing resolver — the structural fix for Zoho's silent-no-op writes.
 *
 * The org's modules carry ambiguous field casings (the old CS widget probed a live record
 * at runtime to pick between Limits_added/Limits_Added and Chain_policy/Chain_Policy; a
 * write with the wrong casing returns HTTP 200 and changes nothing). Here every outgoing
 * payload key is resolved case-insensitively against LIVE `/settings/fields` metadata and
 * rewritten to the exact-cased API name; an unresolvable key is a 400, never a no-op.
 */
import { AppError } from '../../lib/errors.js';
import { zohoCrmRecords, type CrmFieldMeta } from '../../integrations/zohoCrmRecords.js';

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CachedModule {
  fetchedAt: number;
  /** lowercased api_name → exact-cased api_name */
  byLower: Map<string, string>;
  fields: CrmFieldMeta[];
}

const cache = new Map<string, CachedModule>();

async function loadModule(module: string): Promise<CachedModule> {
  const hit = cache.get(module);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  const fields = await zohoCrmRecords.getModuleFields(module);
  const byLower = new Map<string, string>();
  for (const f of fields) {
    if (f.api_name) byLower.set(f.api_name.toLowerCase(), f.api_name);
  }
  const entry: CachedModule = { fetchedAt: Date.now(), byLower, fields };
  cache.set(module, entry);
  return entry;
}

/** Test hook / manual invalidation (e.g. after a field is added in Zoho). */
export function invalidateFieldCache(module?: string): void {
  if (module) cache.delete(module);
  else cache.clear();
}

/** Exact-cased API name for a logical field name, or null when the module has no match. */
export async function resolveApiName(module: string, logicalName: string): Promise<string | null> {
  const { byLower } = await loadModule(module);
  return byLower.get(logicalName.toLowerCase()) ?? null;
}

/**
 * Rewrite every payload key to its exact-cased API name. Unknown keys reject the whole
 * write with a 400 — a partial write with silently-dropped fields is worse than a failure.
 */
export async function resolveWritePayload(
  module: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { byLower } = await loadModule(module);
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const exact = byLower.get(key.toLowerCase());
    if (!exact) {
      unknown.push(key);
      continue;
    }
    out[exact] = value;
  }
  if (unknown.length > 0) {
    throw new AppError(
      `Unknown ${module} field(s): ${unknown.join(', ')} — write rejected to avoid a silent no-op`,
      { statusCode: 400, code: 'UNKNOWN_CRM_FIELD', expose: true },
    );
  }
  return out;
}

/** Live picklist values for a field (the Citifuel status tabs come from here). */
export async function getPicklistValues(module: string, fieldName: string): Promise<string[]> {
  const { byLower, fields } = await loadModule(module);
  const exact = byLower.get(fieldName.toLowerCase());
  if (!exact) return [];
  const field = fields.find((f) => f.api_name === exact);
  return (field?.pick_list_values ?? [])
    .map((v) => v.actual_value ?? v.display_value ?? '')
    .filter(Boolean);
}
