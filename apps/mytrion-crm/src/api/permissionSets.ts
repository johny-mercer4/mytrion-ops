/**
 * Permission set admin API.
 *
 * Shaped like `commsAdmin.ts` rather than `mytrionAccess.ts`: ONE snapshot GET that returns the
 * whole screen, then GRANULAR PATCHes per row. That matters here for the same reason it mattered
 * there — each control owns its own busy state, and two admins editing two different Mytrions of the
 * same set do not clobber each other (the server rewrites one jsonb key rather than the whole row).
 *
 * Contrast with `updateUserAccess`, which is a full-row REPLACE and forces every caller to
 * round-trip fields it never touched.
 */
import { request } from './transport';
import type { MytrionId } from '../access/mytrions.config';
import type { MytrionAccessMode } from './mytrionAccess';

export interface PermissionSet {
  id: string;
  name: string;
  key: string;
  description: string | null;
  allowedMytrions: MytrionId[];
  mytrionAccessModes: Partial<Record<MytrionId, MytrionAccessMode>>;
  /**
   * Per-Mytrion tab whitelist. A Mytrion ABSENT is UNSCOPED — every tab, present and future. An
   * empty ARRAY is the opposite statement: scoped to nothing. Never conflate them.
   */
  tabGrants: Partial<Record<MytrionId, string[]>>;
  /**
   * Replace the lower layers instead of unioning onto them.
   *
   * Additive can only widen, so a tab scope is defeated by any unscoped grant below it. Override is
   * how a set means "exactly this": permission sets (1) beat the per-user override (2) beat the
   * profile and role defaults (3).
   */
  override: boolean;
  active: boolean;
  assigneeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionSetAssignment {
  id: string;
  permissionSetId: string;
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  active: boolean;
  createdAt: string;
}

/** Every active Zoho worker, with `assigned` precomputed so anyone can be picked. */
export interface PermissionSetRosterEntry {
  zohoUserId: string;
  name: string | null;
  email: string | null;
  assigned: boolean;
}

export interface PermissionSetSnapshot {
  sets: PermissionSet[];
  assignments: PermissionSetAssignment[];
  roster: PermissionSetRosterEntry[];
}

const opts = { impersonate: false } as const;

export async function getPermissionSets(): Promise<PermissionSetSnapshot> {
  return (await request('GET', '/admin/permission-sets', opts)) as PermissionSetSnapshot;
}

export async function createPermissionSet(input: {
  name: string;
  description?: string | null;
}): Promise<PermissionSet> {
  const data = (await request('POST', '/admin/permission-sets', { ...opts, body: input })) as {
    set: PermissionSet;
  };
  return data.set;
}

export async function updatePermissionSet(
  id: string,
  patch: { name?: string; description?: string | null; active?: boolean; override?: boolean },
): Promise<PermissionSet> {
  const data = (await request('PATCH', `/admin/permission-sets/${encodeURIComponent(id)}`, {
    ...opts,
    body: patch,
  })) as { set: PermissionSet };
  return data.set;
}

/**
 * Save the whole grant configuration in one request.
 *
 * The editor holds a draft and sends it here, so Save means what it says — one statement server-side,
 * no half-applied state if a request fails midway.
 */
export async function savePermissionSetGrants(
  id: string,
  grants: {
    allowedMytrions: MytrionId[];
    mytrionAccessModes: Partial<Record<MytrionId, MytrionAccessMode>>;
    tabGrants: Partial<Record<MytrionId, string[]>>;
  },
): Promise<PermissionSet> {
  const data = (await request('PUT', `/admin/permission-sets/${encodeURIComponent(id)}/grants`, {
    ...opts,
    body: grants,
  })) as { set: PermissionSet };
  return data.set;
}

/**
 * Grant or re-scope ONE Mytrion.
 *
 * `tabs: null` unscopes it (every tab, including future ones); `tabs: []` scopes it to nothing.
 */
export async function setPermissionSetMytrion(
  id: string,
  mytrionId: MytrionId,
  grant: { mode: MytrionAccessMode; tabs: string[] | null },
): Promise<PermissionSet> {
  const data = (await request(
    'PATCH',
    `/admin/permission-sets/${encodeURIComponent(id)}/mytrions/${encodeURIComponent(mytrionId)}`,
    { ...opts, body: grant },
  )) as { set: PermissionSet };
  return data.set;
}

export async function removePermissionSetMytrion(
  id: string,
  mytrionId: MytrionId,
): Promise<PermissionSet> {
  const data = (await request(
    'DELETE',
    `/admin/permission-sets/${encodeURIComponent(id)}/mytrions/${encodeURIComponent(mytrionId)}`,
    opts,
  )) as { set: PermissionSet };
  return data.set;
}

export async function deletePermissionSet(id: string): Promise<boolean> {
  const data = (await request('DELETE', `/admin/permission-sets/${encodeURIComponent(id)}`, opts)) as {
    removed: boolean;
  };
  return data.removed;
}

export async function assignPermissionSet(
  id: string,
  input: { zohoUserId: string; userName?: string | null; email?: string | null },
): Promise<PermissionSetAssignment> {
  const data = (await request(
    'POST',
    `/admin/permission-sets/${encodeURIComponent(id)}/assignees`,
    { ...opts, body: input },
  )) as { assignment: PermissionSetAssignment };
  return data.assignment;
}

export async function unassignPermissionSet(id: string, zohoUserId: string): Promise<boolean> {
  const data = (await request(
    'DELETE',
    `/admin/permission-sets/${encodeURIComponent(id)}/assignees/${encodeURIComponent(zohoUserId)}`,
    opts,
  )) as { removed: boolean };
  return data.removed;
}

/** One layer's contribution, as the resolver recorded it while applying layers. */
export interface AccessTraceSource {
  layer:
    | 'legacy'
    | 'profile'
    | 'role'
    | 'marker_admin'
    | 'override'
    | 'permission_set'
    | 'break_glass';
  label: string;
}

export interface AccessTraceEntry {
  mytrion: MytrionId;
  grantedBy: AccessTraceSource[];
  mode: MytrionAccessMode;
  modeFrom: AccessTraceSource;
  tabs: {
    scoped: boolean;
    keys: string[];
    /** Set when an unscoped grant from another layer defeated a set's tab scope. */
    unscopedBy?: AccessTraceSource;
  };
}

export interface EffectiveAccessResponse {
  worker: { zohoUserId: string; name: string | null; profile: string | null };
  access: {
    accessibleMytrions: MytrionId[];
    allDepartmentAccess: boolean;
    mytrionAccessModes: Partial<Record<MytrionId, MytrionAccessMode>>;
    mytrionTabGrants: Partial<Record<MytrionId, string[]>>;
  };
  trace: {
    mytrions: AccessTraceEntry[];
    denied: MytrionId[];
    allDeptDowngraded: boolean;
    /** Sets that took the whole layer. Empty when resolution was purely additive. */
    overriddenBy: string[];
  } | null;
}

/** Uncached on the server, on purpose: a stale explanation is what this exists to remove. */
export async function getEffectiveAccess(zohoUserId: string): Promise<EffectiveAccessResponse> {
  return (await request(
    'GET',
    `/admin/mytrion-access/users/${encodeURIComponent(zohoUserId)}/effective`,
    opts,
  )) as EffectiveAccessResponse;
}
