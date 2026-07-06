/**
 * Carrier User Management (/v1/carrier-users) — login/password accounts for carrier
 * companies (audience 'customer'; consumed by the future Telegram mini-app + /client).
 */
import { request } from './transport';

export interface CarrierUser {
  id: string;
  carrierId: string;
  applicationId: string | null;
  login: string;
  agentName: string | null;
  agentZohoUserId: string | null;
  profile: string | null;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCarrierUserInput {
  carrierId: string;
  applicationId?: string;
  login: string;
  password: string;
  agentName?: string;
  agentZohoUserId?: string;
  profile?: string;
}

export async function listCarrierUsers(
  opts: { limit?: number; offset?: number; carrierId?: string } = {},
): Promise<{ users: CarrierUser[]; total: number }> {
  return (await request('GET', '/carrier-users', {
    query: {
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      carrier_id: opts.carrierId,
    },
  })) as { users: CarrierUser[]; total: number };
}

export async function createCarrierUser(input: CreateCarrierUserInput): Promise<{ user: CarrierUser }> {
  return (await request('POST', '/carrier-users', {
    body: {
      carrier_id: input.carrierId,
      ...(input.applicationId ? { application_id: input.applicationId } : {}),
      login: input.login,
      password: input.password,
      ...(input.agentName ? { agent_name: input.agentName } : {}),
      ...(input.agentZohoUserId ? { agent_zoho_user_id: input.agentZohoUserId } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
    },
  })) as { user: CarrierUser };
}

export async function updateCarrierUser(
  id: string,
  patch: { password?: string; status?: 'active' | 'disabled'; agentName?: string | null; profile?: string | null },
): Promise<{ user: CarrierUser }> {
  return (await request('POST', `/carrier-users/${encodeURIComponent(id)}`, {
    body: {
      ...(patch.password !== undefined ? { password: patch.password } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.agentName !== undefined ? { agent_name: patch.agentName } : {}),
      ...(patch.profile !== undefined ? { profile: patch.profile } : {}),
    },
  })) as { user: CarrierUser };
}

export async function deleteCarrierUser(id: string): Promise<void> {
  await request('POST', `/carrier-users/${encodeURIComponent(id)}/delete`, { body: {} });
}
