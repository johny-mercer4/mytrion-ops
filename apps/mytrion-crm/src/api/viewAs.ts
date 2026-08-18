/**
 * Fetch the EFFECTIVE access of another user, to render the app as them for the admin "View as"
 * RBAC preview. Admin-only server-side (GET /auth/view-as/:id); called as the real admin
 * (`impersonate: false`) so the request is authorized by the admin's own session, not by act-as.
 */
import type { MytrionId } from '../access/mytrions.config';
import type { MytrionAccessModes, MytrionTabGrants } from './mytrionAccess';
import { request } from './transport';
import type { UserContext } from '../context/userContext';

interface ViewAsWorker {
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
  allDepartmentAccess: boolean;
  accessibleMytrions: MytrionId[];
  homeMytrion: MytrionId | null;
  mytrionAccessModes: MytrionAccessModes;
  mytrionTabGrants: MytrionTabGrants;
  leadsTeam: boolean;
}

/** Map the target's resolved access onto a UserContext the RBAC gates already understand. */
function toContext(w: ViewAsWorker): UserContext {
  return {
    userId: `zoho:${w.zohoUserId}`,
    profile: w.profile ?? '',
    role: w.role ?? '',
    userName: w.userName ?? '',
    email: w.email,
    // Verified: this is a real, server-resolved identity — the RBAC gates should trust its flags
    // exactly as they trust the signed-in worker's.
    trusted: true,
    accessibleMytrions: w.accessibleMytrions,
    homeMytrion: w.homeMytrion,
    allDepartmentAccess: w.allDepartmentAccess,
    mytrionAccessModes: w.mytrionAccessModes,
    mytrionTabGrants: w.mytrionTabGrants,
    leadsTeam: w.leadsTeam,
  };
}

export async function fetchViewAsContext(
  zohoUserId: string,
  signal?: AbortSignal,
): Promise<UserContext> {
  const res = (await request('GET', `/auth/view-as/${encodeURIComponent(zohoUserId)}`, {
    impersonate: false,
    ...(signal ? { signal } : {}),
  })) as { worker: ViewAsWorker };
  return toContext(res.worker);
}
