/**
 * Resolve a private Telegram sender to their carrier through the mini-app registration.
 * The gateway never accepts a carrier from Telegram text or model output; Mytrion returns it from
 * the active owner/manager registration. Short positive/negative caching limits backend chatter
 * while ensuring revocation takes effect quickly. Backend failure is fail-closed.
 */
import { config } from './config.js';

export interface DmAccess {
  carrierId: string;
  profile: 'owner' | 'manager';
  companyName: string | null;
}

const REFRESH_MS = 30_000;
const cache = new Map<number, { at: number; access: DmAccess | null }>();

function validAccess(value: unknown): value is DmAccess {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['carrierId'] === 'string' &&
    v['carrierId'].length > 0 &&
    (v['profile'] === 'owner' || v['profile'] === 'manager') &&
    (v['companyName'] === null || typeof v['companyName'] === 'string')
  );
}

export async function dmAccessFor(userId: number): Promise<DmAccess | null> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && now - hit.at <= REFRESH_MS) return hit.access;
  try {
    const res = await fetch(
      `${config.octaneBase}/v1/support-bot/dm-access?telegramUserId=${encodeURIComponent(String(userId))}`,
      {
        headers: { Authorization: `Bearer ${config.octaneKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { access?: unknown };
    const access = validAccess(data.access) ? data.access : null;
    cache.set(userId, { at: now, access });
    return access;
  } catch {
    return null;
  }
}
