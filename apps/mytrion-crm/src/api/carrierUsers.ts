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

// ── Registration links (Telegram mini-app onboarding) ────────────────────────────
// An admin generates a Telegram deep-link here (no login/password — the bot's mini-app handles
// sign-in); the carrier opens it and registers. An owner then hands out per-card driver links from
// inside the app. The tree below renders who actually FINISHED registering.

export interface DwhOperator {
  servercrmUserId: string | null;
  username: string | null;
  carrierId: string | null;
  companyName: string | null;
  phoneNumber: string | null;
  ownerFirstName: string | null;
  ownerLastName: string | null;
  activated: boolean | null;
  enabled: boolean | null;
}

/** Search servercrm operator logins by carrier id or company name. */
export async function searchOperators(q: string, limit = 15): Promise<DwhOperator[]> {
  const data = (await request('GET', '/carrier-users/dwh-operators', {
    query: { q: q || undefined, limit },
  })) as { operators: DwhOperator[] };
  return data.operators;
}

/** A carrier's active fuel card — what a driver account binds TO (no driver name lives on it). */
export interface DwhCard {
  cardId: string | null;
  cardNumber: string | null;
  cardType: string | null;
  status: string | null;
  balance: string | null;
}

/** List a carrier's active fuel cards. */
export async function listCards(carrierId: string, limit = 100): Promise<DwhCard[]> {
  const data = (await request('GET', '/carrier-users/dwh-cards', {
    query: { carrier_id: carrierId, limit },
  })) as { cards: DwhCard[] };
  return data.cards;
}

export type CarrierCompanyType = 'owner-operator' | 'fleet-manager';

/** A Telegram deep-link invite — owner or driver, no login/password, redeemed by the bot's mini-app. */
export interface CarrierInvitation {
  id: string;
  profile: CarrierProfile;
  carrierId: string | null;
  applicationId: string | null;
  companyName: string | null;
  cardId: string | null;
  driverName: string | null;
  companyType: CarrierCompanyType | null;
  cardCount: number | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  status: 'pending' | 'redeemed' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export async function createCarrierInvitation(input: {
  profile: CarrierProfile;
  carrierId?: string;
  applicationId?: string;
  companyName?: string;
  cardId?: string;
  driverName?: string;
  agentName?: string;
  agentZohoUserId?: string;
}): Promise<{ invite: CarrierInvitation; inviteUrl: string }> {
  return (await request('POST', '/carrier-invitations', {
    body: {
      profile: input.profile,
      ...(input.carrierId ? { carrier_id: input.carrierId } : {}),
      ...(input.applicationId ? { application_id: input.applicationId } : {}),
      ...(input.companyName ? { company_name: input.companyName } : {}),
      ...(input.cardId ? { card_id: input.cardId } : {}),
      ...(input.driverName ? { driver_name: input.driverName } : {}),
      ...(input.agentName ? { agent_name: input.agentName } : {}),
      ...(input.agentZohoUserId ? { agent_zoho_user_id: input.agentZohoUserId } : {}),
    },
  })) as { invite: CarrierInvitation; inviteUrl: string };
}

/** A company/driver who actually completed sign-in in the Telegram mini-app — distinct from a
 * sent-but-maybe-never-opened invite (CarrierInvitation) and from the login-based CarrierUser. */
export interface RegisteredCompany {
  id: string;
  profile: CarrierProfile;
  carrierId: string | null;
  applicationId: string | null;
  companyName: string | null;
  cardId: string | null;
  driverName: string | null;
  companyType: CarrierCompanyType | null;
  cardCount: number | null;
  telegramUserId: string;
  telegramUsername: string | null;
  createdAt: string;
}

export async function listRegisteredCompanies(): Promise<RegisteredCompany[]> {
  const data = (await request('GET', '/carrier-registrations')) as { registrations: RegisteredCompany[] };
  return data.registrations;
}
