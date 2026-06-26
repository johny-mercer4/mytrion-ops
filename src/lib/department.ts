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
import { env } from '../config/env.js';

export const KNOWN_DEPARTMENTS = [
  'sales',
  'billing',
  'verification',
  'maintenance',
  'customer-service',
  'finance',
  'collection',
  'retention',
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

/**
 * Profile/role values that bypass ALL department RBAC (RAG grounding + tool gating) — the
 * "unlimited" operators: Developers, Managers, Admins. Configured via ADMIN_PROFILE_MARKERS
 * (CSV, default "administrator,manager,developer") so the policy can change without a deploy.
 * Matched as a case-insensitive SUBSTRING against each profile AND role value.
 *
 * Caveat: substring matching can over-match (e.g. a "manager" marker also matches a sales
 * title like "Account Manager"). If that's a concern, set ADMIN_PROFILE_MARKERS to precise
 * values for your Zoho profile/role names.
 */
function adminMarkers(): string[] {
  return env.ADMIN_PROFILE_MARKERS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function matchesAdminMarker(value?: string | readonly string[] | null): boolean {
  if (!value) return false;
  const list = Array.isArray(value) ? value : [value as string];
  const markers = adminMarkers();
  return list.some((v) => {
    const lc = String(v).toLowerCase();
    return markers.some((m) => lc.includes(m));
  });
}

/** True if a profile (or list of profiles) carries an admin marker. */
export function isAdministratorProfile(profile?: string | readonly string[] | null): boolean {
  return matchesAdminMarker(profile);
}

/**
 * The single source of truth for the "see everything" bypass, applied identically to RAG
 * and tools. True when the caller explicitly asks (`allDepartments`) OR carries an admin
 * marker on their profile OR their role. Keep this the ONLY place that decides the bypass
 * so RAG + tools never diverge.
 */
export function resolveAllDepartmentAccess(opts: {
  allDepartments?: boolean | undefined;
  profile?: string | readonly string[] | null | undefined;
  role?: string | readonly string[] | null | undefined;
}): boolean {
  return (
    opts.allDepartments === true ||
    matchesAdminMarker(opts.profile) ||
    matchesAdminMarker(opts.role)
  );
}
