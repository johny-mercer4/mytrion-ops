/**
 * department_access is the single RBAC tag on knowledge (and tool gating). It's a FREE
 * STRING — any value is accepted (a department name, a Zoho user id, a carrier id, …).
 * The keys below are the well-known ones the admin widget uses; they are documentation /
 * reference only and are NOT enforced as an allowlist.
 *
 * To stop ingest- and query-side values from drifting (e.g. "Finance" vs "finance"), every
 * tag is normalized the same way on both sides: trimmed + lowercased; empty/blank => null
 * (Global — shared, included in every scoped query).
 */
export const KNOWN_DEPARTMENTS = [
  'sales',
  'billing',
  'verification',
  'maintenance',
  'customer-service',
  'finance',
  'c-level',
  'management',
] as const;

export type KnownDepartment = (typeof KNOWN_DEPARTMENTS)[number];

/** Normalize a single tag: trim + lowercase. Blank/empty => null (Global). */
export function normalizeDepartment(value?: string | null): string | null {
  if (value == null) return null;
  const v = value.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/** Normalize a list of allowed tags: trim + lowercase, drop blanks, dedupe. */
export function normalizeDepartments(values?: readonly string[] | null): string[] {
  if (!values) return [];
  const out = new Set<string>();
  for (const value of values) {
    const n = normalizeDepartment(value);
    if (n) out.add(n);
  }
  return [...out];
}
