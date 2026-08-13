/**
 * Admin → Octane Telegram Users. Rows come from horizon_worker_telegram_links.
 * lastLoginAt is the last Mini App bind after Zoho sign-in (updated_at).
 */
import { request } from './transport';

export interface OctaneTelegramUserRow {
  userName: string | null;
  zohoUserId: string;
  telegramUserId: string;
  telegramUsername: string | null;
  lastLoginAt: string;
}

export async function listOctaneTelegramUsers(): Promise<OctaneTelegramUserRow[]> {
  const res = (await request('GET', '/horizon/telegram/links', {
    impersonate: false,
  })) as { items: OctaneTelegramUserRow[] };
  return res.items;
}

export function matchesOctaneTelegramUser(row: OctaneTelegramUserRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.userName, row.zohoUserId, row.telegramUserId, row.telegramUsername]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}
