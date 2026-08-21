/**
 * Carrier User Management — Telegram registration links, registered roster, password-reset queue.
 * Profiles: 'owner' / 'manager' (fleet) and 'driver' (one card).
 */
import { request } from './transport';

/** 'manager' has owner-equivalent access — the invite form treats owner + manager alike (no card). */
export type CarrierProfile = 'owner' | 'manager' | 'driver';

/** A client from the DWH directory (octane.intm_zoho_deals) — what invites are generated FROM. */
export interface DwhClient {
  companyName: string | null;
  stage: string | null;
  carrierId: string | null;
  applicationId: string | null;
  applicationDate: string | null;
  ownerZohoUserId: string | null;
  /** Deal owner's name — the SALES AGENT the client should see everywhere. */
  ownerName: string | null;
}

/** Search the DWH client directory by company name (punctuation-insensitive), carrier id, application id, or phone. */
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

/** Register the currently authenticated Sales agent's Telegram mini-app identity. When a carrier
 * is supplied the mini-app opens that company after registration, but the backend still verifies
 * it against the agent's fresh active roster before returning it. */
export async function createSalesAgentMiniAppInvitation(
  carrierId?: string,
): Promise<{ invitationId: string; inviteUrl: string; expiresAt: string }> {
  return (await request('POST', '/carrier/mini-app/sales-agent-invitations', {
    body: carrierId ? { carrier_id: carrierId } : {},
  })) as { invitationId: string; inviteUrl: string; expiresAt: string };
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
  /** Octane sales agent copied from the invite that registered this company. */
  agentName: string | null;
  agentZohoUserId: string | null;
  status: 'active' | 'revoked';
  revokedAt: string | null;
  createdAt: string;
}

export async function listRegisteredCompanies(): Promise<RegisteredCompany[]> {
  const data = (await request('GET', '/carrier-registrations')) as { registrations: RegisteredCompany[] };
  return data.registrations;
}

export interface PasswordResetRequest {
  id: string;
  carrierUserId: string;
  registrationId: string | null;
  carrierId: string | null;
  companyName: string | null;
  login: string;
  profile: CarrierProfile;
  agentZohoUserId: string | null;
  agentName: string | null;
  status: 'pending' | 'resolved' | 'cancelled';
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Active owner + managers + drivers + pending password resets for one carrier (Sales Manage). */
export async function getCarrierRegistrations(
  carrierId: string,
  signal?: AbortSignal,
): Promise<{
  owner: RegisteredCompany | null;
  managers: RegisteredCompany[];
  drivers: RegisteredCompany[];
  pendingResets: PasswordResetRequest[];
}> {
  const data = (await request('GET', '/carrier-registrations/for-carrier', {
    query: { carrier_id: carrierId },
    ...(signal ? { signal } : {}),
  })) as {
    owner: RegisteredCompany | null;
    managers?: RegisteredCompany[];
    drivers: RegisteredCompany[];
    pendingResets?: PasswordResetRequest[];
  };
  return {
    owner: data.owner,
    managers: data.managers ?? [],
    drivers: data.drivers,
    pendingResets: data.pendingResets ?? [],
  };
}

/** Pending forgot-password queue. Admin → all; Sales agent → own clients (or pass carrier_id). */
export async function listPasswordResets(opts?: {
  carrierId?: string;
  signal?: AbortSignal;
}): Promise<PasswordResetRequest[]> {
  const data = (await request('GET', '/carrier/mini-app/password-resets', {
    ...(opts?.carrierId ? { query: { carrier_id: opts.carrierId } } : {}),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })) as { resets?: PasswordResetRequest[] };
  return data.resets ?? [];
}

export async function resolvePasswordReset(id: string, password: string): Promise<void> {
  await request('POST', `/carrier/mini-app/password-resets/${encodeURIComponent(id)}/resolve`, {
    body: { password },
  });
}

/** Soft-disable a registered owner/driver — reversible, frees their card for reassignment. */
/** Support-bot chat map: which Telegram GROUP answers for which carrier. */
export interface SupportBotChat {
  chatId: string;
  carrierId: string;
}

export async function listSupportBotChats(): Promise<SupportBotChat[]> {
  const res = (await request('GET', '/support-bot/chat-map')) as { chats?: SupportBotChat[] };
  return res.chats ?? [];
}

/** Admin-only upstream: set/re-point the STATIC group mapping for a carrier (auto-bind's manual
 * override — e.g. the group existed before any owner registration, or a re-point is needed). */
export async function setSupportBotChat(chatId: string, carrierId: string): Promise<void> {
  await request('POST', '/support-bot/chat-map', { body: { chatId, carrierId } });
}

export async function revokeRegistration(id: string): Promise<void> {
  await request('POST', `/carrier-registrations/${encodeURIComponent(id)}/revoke`, { body: {} });
}
