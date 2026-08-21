import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.FF_MYTRION_USAGE_COLLECTION_ENABLED = '1';
  process.env.FF_AUDIT_LOG_ENABLED = '1';
});

const { facts, telemetry } = vi.hoisted(() => ({
  facts: {
    sourceSpans: vi.fn(), listAuditUsage: vi.fn(), listTicketBreakdown: vi.fn(),
    listCalls: vi.fn(), listCompletedTasks: vi.fn(), listAutomations: vi.fn(), listAiUsage: vi.fn(),
  },
  telemetry: {
    listEligibleSalesAgents: vi.fn(), directorySpan: vi.fn(), listRollupMetrics: vi.fn(),
    listRollupCoverageDays: vi.fn(), listRawPresence: vi.fn(),
    listRawActivity: vi.fn(), listCurrentStatus: vi.fn(),
  },
}));

vi.mock('../../src/repos/mytrionUsageFactsRepo.js', () => ({ mytrionUsageFactsRepo: facts }));
vi.mock('../../src/repos/mytrionUsageTelemetryRepo.js', () => ({ mytrionUsageTelemetryRepo: telemetry }));

import { env } from '../../src/config/env.js';
import { resolveMytrionUsageWindow } from '../../src/modules/analytics/mytrionUsageDates.js';
import { computeSalesMytrionUsage } from '../../src/modules/analytics/mytrionUsageService.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = {
  tenantId: 'tenant-a', userId: 'zoho:admin', audience: 'internal', role: 'admin', scopes: [],
  departments: ['analytics'], allDepartmentAccess: true, requestId: 'test',
} as TenantContext;
const window = resolveMytrionUsageWindow({ preset: 'custom', from: '2026-08-01', to: '2026-08-01' });

const spans = ['authentication', 'workspace', 'presence', 'activity', 'calls', 'tasks', 'edits', 'tickets', 'automations', 'ai']
  .map((source) => ({ source, availableFrom: '2026-07-01T00:00:00Z', availableThrough: '2026-09-01T00:00:00Z' }));

beforeEach(() => {
  vi.clearAllMocks();
  env.FF_MYTRION_USAGE_COLLECTION_ENABLED = true;
  env.FF_AUDIT_LOG_ENABLED = true;
  telemetry.listEligibleSalesAgents.mockResolvedValue([
    { workerId: 'w42', zohoUserId: '42', displayName: 'Active Agent' },
    { workerId: 'w43', zohoUserId: '43', displayName: 'Zero Agent' },
  ]);
  const refreshedAt = new Date().toISOString();
  telemetry.directorySpan.mockResolvedValue({
    source: 'directory', availableFrom: refreshedAt, availableThrough: refreshedAt,
  });
  telemetry.listRollupMetrics.mockResolvedValue([
    { workerId: 'w42', date: '2026-08-01', metricKey: 'online_visible_seconds', value: 600, status: 'complete' },
    { workerId: 'w42', date: '2026-08-01', metricKey: 'online_active_seconds', value: 420, status: 'complete' },
    { workerId: 'w42', date: '2026-08-01', metricKey: 'record_open_clicks', value: 3, status: 'complete' },
  ]);
  telemetry.listRollupCoverageDays.mockResolvedValue([
    { date: '2026-08-01', presence: 'complete', activity: 'complete' },
  ]);
  telemetry.listRawPresence.mockResolvedValue([
    { workerId: 'w42', date: '2026-08-01', onlineSeconds: 600, activeSeconds: 420, lastAt: '2026-08-01T14:30:00Z' },
  ]);
  telemetry.listRawActivity.mockResolvedValue([
    { workerId: 'w42', date: '2026-08-01', eventName: 'ui.record_open', count: 3, lastAt: '2026-08-01T15:00:00Z' },
  ]);
  telemetry.listCurrentStatus.mockResolvedValue([{ workerId: 'w42', status: 'active' }]);
  facts.sourceSpans.mockResolvedValue(spans);
  facts.listAuditUsage.mockResolvedValue([
    { actorId: '42', date: '2026-08-01', signIns: 1, workspaceSessions: 2, edits: 1,
      retentionActions: 0, ticketCreates: 1, escalationCreates: 0, lastAt: '2026-08-01T14:00:00Z' },
    { actorId: '999', date: '2026-08-01', signIns: 50, workspaceSessions: 50, edits: 50,
      retentionActions: 50, ticketCreates: 50, escalationCreates: 50, lastAt: '2026-08-01T16:00:00Z' },
  ]);
  facts.listTicketBreakdown.mockResolvedValue([
    { actorId: '42', key: 'ticket:c-30', label: 'C-30', count: 1 },
    { actorId: '999', key: 'ticket:c-30', label: 'C-30', count: 99 },
  ]);
  facts.listCalls.mockResolvedValue([{ actorId: '42', date: '2026-08-01', calls: 2, talkSeconds: 90, lastAt: '2026-08-01T13:00:00Z' }]);
  facts.listCompletedTasks.mockResolvedValue([{ actorId: '42', date: '2026-08-01', completed: 1, lastAt: '2026-08-01T13:30:00Z' }]);
  facts.listAutomations.mockResolvedValue({
    days: [{ actorId: '42', date: '2026-08-01', started: 1, succeeded: 1, failed: 0, lastAt: '2026-08-01T15:30:00Z' }],
    breakdown: [
      { actorId: '42', key: 'limit:succeeded', label: 'Limit · succeeded', count: 1 },
      { actorId: '999', key: 'limit:succeeded', label: 'Limit · succeeded', count: 99 },
    ],
    unattributed: 0,
  });
  facts.listAiUsage.mockResolvedValue({
    days: [{ actorId: '42', date: '2026-08-01', turns: 1, toolCalls: 2, lastAt: '2026-08-01T16:00:00Z' }],
    breakdown: [
      { actorId: '42', key: 'turn:ok', label: 'AI turns · ok', count: 1 },
      { actorId: '999', key: 'turn:ok', label: 'AI turns · ok', count: 99 },
    ],
  });
});

