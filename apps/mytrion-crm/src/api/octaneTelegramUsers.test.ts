import { describe, expect, it } from 'vitest';
import {
  matchesOctaneTelegramUser,
  type OctaneTelegramUserRow,
} from './octaneTelegramUsers';

const ada: OctaneTelegramUserRow = {
  userName: 'Ada Lovelace',
  zohoUserId: '42',
  telegramUserId: '99',
  telegramUsername: 'ada',
  lastLoginAt: '2026-08-13T16:00:00.000Z',
};

describe('matchesOctaneTelegramUser', () => {
  it('matches name, zoho id, telegram id, and handle', () => {
    expect(matchesOctaneTelegramUser(ada, '')).toBe(true);
    expect(matchesOctaneTelegramUser(ada, 'lovelace')).toBe(true);
    expect(matchesOctaneTelegramUser(ada, '42')).toBe(true);
    expect(matchesOctaneTelegramUser(ada, '99')).toBe(true);
    expect(matchesOctaneTelegramUser(ada, 'ADA')).toBe(true);
    expect(matchesOctaneTelegramUser(ada, 'nope')).toBe(false);
  });
});
