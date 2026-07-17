/**
 * Carrier User Management — Telegram registration links (no login/password; the bot's mini-app
 * handles sign-in). Profiles: 'owner' (fleet — all the carrier's cards; tied to
 * carrierId/applicationId) and 'driver' (tied to one card).
 */
import { request } from './transport';

export type CarrierProfile = 'owner' | 'driver';

/** A client from the DWH directory (octane.intm_zoho_deals) — what invites are generated FROM. */
export interface DwhClient {
  companyName: string | null;
  stage: string | null;
  carrierId: string | null;
  applicationId: string | null;
  applicationDate: string | null;
  ownerZohoUserId: string | null;
}

/** Search the DWH client directory by company name, carrier id, or application id. */
export async function searchClients(q: string, limit = 15, signal?: AbortSignal): Promise<DwhClient[]> {
  const data = (await request('GET', '/carrier-clients', {
    query: { q: q || undefined, limit },
    ...(signal ? { signal } : {}),
  })) as { clients: DwhClient[] };
  return data.clients;
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
export async function searchOperators(q: string, limit = 15, signal?: AbortSignal): Promise<DwhOperator[]> {
  const data = (await request('GET', '/carrier-users/dwh-operators', {
    query: { q: q || undefined, limit },
    ...(signal ? { signal } : {}),
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
export async function listCards(carrierId: string, limit = 100, signal?: AbortSignal): Promise<DwhCard[]> {
  const data = (await request('GET', '/carrier-users/dwh-cards', {
    query: { carrier_id: carrierId, limit },
    ...(signal ? { signal } : {}),
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
  status: 'pending' | 'redeemed' | 'expired' | 'cancelled';
  expiresAt: string;
  createdAt: string;
  /** The Telegram deep link — the admin can re-copy it while the invite is still pending. */
  inviteUrl: string;
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
  /** Invite lifetime in hours — omit for the backend's 7-day default. */
  ttlHours?: number;
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
      ...(input.ttlHours !== undefined ? { ttl_hours: input.ttlHours } : {}),
    },
  })) as { invite: CarrierInvitation; inviteUrl: string };
}

/** Every invite (pending/redeemed/cancelled) — distinct from RegisteredCompany, which is who
 * actually finished signing in. */
export async function listInvitations(): Promise<CarrierInvitation[]> {
  const data = (await request('GET', '/carrier-invitations')) as { invitations: CarrierInvitation[] };
  return data.invitations;
}

/** Cancel a still-pending invite. */
export async function cancelInvitation(id: string): Promise<void> {
  await request('POST', `/carrier-invitations/${encodeURIComponent(id)}/cancel`, { body: {} });
}

/** A company/driver who actually completed sign-in in the Telegram mini-app — distinct from a
 * sent-but-maybe-never-opened invite (CarrierInvitation). */
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
  status: 'active' | 'revoked';
  revokedAt: string | null;
  createdAt: string;
}

export async function listRegisteredCompanies(): Promise<RegisteredCompany[]> {
  const data = (await request('GET', '/carrier-registrations')) as { registrations: RegisteredCompany[] };
  return data.registrations;
}

/** Active owner + drivers for one carrier (Sales Client Manage / driver gating). */
export async function getCarrierRegistrations(
  carrierId: string,
  signal?: AbortSignal,
): Promise<{ owner: RegisteredCompany | null; drivers: RegisteredCompany[] }> {
  return (await request('GET', '/carrier-registrations/for-carrier', {
    query: { carrier_id: carrierId },
    ...(signal ? { signal } : {}),
  })) as { owner: RegisteredCompany | null; drivers: RegisteredCompany[] };
}

/** Soft-disable a registered owner/driver — reversible, frees their card for reassignment. */
export async function revokeRegistration(id: string): Promise<void> {
  await request('POST', `/carrier-registrations/${encodeURIComponent(id)}/revoke`, { body: {} });
}
