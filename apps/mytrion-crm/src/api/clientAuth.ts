/**
 * Carrier-client sign-in (/v1/auth/client/login) + its own session store — deliberately
 * SEPARATE from the worker session (session.ts): a carrier login must never be mistaken
 * for a worker session by the app shell, and vice versa.
 */
import { request } from './transport';

export interface ClientIdentity {
  carrierUserId: string;
  /** 'owner' (fleet — all cards) or 'driver' (one card, child of an owner). */
  clientProfile: 'owner' | 'driver';
  carrierId?: string;
  applicationId?: string;
  cardId?: string;
  parentUserId?: string;
  login?: string;
}

export interface ClientSession {
  accessToken: string;
  refreshToken: string;
  client: ClientIdentity;
}

const KEY = 'octane.clientSession.v1';

export async function clientLogin(login: string, password: string): Promise<ClientSession> {
  const data = (await request('POST', '/auth/client/login', {
    body: { login, password },
  })) as ClientSession;
  setClientSession(data);
  return data;
}

export function getClientSession(): ClientSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ClientSession) : null;
  } catch {
    return null;
  }
}

export function setClientSession(session: ClientSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

export function clearClientSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