describe('Sales Mytrion usage aggregation', () => {
  it('left-joins the roster, normalizes identities, and excludes non-roster breakdown facts', async () => {
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.population.eligibleAgents).toBe(2);
    expect(snapshot.agents[0]).toMatchObject({
      workerId: 'w42', signIns: 1, workspaceSessions: 2, onlineSeconds: 600,
      activeSeconds: 420, uiActions: 3, calls: 2, aiTurns: 1, currentStatus: 'active',
    });
    expect(snapshot.agents[1]).toMatchObject({
      workerId: 'w43', signIns: 0, workspaceSessions: 0, onlineSeconds: 0,
      activeSeconds: 0, uiActions: 0, calls: 0, activeDays: 0, currentStatus: 'offline',
    });
    expect(snapshot.breakdowns.tickets).toEqual([{ key: 'ticket:c-30', label: 'C-30', count: 1 }]);
    expect(snapshot.breakdowns.automations[0]?.count).toBe(1);
    expect(snapshot.breakdowns.ai[0]?.count).toBe(1);
    expect(snapshot.agents.some((row) => row.displayName.includes('999'))).toBe(false);
    expect(snapshot.coverage.find((row) => row.source === 'automations')?.note)
      .toContain('not server-correlated');
  });

  it('makes telemetry metrics and status unavailable while collection is disabled', async () => {
    env.FF_MYTRION_USAGE_COLLECTION_ENABLED = false;
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.coverage.find((row) => row.source === 'presence')?.status).toBe('unavailable');
    expect(snapshot.coverage.find((row) => row.source === 'ui_activity')?.status).toBe('unavailable');
    expect(snapshot.coverage.find((row) => row.source === 'directory')?.status).toBe('complete');
    expect(snapshot.agents[0]).toMatchObject({ currentStatus: null, onlineSeconds: null, activeSeconds: null, uiActions: null });
  });

  it('does not turn a current-status query failure into false offline agents', async () => {
    telemetry.listCurrentStatus.mockRejectedValue(new Error('status query failed'));
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.agents[0]).toMatchObject({ onlineSeconds: 600, currentStatus: null });
    expect(snapshot.coverage.find((row) => row.source === 'presence')?.status).not.toBe('unavailable');
  });

  it('uses the rolled telemetry watermark for true last activity after raw retention', async () => {
    const epoch = Date.parse('2026-08-01T20:00:00Z') / 1_000;
    telemetry.listRawPresence.mockResolvedValue([]);
    telemetry.listRawActivity.mockResolvedValue([]);
    telemetry.listRollupMetrics.mockResolvedValue([
      { workerId: 'w42', date: '2026-08-01', metricKey: 'online_visible_seconds', value: 300, status: 'complete' },
      { workerId: 'w42', date: '2026-08-01', metricKey: 'record_open_clicks', value: 4, status: 'complete' },
      { workerId: 'w42', date: '2026-08-01', metricKey: 'last_telemetry_at_epoch_seconds', value: epoch, status: 'complete' },
    ]);
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.agents[0]).toMatchObject({
      onlineSeconds: 300,
      uiActions: 4,
      lastActivityAt: '2026-08-01T20:00:00.000Z',
    });
  });

  it('keeps raw presence timestamps scoped to their own worker', async () => {
    const todayWindow = resolveMytrionUsageWindow({
      preset: 'today', now: new Date('2026-08-18T16:00:00Z'),
    });
    telemetry.listRawPresence.mockResolvedValue([
      { workerId: 'w42', date: '2026-08-18', onlineSeconds: 60, activeSeconds: 60, lastAt: '2026-08-18T17:00:00Z' },
      { workerId: 'w43', date: '2026-08-18', onlineSeconds: 60, activeSeconds: 0, lastAt: '2026-08-18T23:59:00Z' },
    ]);
    const snapshot = await computeSalesMytrionUsage(ctx, todayWindow);
    expect(snapshot.agents.find((row) => row.workerId === 'w42')?.lastActivityAt).toBe('2026-08-18T17:00:00.000Z');
    expect(snapshot.agents.find((row) => row.workerId === 'w43')?.lastActivityAt).toBe('2026-08-18T23:59:00.000Z');
  });

  it('preserves unavailable rollup nulls on the affected day', async () => {
    telemetry.listRawPresence.mockResolvedValue([]);
    telemetry.listRawActivity.mockResolvedValue([]);
    telemetry.listRollupMetrics.mockResolvedValue([
      { workerId: 'w42', date: '2026-08-01', metricKey: 'online_visible_seconds', value: null, status: 'unavailable' },
      { workerId: 'w42', date: '2026-08-01', metricKey: 'online_active_seconds', value: null, status: 'unavailable' },
      { workerId: 'w42', date: '2026-08-01', metricKey: 'record_open_clicks', value: null, status: 'unavailable' },
    ]);
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.coverage.find((row) => row.source === 'presence')?.status).toBe('unavailable');
    expect(snapshot.coverage.find((row) => row.source === 'ui_activity')?.status).toBe('unavailable');
    expect(snapshot.days[0]).toMatchObject({
      partial: true,
      onlineSeconds: null,
      activeSeconds: null,
      uiActions: null,
    });
    expect(snapshot.agents[0]).toMatchObject({ onlineSeconds: null, activeSeconds: null, uiActions: null });
  });

  it('keeps a past all-zero day null when no rollup watermark proves collection', async () => {
    telemetry.listRollupCoverageDays.mockResolvedValue([]);
    telemetry.listRollupMetrics.mockResolvedValue([]);
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.days[0]).toMatchObject({
      onlineSeconds: null, activeSeconds: null, uiActions: null,
    });
    expect(snapshot.agents[1]).toMatchObject({
      onlineSeconds: null, activeSeconds: null, uiActions: null,
    });
  });

  it('does not bridge telemetry coverage across a skipped middle day', async () => {
    const gapWindow = resolveMytrionUsageWindow({
      preset: 'custom', from: '2026-08-01', to: '2026-08-03',
      now: new Date('2026-08-18T16:00:00Z'),
    });
    telemetry.listRollupCoverageDays.mockResolvedValue([
      { date: '2026-08-01', presence: 'complete', activity: 'complete' },
      { date: '2026-08-03', presence: 'complete', activity: 'complete' },
    ]);
    telemetry.listRollupMetrics.mockResolvedValue([
      { workerId: 'w42', date: '2026-08-01', metricKey: 'online_visible_seconds', value: 100, status: 'complete' },
      { workerId: 'w42', date: '2026-08-01', metricKey: 'record_open_clicks', value: 1, status: 'complete' },
      { workerId: 'w42', date: '2026-08-03', metricKey: 'online_visible_seconds', value: 200, status: 'complete' },
      { workerId: 'w42', date: '2026-08-03', metricKey: 'record_open_clicks', value: 2, status: 'complete' },
    ]);
    telemetry.listRawPresence.mockResolvedValue([
      { workerId: 'w42', date: '2026-08-02', onlineSeconds: 999, activeSeconds: 999, lastAt: '2026-08-02T20:00:00Z' },
    ]);
    telemetry.listRawActivity.mockResolvedValue([
      { workerId: 'w42', date: '2026-08-02', eventName: 'ui.record_open', count: 99, lastAt: '2026-08-02T20:00:00Z' },
    ]);
    const snapshot = await computeSalesMytrionUsage(ctx, gapWindow);
    expect(snapshot.days.find((day) => day.date === '2026-08-02')).toMatchObject({
      onlineSeconds: null, activeSeconds: null, uiActions: null,
    });
    expect(snapshot.agents[0]).toMatchObject({ onlineSeconds: 300, uiActions: 3 });
    expect(snapshot.coverage.find((row) => row.source === 'presence')?.status).toBe('partial');
  });

  it('marks a source unavailable when its latest evidence predates the range', async () => {
    facts.sourceSpans.mockResolvedValue(spans.map((span) => span.source === 'workspace'
      ? { ...span, availableThrough: '2026-07-31T00:00:00Z' }
      : span));
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.coverage.find((row) => row.source === 'workspace_sessions')?.status).toBe('unavailable');
    expect(snapshot.agents[0]?.workspaceSessions).toBeNull();
  });

  it('uses append-only source health through quiet zero-event periods', async () => {
    facts.sourceSpans.mockResolvedValue(spans.map((span) => span.source === 'workspace'
      ? { ...span, availableThrough: '2026-07-31T00:00:00Z', coveredThrough: '2026-08-18T00:00:00Z' }
      : span));
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.coverage.find((row) => row.source === 'workspace_sessions')?.status).toBe('complete');
    expect(snapshot.agents[0]?.workspaceSessions).toBe(2);
  });

  it('returns null daily values before each source became available', async () => {
    const partialWindow = resolveMytrionUsageWindow({
      preset: 'custom', from: '2026-08-01', to: '2026-08-20',
      now: new Date('2026-08-31T16:00:00Z'),
    });
    facts.sourceSpans.mockResolvedValue(spans.map((span) => ({
      ...span,
      availableFrom: '2026-08-10T04:00:00Z',
      availableThrough: '2026-08-20T20:00:00Z',
      coveredThrough: '2026-08-21T04:00:00Z',
    })));
    facts.listAuditUsage.mockResolvedValue([{ actorId: '42', date: '2026-08-10', signIns: 0,
      workspaceSessions: 2, edits: 1, retentionActions: 0, ticketCreates: 1,
      escalationCreates: 0, lastAt: '2026-08-10T14:00:00Z' }]);
    facts.listCalls.mockResolvedValue([{ actorId: '42', date: '2026-08-10', calls: 1,
      talkSeconds: 30, lastAt: '2026-08-10T15:00:00Z' }]);
    facts.listCompletedTasks.mockResolvedValue([]);
    facts.listAutomations.mockResolvedValue({ days: [], breakdown: [], unattributed: 0 });
    facts.listAiUsage.mockResolvedValue({ days: [{ actorId: '42', date: '2026-08-10', turns: 1,
      toolCalls: 0, lastAt: '2026-08-10T16:00:00Z' }], breakdown: [] });
    const snapshot = await computeSalesMytrionUsage(ctx, partialWindow);
    expect(snapshot.days.find((day) => day.date === '2026-08-01')).toMatchObject({
      activeAgents: null, workspaceSessions: null, onlineSeconds: null,
      uiActions: null, workOutcomes: null, aiTurns: null,
    });
    expect(snapshot.days.find((day) => day.date === '2026-08-10')).toMatchObject({
      activeAgents: 1, workspaceSessions: 2, workOutcomes: 3, aiTurns: 1,
    });
  });

  it('does not expose zero for today when the raw overlay query fails', async () => {
    telemetry.listRawPresence.mockRejectedValue(new Error('presence unavailable'));
    telemetry.listRawActivity.mockRejectedValue(new Error('activity unavailable'));
    const todayWindow = resolveMytrionUsageWindow({
      preset: 'today', now: new Date('2026-08-18T16:00:00Z'),
    });
    const snapshot = await computeSalesMytrionUsage(ctx, todayWindow);
    expect(snapshot.coverage.find((row) => row.source === 'presence')?.status).toBe('unavailable');
    expect(snapshot.coverage.find((row) => row.source === 'ui_activity')?.status).toBe('unavailable');
    expect(snapshot.agents[0]).toMatchObject({ onlineSeconds: null, activeSeconds: null, uiActions: null });
  });

  it('fails closed when the last successful directory is too stale', async () => {
    const staleAt = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    telemetry.directorySpan.mockResolvedValue({
      source: 'directory', availableFrom: staleAt, availableThrough: staleAt,
    });
    await expect(computeSalesMytrionUsage(ctx, window)).rejects.toMatchObject({
      statusCode: 503, code: 'MYTRION_USAGE_DIRECTORY_UNAVAILABLE',
    });
  });

  it('fails closed when no successful directory refresh exists', async () => {
    telemetry.directorySpan.mockResolvedValue(undefined);
    await expect(computeSalesMytrionUsage(ctx, window)).rejects.toMatchObject({
      statusCode: 503, code: 'MYTRION_USAGE_DIRECTORY_UNAVAILABLE',
    });
  });

  it('fails closed even when the directory is only partially stale', async () => {
    const staleAt = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    telemetry.directorySpan.mockResolvedValue({
      source: 'directory', availableFrom: staleAt, availableThrough: staleAt,
    });
    await expect(computeSalesMytrionUsage(ctx, window)).rejects.toMatchObject({
      statusCode: 503, code: 'MYTRION_USAGE_DIRECTORY_UNAVAILABLE',
    });
  });

  it('never attributes system automation rows to Sales agents', async () => {
    facts.listAutomations.mockResolvedValue({
      days: [{ actorId: 'system', date: '2026-08-01', started: 1, succeeded: 1,
        failed: 0, lastAt: '2026-08-01T15:30:00Z' }],
      breakdown: [{ actorId: 'system', key: 'limit:succeeded',
        label: 'Limit · succeeded', count: 1 }],
      unattributed: 1,
    });
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.agents[0]).toMatchObject({
      automationStarted: 0, automationSucceeded: 0, automationFailed: 0,
    });
    expect(snapshot.breakdowns.automations).toEqual([]);
    expect(snapshot.coverage.find((row) => row.source === 'automations')?.status).toBe('partial');
  });

  it('labels the composite work outcome as partial instead of treating disabled audit sources as complete zeros', async () => {
    env.FF_AUDIT_LOG_ENABLED = false;
    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.coverage.find((row) => row.source === 'work_outcomes')?.status).toBe('partial');
    expect(snapshot.coverage.find((row) => row.source === 'authentication')?.status).toBe('unavailable');
    expect(snapshot.agents[0]?.signIns).toBeNull();
    expect(snapshot.agents[0]?.workOutcomes).toBe(1);
  });

  it('does not classify platform-only sign-ins as Mytrion activity', async () => {
    telemetry.listRollupMetrics.mockResolvedValue([]);
    telemetry.listRawPresence.mockResolvedValue([]);
    telemetry.listRawActivity.mockResolvedValue([]);
    telemetry.listCurrentStatus.mockResolvedValue([]);
    facts.listAuditUsage.mockResolvedValue([
      { actorId: '42', date: '2026-08-01', signIns: 1, workspaceSessions: 0, edits: 0,
        retentionActions: 0, ticketCreates: 0, escalationCreates: 0, lastAt: null },
    ]);
    facts.listCalls.mockResolvedValue([]);
    facts.listCompletedTasks.mockResolvedValue([]);
    facts.listAutomations.mockResolvedValue({ days: [], breakdown: [], unattributed: 0 });
    facts.listAiUsage.mockResolvedValue({ days: [], breakdown: [] });

    const snapshot = await computeSalesMytrionUsage(ctx, window);
    expect(snapshot.agents[0]).toMatchObject({ signIns: 1, activeDays: 0, lastActivityAt: null });
    expect(snapshot.summary.activeAgents).toBe(0);
  });
});
