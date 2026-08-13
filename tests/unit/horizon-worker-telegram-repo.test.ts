/**
 * Horizon worker Telegram links — bind planner + repo tenant isolation (CLAUDE.md rule 9).
 *
 * Repos are the only isolation boundary (no FKs, no RLS). Tests render the SQL drizzle builds
 * and assert every read/write is bound to ctx.tenantId. A missing tenant filter would let one
 * tenant steal another's Telegram id or attach a Zoho worker they do not own.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planHorizonTelegramWebAppBind } from '../../src/modules/horizon/telegramLink.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

interface RecordedCall {
  method: string;
  args: unknown[];
}

let calls: RecordedCall[] = [];
let resultQueue: unknown[] = [];

function makeBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  for (const method of [
    'select',
    'from',
    'where',
    'limit',
    'insert',
    'values',
    'returning',
    'update',
    'set',
  ]) {
    builder[method] = record(method);
  }
  builder.transaction = (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(builder);
  builder.then = (resolve: (value: unknown) => unknown) => {
    const next = resultQueue.length > 0 ? resultQueue.shift() : [];
    return Promise.resolve(next).then(resolve);
  };
  return builder;
}

vi.mock('../../src/db/client.js', () => ({ db: makeBuilder() }));

import { horizonWorkerTelegramRepo } from '../../src/repos/horizonWorkerTelegramRepo.js';

const dialect = new PgDialect();

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'zoho:1',
  role: 'worker',
  scopes: [],
  audience: 'internal',
  departments: [],
  allDepartmentAccess: false,
  requestId: 'test',
});

const ACME = ctx('tenant_acme');
const RIVAL = ctx('tenant_rival');

function renderedWheres(): Array<{ sql: string; params: unknown[] }> {
  return calls
    .filter((c) => c.method === 'where')
    .map((c) => {
      const query = dialect.sqlToQuery(c.args[0] as never);
      return { sql: query.sql, params: query.params as unknown[] };
    });
}

function writtenPayloads(): Array<Record<string, unknown>> {
  return calls
    .filter((c) => c.method === 'values' || c.method === 'set')
    .map((c) => c.args[0] as Record<string, unknown>);
}

beforeEach(() => {
  calls = [];
  resultQueue = [];
});

const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  tenantId: 'tenant_acme',
  zohoUserId: 'zoho-ada',
  telegramUserId: '99',
};

describe('planHorizonTelegramWebAppBind', () => {
  it('inserts when neither zoho nor telegram is linked in this tenant', () => {
    expect(
      planHorizonTelegramWebAppBind({
        byZoho: undefined,
        byTelegram: undefined,
        zohoUserId: 'zoho-ada',
      }),
    ).toEqual({ action: 'insert' });
  });

  it('updates the zoho row (rebind telegram) when that worker already has a link', () => {
    expect(
      planHorizonTelegramWebAppBind({
        byZoho: ROW,
        byTelegram: undefined,
        zohoUserId: 'zoho-ada',
      }),
    ).toEqual({ action: 'update', id: ROW.id });
  });

  it('refuses to steal a telegram id already bound to another zoho user', () => {
    const plan = planHorizonTelegramWebAppBind({
      byZoho: undefined,
      byTelegram: { ...ROW, zohoUserId: 'zoho-other' },
      zohoUserId: 'zoho-ada',
    });
    expect(plan).toEqual({
      action: 'conflict',
      code: 'TELEGRAM_LINKED_TO_OTHER_WORKER',
      message: 'This Telegram account is already linked to another worker',
    });
  });

  it('conflicts when zoho and telegram point at two different rows', () => {
    const plan = planHorizonTelegramWebAppBind({
      byZoho: ROW,
      byTelegram: { ...ROW, id: '22222222-2222-2222-2222-222222222222', zohoUserId: 'zoho-ada' },
      zohoUserId: 'zoho-ada',
    });
    expect(plan.action).toBe('conflict');
  });
});

describe('every Horizon telegram-link read is bound to the caller tenant', () => {
  it('findByZohoUserId filters on tenant_id and the zoho id', async () => {
    await horizonWorkerTelegramRepo.findByZohoUserId(ACME, 'zoho-ada');
    const wheres = renderedWheres();
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) {
      expect(w.sql).toContain('"tenant_id"');
      expect(w.sql).toContain('"zoho_user_id"');
      expect(w.params).toContain('tenant_acme');
      expect(w.params).toContain('zoho-ada');
      expect(w.params).not.toContain('tenant_rival');
    }
  });

  it('findByTelegramUserId filters on tenant_id and the telegram id', async () => {
    await horizonWorkerTelegramRepo.findByTelegramUserId(ACME, '99');
    const wheres = renderedWheres();
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) {
      expect(w.sql).toContain('"tenant_id"');
      expect(w.sql).toContain('"telegram_user_id"');
      expect(w.params).toContain('tenant_acme');
      expect(w.params).toContain('99');
      expect(w.params).not.toContain('tenant_rival');
    }
  });

  it('the same telegram lookup from another tenant binds that tenant instead', async () => {
    await horizonWorkerTelegramRepo.findByTelegramUserId(ACME, '99');
    const acme = renderedWheres();
    calls = [];
    await horizonWorkerTelegramRepo.findByTelegramUserId(RIVAL, '99');
    const rival = renderedWheres();
    expect(acme.every((w) => w.params.includes('tenant_acme'))).toBe(true);
    expect(rival.every((w) => w.params.includes('tenant_rival'))).toBe(true);
    expect(rival.some((w) => w.params.includes('tenant_acme'))).toBe(false);
  });
});

describe('Horizon telegram-link writes cannot cross tenants', () => {
  it('upsert stamps tenantId from the context (callers cannot supply one)', async () => {
    resultQueue = [[], [], [{ ...ROW, linkedVia: 'webapp_bind', status: 'active' }]];
    await horizonWorkerTelegramRepo.upsertWebAppBind(ACME, {
      zohoUserId: 'zoho-ada',
      telegramUserId: '99',
      telegramChatId: '99',
      telegramUsername: 'ada',
    });
    const inserted = writtenPayloads().find((p) => p.tenantId !== undefined);
    expect(inserted?.tenantId).toBe('tenant_acme');
    expect(inserted?.zohoUserId).toBe('zoho-ada');
    expect(inserted?.telegramUserId).toBe('99');
  });

  it('upsert update WHERE is scoped by tenant id', async () => {
    resultQueue = [[ROW], [], [{ ...ROW, telegramUserId: '100' }]];
    await horizonWorkerTelegramRepo.upsertWebAppBind(ACME, {
      zohoUserId: 'zoho-ada',
      telegramUserId: '100',
      telegramChatId: '100',
    });
    const updateWheres = renderedWheres().filter((w) => w.sql.includes('"id"'));
    expect(updateWheres.length).toBeGreaterThan(0);
    for (const w of updateWheres) {
      expect(w.sql).toContain('"tenant_id"');
      expect(w.params).toContain('tenant_acme');
      expect(w.params).not.toContain('tenant_rival');
    }
  });

  it('bot /start refresh never writes zoho_user_id and always filters by tenant + telegram id', async () => {
    resultQueue = [[{ ...ROW, telegramChatId: '99' }]];
    await horizonWorkerTelegramRepo.refreshFromBotStart(ACME, {
      telegramUserId: '99',
      telegramChatId: '99',
      telegramUsername: 'ada',
    });
    const set = writtenPayloads()[0];
    expect(set).toBeDefined();
    expect(set).not.toHaveProperty('zohoUserId');
    expect(set).not.toHaveProperty('tenantId');
    const wheres = renderedWheres();
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) {
      expect(w.sql).toContain('"tenant_id"');
      expect(w.sql).toContain('"telegram_user_id"');
      expect(w.sql).toContain('"status"');
      expect(w.params).toContain('tenant_acme');
      expect(w.params).toContain('99');
      expect(w.params).toContain('active');
      expect(w.params).not.toContain('tenant_rival');
    }
  });
});
