/**
 * Horizon worker Telegram link — bind planning only.
 *
 * The Mini App bind is Zoho Bearer + HMAC-verified initData. Webhook /start never creates a
 * worker identity; it only refreshes chat_id/username on a row that already exists.
 */
import { RBACError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface HorizonTelegramLinkKeys {
  id: string;
  zohoUserId: string;
  telegramUserId: string;
}

export type HorizonTelegramBindPlan =
  | { action: 'insert' }
  | { action: 'update'; id: string }
  | { action: 'conflict'; code: string; message: string };

/**
 * Decide insert vs update vs conflict from tenant-scoped lookups.
 *
 * Cross-tenant isolation is the repo's job (every lookup is already filtered by ctx.tenantId).
 * This planner only prevents stealing another worker's Telegram id *inside* that tenant.
 */
export function planHorizonTelegramWebAppBind(input: {
  byZoho: HorizonTelegramLinkKeys | undefined;
  byTelegram: HorizonTelegramLinkKeys | undefined;
  zohoUserId: string;
}): HorizonTelegramBindPlan {
  const { byZoho, byTelegram, zohoUserId } = input;

  if (byTelegram && byTelegram.zohoUserId !== zohoUserId) {
    return {
      action: 'conflict',
      code: 'TELEGRAM_LINKED_TO_OTHER_WORKER',
      message: 'This Telegram account is already linked to another worker',
    };
  }

  if (byZoho && byTelegram && byZoho.id !== byTelegram.id) {
    return {
      action: 'conflict',
      code: 'HORIZON_TELEGRAM_LINK_INCONSISTENT',
      message: 'This worker already has a Telegram link that does not match',
    };
  }

  if (byZoho) return { action: 'update', id: byZoho.id };
  if (byTelegram) return { action: 'update', id: byTelegram.id };
  return { action: 'insert' };
}

/** Zoho worker id from a verified internal session. Never taken from the request body. */
export function zohoUserIdFromContext(ctx: TenantContext): string {
  if (ctx.audience !== 'internal') {
    throw new RBACError('Horizon Telegram is internal-only');
  }
  if (!ctx.sessionVerified || !ctx.userId.startsWith('zoho:')) {
    throw new RBACError('Only Zoho-signed-in workers can use Horizon Telegram');
  }
  return ctx.userId.slice('zoho:'.length);
}
