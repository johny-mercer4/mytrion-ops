/**
 * Internal User Management (Admin → User Management). Admin-only endpoints to view Zoho workers and
 * control which Mytrions each may access (per-user overrides) plus per-profile and per-role
 * defaults. All calls run as the real admin (impersonate:false), like /admin/agents.
 */
import type { MytrionId } from '../access/mytrions.config';
import { request } from './transport';

export type MytrionAccessMode = 'read' | 'full';
export type MytrionAccessModes = Partial<Record<MytrionId, MytrionAccessMode>>;

export interface AccessEffective {
  accessibleMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  departments: string[];
  mytrionAccessModes?: MytrionAccessModes;
}

export interface WorkerAccessOverride {
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profileName: string | null;
  /** null = inherit profile+role defaults; array = explicit replacement set. */
  allowedMytrions: MytrionId[] | null;
  deniedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  /** null = inherit; true/false = explicit. */
  allDepartmentAccess: boolean | null;
  /** Zoho user ids this worker may "View as". */
  viewAsUserIds: string[];
  mytrionAccessModes: MytrionAccessModes;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AccessUserRow {
  zohoUserId: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
  override: WorkerAccessOverride | null;
  effective: AccessEffective;
}

export interface ProfileDefault {
  id: string;
  profileName: string;
  profileKey: string;
  allowedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDefault {
  id: string;
  roleName: string;
  roleKey: string;
  allowedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  mytrionAccessModes: MytrionAccessModes;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** false = seen on Zoho roster but not yet saved to DB (does not affect resolution). */
  configured?: boolean;
}

export interface UserAccessPatch {
  allowedMytrions?: MytrionId[] | null;
  deniedMytrions?: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean | null;
  mytrionAccessModes?: MytrionAccessModes;
  viewAsUserIds?: string[];
  active?: boolean;
  userName?: string | null;
  email?: string | null;
  profileName?: string | null;
}

export async function listAccessUsers(): Promise<AccessUserRow[]> {
  const data = (await request('GET', '/admin/mytrion-access/users', { impersonate: false })) as {
    users: AccessUserRow[];
  };
  return data.users;
}

export async function updateUserAccess(
  zohoUserId: string,
  patch: UserAccessPatch,
): Promise<WorkerAccessOverride> {
  const data = (await request('POST', `/admin/mytrion-access/users/${encodeURIComponent(zohoUserId)}`, {
    impersonate: false,
    body: patch,
  })) as { access: WorkerAccessOverride };
  return data.access;
}

export async function listProfileDefaults(): Promise<ProfileDefault[]> {
  const data = (await request('GET', '/admin/mytrion-access/profiles', { impersonate: false })) as {
    profiles: ProfileDefault[];
  };
  return data.profiles;
}

export interface ProfileDefaultPatch {
  profileName: string;
  allowedMytrions: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean;
  active?: boolean;
}

export async function updateProfileDefault(
  profileKey: string,
  patch: ProfileDefaultPatch,
): Promise<ProfileDefault> {
  const data = (await request('POST', `/admin/mytrion-access/profiles/${encodeURIComponent(profileKey)}`, {
    impersonate: false,
    body: patch,
  })) as { profile: ProfileDefault };
  return data.profile;
}

export async function listRoleDefaults(): Promise<RoleDefault[]> {
  const data = (await request('GET', '/admin/mytrion-access/roles', { impersonate: false })) as {
    roles: RoleDefault[];
  };
  return data.roles;
}

export interface RoleDefaultPatch {
  roleName: string;
  allowedMytrions: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean;
  mytrionAccessModes?: MytrionAccessModes;
  active?: boolean;
}

export async function updateRoleDefault(roleKey: string, patch: RoleDefaultPatch): Promise<RoleDefault> {
  const data = (await request('POST', `/admin/mytrion-access/roles/${encodeURIComponent(roleKey)}`, {
    impersonate: false,
    body: patch,
  })) as { role: RoleDefault };
  return data.role;
}
