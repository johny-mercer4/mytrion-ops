import { AppError } from '../../lib/errors.js';

/** The advisory-locked repo calls this before enabling a new Telegram group mapping. */
export function assertSupportBotGroupCapacity(
  alreadyEnabled: boolean,
  enabledCount: number,
  maxGroups: number,
): void {
  if (alreadyEnabled || enabledCount < maxGroups) return;
  throw new AppError(`Support-bot group limit (${maxGroups}) reached`, {
    statusCode: 409,
    code: 'SUPPORT_BOT_GROUP_LIMIT_REACHED',
    expose: true,
  });
}
