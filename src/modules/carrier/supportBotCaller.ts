import { z } from 'zod';
import { env } from '../../config/env.js';
import type { RegisteredMiniAppCompany } from '../../db/schema/index.js';
import { sendPlainReply } from '../../integrations/telegramCarrierBot.js';
import { AppError } from '../../lib/errors.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { takeToken } from '../security/rateBucket.js';
import { listLiveCardRows } from './liveCards.js';

export const supportBotCallerSchema = z.object({
  telegramUserId: z.string().min(1).max(40),
  carrierId: z.string().min(1).max(40),
});

export type SupportBotRole = 'owner' | 'driver';

/** Resolve the sender inside the authenticated request tenant; every mismatch fails closed. */
export async function resolveSupportBotCaller(
  ctx: TenantContext,
  carrierId: string,
  telegramUserId: string,
): Promise<{ registration: RegisteredMiniAppCompany; role: SupportBotRole }> {
  const registration =
    await registeredMiniAppCompanyRepo.findActiveByTelegramUserId(
      ctx,
      telegramUserId,
    );
  if (!registration) {
    throw new AppError('This user is not registered in the mini-app yet.', {
      statusCode: 404,
      code: 'SUPPORT_BOT_NOT_REGISTERED',
      expose: true,
    });
  }
  if (String(registration.carrierId ?? '') !== carrierId) {
    throw new AppError('This user does not belong to this group’s company.', {
      statusCode: 403,
      code: 'SUPPORT_BOT_CARRIER_MISMATCH',
      expose: true,
    });
  }
  return {
    registration,
    role: registration.profile === 'driver' ? 'driver' : 'owner',
  };
}

/** Resolve spoken last digits against live EFS rows; ambiguity never guesses. */
export async function resolveSupportBotCardByLast6(
  carrierId: string,
  last6: string,
): Promise<string> {
  const digits = last6.replace(/\D/g, '');
  if (digits.length < 4) {
    throw new AppError('Give at least the last 4-6 digits of the card.', {
      statusCode: 400,
      code: 'SUPPORT_BOT_CARD_DIGITS',
      expose: true,
    });
  }
  const cards = await listLiveCardRows(carrierId);
  const matches = cards
    .map((row) => String(row['card_number'] ?? ''))
    .filter((cardNumber) => cardNumber && cardNumber.endsWith(digits));
  const match = matches[0];
  if (matches.length === 1 && match) return match;
  throw new AppError(
    matches.length === 0
      ? 'No card on this account ends with those digits.'
      : 'More than one card ends with those digits — give the last 6.',
    {
      statusCode: matches.length === 0 ? 404 : 409,
      code:
        matches.length === 0
          ? 'SUPPORT_BOT_CARD_NOT_FOUND'
          : 'SUPPORT_BOT_CARD_AMBIGUOUS',
      expose: true,
    },
  );
}

export function requireSupportBotWrites(): void {
  if (!env.FF_MINIAPP_CARD_WRITES_ENABLED) {
    throw new AppError('Card actions are not enabled yet.', {
      statusCode: 503,
      code: 'MINIAPP_WRITES_DISABLED',
      expose: true,
    });
  }
}

export function takeSupportBotWrite(carrierId: string): void {
  if (!takeToken(`support-bot-write:${carrierId}`, 5)) {
    throw new AppError('Too many card actions right now — try again in a minute.', {
      statusCode: 429,
      code: 'SUPPORT_BOT_RATE_LIMITED',
      expose: true,
    });
  }
}

export async function sendSupportBotPrivate(
  registration: RegisteredMiniAppCompany,
  text: string,
): Promise<void> {
  await sendPlainReply(
    registration.telegramChatId ?? registration.telegramUserId,
    text,
  );
}
