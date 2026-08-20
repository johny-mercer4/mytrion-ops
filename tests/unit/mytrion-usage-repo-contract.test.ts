import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn(async (_query: unknown) => []) }));
vi.mock('../../src/db/client.js', () => ({ db: { execute } }));

import { resolveMytrionUsageWindow } from '../../src/modules/analytics/mytrionUsageDates.js';
import {
  mytrionUsageFactsRepo,
  normalizeTicketBreakdownLabel,
} from '../../src/repos/mytrionUsageFactsRepo.js';
import { mytrionUsageTelemetryRepo } from '../../src/repos/mytrionUsageTelemetryRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const dialect = new PgDialect();
const ctx = { tenantId: 'tenant-a' } as TenantContext;
const window = resolveMytrionUsageWindow({ preset: 'custom', from: '2026-08-01', to: '2026-08-02' });

beforeEach(() => vi.clearAllMocks());

describe('Mytrion usage repository security contract', () => {
  it('deduplicates AI turns by run and selects no sensitive tool payload columns', async () => {
    await mytrionUsageFactsRepo.listAiUsage(ctx, window);
    const rendered = execute.mock.calls.map((call) => dialect.sqlToQuery(call[0] as never));
    for (const query of rendered) expect(query.params).toContain('tenant-a');
    expect(rendered[0]?.sql).toMatch(/distinct on \(audit\.agent_run_id\)/i);
    expect(rendered[0]?.sql).toMatch(/audit\.audience = 'internal'/i);
    const allSql = rendered.map((query) => query.sql).join('\n');
    expect(allSql).not.toMatch(/arguments|result|prompt_tokens|user_agent|\bip\b/i);
  });

  it('requires internal, non-impersonated audit actors', async () => {
    await mytrionUsageFactsRepo.listAuditUsage(ctx, window);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.params).toContain('tenant-a');
    expect(query.sql).toMatch(/audience = 'internal'/i);
    expect(query.sql).toMatch(/impersonator_user_id is null/i);
    expect(query.sql).toMatch(/max\(created_at\) filter[\s\S]+action not in/i);
  });

  it('tenant-scopes authoritative outcomes and tightly excludes View-as attribution', async () => {
    await mytrionUsageFactsRepo.listCalls(ctx, window);
    await mytrionUsageFactsRepo.listCompletedTasks(ctx, window);
    await mytrionUsageFactsRepo.listAutomations(ctx, window);
    const rendered = execute.mock.calls.map((call) => dialect.sqlToQuery(call[0] as never));
    for (const query of rendered) {
      expect(query.params).toContain('tenant-a');
      expect(query.sql).toMatch(/tenant_id/i);
    }
    expect(rendered[0]?.sql).toMatch(/audit\.impersonator_user_id is null/i);
    expect(rendered[0]?.sql).toMatch(/calls\.created_at/i);
    expect(rendered[0]?.sql).not.toMatch(/calls\.call_time/i);
    expect(rendered[0]?.sql).toMatch(/audit\.detail->>'kind' = 'ended'/i);
    expect(rendered[0]?.sql).toMatch(/audit\.created_at >= calls\.created_at - interval '2 minutes'/i);
    expect(rendered[1]?.sql).toMatch(/audit\.impersonator_user_id is null/i);
    expect(rendered[1]?.sql).toMatch(/audit\.detail->>'to' = 'completed'/i);
    expect(rendered[1]?.sql).toMatch(/audit\.created_at >= event\.occurred_at/i);
    expect(rendered.slice(2).every((query) => /impersonator_user_id is null/i.test(query.sql) || /actor_user_id is null/i.test(query.sql))).toBe(true);
  });

  it('groups coded ticket labels by stable code and never selects escalation reasons', async () => {
    expect(normalizeTicketBreakdownLabel('C-30 | Card issue')).toEqual({ key: 'c-30', label: 'C-30' });
    expect(normalizeTicketBreakdownLabel('C-30 | Replacement card')).toEqual({ key: 'c-30', label: 'C-30' });
    await mytrionUsageFactsRepo.listTicketBreakdown(ctx, window);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.sql).not.toMatch(/detail->>'reason'/i);
    expect(query.sql).toContain('Escalation created');
  });

  it('derives automation coverage only from attributable organic Sales runs', async () => {
    await mytrionUsageFactsRepo.sourceSpans(ctx);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.sql).toMatch(/source_mytrion = 'sales'/i);
    expect(query.sql).toMatch(/lower\(actor_user_id\) like 'zoho:%'/i);
    expect(query.sql).toMatch(/impersonator_user_id is null/i);
  });

  it('classifies system and bare automation actors as unattributed', async () => {
    await mytrionUsageFactsRepo.listAutomations(ctx, window);
    const rendered = execute.mock.calls.map((call) => dialect.sqlToQuery(call[0] as never));
    expect(rendered[0]?.sql).toMatch(/lower\(actor_user_id\) like 'zoho:%'/i);
    expect(rendered[1]?.sql).toMatch(/lower\(actor_user_id\) like 'zoho:%'/i);
    expect(rendered[2]?.sql).toMatch(
      /actor_user_id is null or lower\(actor_user_id\) not like 'zoho:%'/i,
    );
  });

  it('keeps append-only coverage healthy past the last sparse fact', async () => {
    await mytrionUsageFactsRepo.sourceSpans(ctx);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.sql.match(/now\(\)/gi)?.length).toBeGreaterThanOrEqual(8);
  });

  it('tenant-scopes directory freshness to successful directory ingestions', async () => {
    await mytrionUsageTelemetryRepo.directorySpan(ctx);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.params).toContain('tenant-a');
    expect(query.sql).toMatch(/source = 'zoho_users'/i);
    expect(query.sql).toMatch(/mode = 'directory'/i);
    expect(query.sql).toMatch(/status = 'completed'/i);
  });

  it('reads explicit v2 telemetry proof per tenant and reporting day', async () => {
    await mytrionUsageTelemetryRepo.listRollupCoverageDays(ctx, window);
    const query = dialect.sqlToQuery(execute.mock.calls[0]?.[0] as never);
    expect(query.params).toContain('tenant-a');
    expect(query.sql).toMatch(/source_watermarks->>'usage\.presence'/i);
    expect(query.sql).toMatch(/source_watermarks->>'usage\.activity'/i);
    expect(query.sql).toMatch(/group by reporting_date/i);
  });
});
