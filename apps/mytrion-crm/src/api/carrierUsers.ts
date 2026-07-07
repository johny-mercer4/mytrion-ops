/**
 * Carrier User Management (/v1/carrier-users) — login/password accounts for carrier
 * companies (audience 'customer'; consumed by the future Telegram mini-app + /client).
 * Profiles: 'owner' (fleet — all the carrier's cards; tied to carrierId/applicationId) and
 * 'driver' (child of an owner; tied to one card). Accounts can be provisioned on the
 * application id alone; populate-carrier back-fills the carrier id later.
 */
import { request } from './transport';

export type CarrierProfile = 'owner' | 'driver';

export interface CarrierUser {
  id: string;
  profile: CarrierProfile;
  carrierId: string | null;
  applicationId: string | null;
  parentUserId: string | null;
  cardId: string | null;
  companyName: string | null;
  login: string;
  agentName: string | null;
  agentZohoUserId: string | null;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCarrierUserInput {
  profile: CarrierProfile;
  carrierId?: string;
  applicationId?: string;
  parentUserId?: string;
  cardId?: string;
  companyName?: string;
  login: string;
  password: string;
  agentName?: string;
  agentZohoUserId?: string;
}

export async function listCarrierUsers(
  opts: { limit?: number; offset?: number; carrierId?: string; profile?: CarrierProfile } = {},
): Promise<{ users: CarrierUser[]; total: number }> {
  return (await request('GET', '/carrier-users', {
    query: {
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
      carrier_id: opts.carrierId,
      profile: opts.profile,
    },
  })) as { users: CarrierUser[]; total: number };
}

export async function createCarrierUser(input: CreateCarrierUserInput): Promise<{ user: CarrierUser }> {
  return (await request('POST', '/carrier-users', {
    body: {
      profile: input.profile,
      ...(input.carrierId ? { carrier_id: input.carrierId } : {}),
      ...(input.applicationId ? { application_id: input.applicationId } : {}),
      ...(input.parentUserId ? { parent_user_id: input.parentUserId } : {}),
      ...(input.cardId ? { card_id: input.cardId } : {}),
      ...(input.companyName ? { company_name: input.companyName } : {}),
      login: input.login,
      password: input.password,
      ...(input.agentName ? { agent_name: input.agentName } : {}),
      ...(input.agentZohoUserId ? { agent_zoho_user_id: input.agentZohoUserId } : {}),
    },
  })) as { user: CarrierUser };
}

export async function updateCarrierUser(
  id: string,
  patch: {
    carrierId?: string | null;
    applicationId?: string | null;
    cardId?: string | null;
    password?: string;
    status?: 'active' | 'disabled';
    agentName?: string | null;
  },
): Promise<{ user: CarrierUser }> {
  return (await request('POST', `/carrier-users/${encodeURIComponent(id)}`, {
    body: {
      ...(patch.carrierId !== undefined ? { carrier_id: patch.carrierId } : {}),
      ...(patch.applicationId !== undefined ? { application_id: patch.applicationId } : {}),
      ...(patch.cardId !== undefined ? { card_id: patch.cardId } : {}),
      ...(patch.password !== undefined ? { password: patch.password } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.agentName !== undefined ? { agent_name: patch.agentName } : {}),
    },
  })) as { user: CarrierUser };
}

/** A client from the DWH directory (octane.intm_zoho_deals) — what accounts are provisioned FROM. */
export interface DwhClient {
  companyName: string | null;
  stage: string | null;
  carrierId: string | null;
  applicationId: string | null;
  applicationDate: string | null;
  ownerZohoUserId: string | null;
}

/** Search the DWH client directory by company name, carrier id, or application id. */
export async function searchClients(q: string, limit = 15): Promise<DwhClient[]> {
  const data = (await request('GET', '/carrier-clients', {
    query: { q: q || undefined, limit },
  })) as { clients: DwhClient[] };
  return data.clients;
}

/** Back-fill the carrier id for EVERYTHING provisioned under an application id. */
export async function populateCarrier(
  applicationId: string,
  carrierId: string,
): Promise<{ updated: CarrierUser[]; count: number }> {
  return (await request('POST', '/carrier-users/populate-carrier', {
    body: { application_id: applicationId, carrier_id: carrierId },
  })) as { updated: CarrierUser[]; count: number };
}

export async function deleteCarrierUser(id: string): Promise<void> {
  await request('POST', `/carrier-users/${encodeURIComponent(id)}/delete`, { body: {} });
}
