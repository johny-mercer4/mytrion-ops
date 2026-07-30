import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface SupportBotDmAccess {
  carrierId: string;
  profile: 'owner' | 'manager';
  companyName: string | null;
}

/**
 * Private agent chat is intentionally narrower than group access: only an active owner or manager
 * may resolve a carrier from Telegram identity. Drivers continue through their carrier's mapped
 * support group, where the same registration still scopes them to their own card.
 */
export async function resolveSupportBotDmAccess(
  ctx: TenantContext,
  telegramUserId: string,
): Promise<SupportBotDmAccess | null> {
  const registration = await registeredMiniAppCompanyRepo.findActiveByTelegramUserId(
    ctx,
    telegramUserId,
  );
  if (
    !registration?.carrierId ||
    (registration.profile !== 'owner' && registration.profile !== 'manager')
  ) {
    return null;
  }
  return {
    carrierId: registration.carrierId,
    profile: registration.profile,
    companyName: registration.companyName,
  };
}
