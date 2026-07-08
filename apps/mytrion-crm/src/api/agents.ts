/** Admin-only: the active Sales-profile CRM users an admin can "act as" (GET /v1/admin/agents). */
import { request } from './transport';

export interface AgentUser {
  zohoUserId: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
}

/**
 * List sales agents for the impersonation picker. `impersonate:false` — this call must run as the
 * real admin (allDepartmentAccess), never as an already-picked rep. `all` bypasses the sales filter.
 */
export async function listAgents(all = false): Promise<AgentUser[]> {
  const data = await request('GET', '/admin/agents', {
    impersonate: false,
    ...(all ? { query: { all: '1' } } : {}),
  });
  return (data as { agents?: AgentUser[] }).agents ?? [];
}
