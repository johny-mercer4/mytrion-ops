/**
 * Canonical Mytrion taxonomy — the backend mirror of the frontend access table
 * (apps/mytrion-crm/src/access/mytrions.config.ts). The frontend owns display fields
 * (title/icon/blurb); this owns the slug↔department join used by the DB-backed access resolver
 * (modules/access/mytrionAccessService.ts) to turn a worker's allowed-Mytrion set into the
 * `department_access` grants that RBAC (tools/agents/knowledge) actually enforces.
 *
 * Keep MYTRION_IDS in sync with the frontend slug set; a mismatch means a Mytrion the UI shows
 * that the backend can't map to a department (or vice-versa).
 */

export const MYTRION_IDS = [
  'admin',
  'sales',
  'billing',
  'collection',
  'finance',
  'verification',
  'manager',
  'analyst',
  'customer-service',
] as const;

export type MytrionId = (typeof MYTRION_IDS)[number];

/** Each Mytrion → its backend `department_access` slug (a free string; not an enforced allowlist). */
export const MYTRION_DEPARTMENT: Record<MytrionId, string> = {
  admin: 'admin',
  sales: 'sales',
  billing: 'billing',
  collection: 'collection',
  finance: 'finance',
  verification: 'verification',
  manager: 'management',
  analyst: 'analytics',
  'customer-service': 'customer-service',
};

export function isMytrionId(value: unknown): value is MytrionId {
  return typeof value === 'string' && (MYTRION_IDS as readonly string[]).includes(value);
}

/** Keep only valid Mytrion slugs from an arbitrary array (deduped, order preserved). */
export function toMytrionIds(values: readonly unknown[] | null | undefined): MytrionId[] {
  if (!values) return [];
  const out: MytrionId[] = [];
  for (const v of values) if (isMytrionId(v) && !out.includes(v)) out.push(v);
  return out;
}

/**
 * Distinct backend departments for a set of Mytrions. Drops the `admin` Mytrion's placeholder — it
 * is not a real department_access tag (admins are gated by allDepartmentAccess, never by an 'admin'
 * department), so it must never leak into a worker's department grant.
 */
export function departmentsForMytrions(ids: readonly MytrionId[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    if (id === 'admin') continue;
    out.add(MYTRION_DEPARTMENT[id]);
  }
  return [...out];
}

export interface ProfileDefaultSeed {
  profileName: string;
  allowedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
}

/**
 * Seed defaults for the known Zoho profiles (editable later in the Admin → User Management tab).
 * Sales* profiles land in Sales; Administrator sees everything and lands on the picker; the
 * restricted workspaces (finance/collection/verification/manager/analyst) are granted per-user,
 * not by profile — matching today's restricted-finance intent.
 */
export const DEFAULT_PROFILE_SEED: ProfileDefaultSeed[] = [
  { profileName: 'Administrator', allowedMytrions: [...MYTRION_IDS], homeMytrion: null, allDepartmentAccess: true },
  { profileName: 'Sales Agent', allowedMytrions: ['sales'], homeMytrion: 'sales', allDepartmentAccess: false },
  { profileName: 'Sales Plus', allowedMytrions: ['sales'], homeMytrion: 'sales', allDepartmentAccess: false },
  { profileName: 'Sales Assistant', allowedMytrions: ['sales'], homeMytrion: 'sales', allDepartmentAccess: false },
  { profileName: 'Referral Standard Plus', allowedMytrions: ['sales'], homeMytrion: 'sales', allDepartmentAccess: false },
  { profileName: 'Standard Plus', allowedMytrions: ['sales', 'billing'], homeMytrion: 'sales', allDepartmentAccess: false },
  {
    profileName: 'Customer Retention',
    allowedMytrions: ['customer-service'],
    homeMytrion: 'customer-service',
    allDepartmentAccess: false,
  },
  { profileName: 'Standard', allowedMytrions: ['customer-service'], homeMytrion: 'customer-service', allDepartmentAccess: false },
];

/** Match key for a profile name: trim + lowercase (same normalization used everywhere). */
export function profileKeyOf(profileName: string): string {
  return profileName.trim().toLowerCase();
}
