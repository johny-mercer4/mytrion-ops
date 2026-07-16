/**
 * Internal User Management (Admin → User Management). Admin-only endpoints to view Zoho workers and
 * control which Mytrions each may access (per-user overrides) plus the per-profile defaults. All
 * calls run as the real admin (impersonate:false), like /admin/agents.
 */
import type { MytrionId } from '../access/mytrions.config';
import { request } from './transport';

export interface AccessEffective {
  accessibleMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  allDepartmentAccess: boolean;
  departments: string[];
}

export interface WorkerAccessOverride {
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profileName: string | null;
  /** null = inherit the profile default; array = explicit replacement set. */
  allowedMytrions: MytrionId[] | null;
  deniedMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  /** null = inherit; true/false = explicit. */
  allDepartmentAccess: boolean | null;
  /** Zoho user ids this worker may "View as". */
  viewAsUserIds: string[];
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

export interface UserAccessPatch {
  allowedMytrions?: MytrionId[] | null;
  deniedMytrions?: MytrionId[];
  homeMytrion?: MytrionId | null;
  allDepartmentAccess?: boolean | null;
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
