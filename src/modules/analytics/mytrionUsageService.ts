import { logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { mytrionUsageFactsRepo } from '../../repos/mytrionUsageFactsRepo.js';
import { mytrionUsageTelemetryRepo } from '../../repos/mytrionUsageTelemetryRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  MYTRION_USAGE_TIME_ZONE,
  usageDates,
  type MytrionUsageWindow,
} from './mytrionUsageDates.js';
import type {
  ActivityUsageDayFact,
  UsageBreakdownFact,
} from './mytrionUsageData.js';
import {
  coverageRow,
  directoryStatus,
  intersectSpans,
  isAvailable,
  sourceCoversDay,
  spanStatus,
} from './mytrionUsageCoverage.js';
import type {
  MytrionPresenceStatus,
  MytrionUsageBreakdownRow,
  MytrionUsageCoverageStatus,
  MytrionUsageSnapshot,
  SalesAgentUsageRow,
} from './mytrionUsageTypes.js';

interface Load<T> {
  value: T | null;
  failed: boolean;
}

interface DayValues {
  signIns: number;
  workspaceSessions: number;
  onlineSeconds: number;
  activeSeconds: number;
  uiActions: number;
  edits: number;
  retentionActions: number;
  ticketCreates: number;
  escalationCreates: number;
  calls: number;
  talkSeconds: number;
  tasksCompleted: number;
  automationStarted: number;
  automationSucceeded: number;
  automationFailed: number;
  aiTurns: number;
  aiToolCalls: number;
  lastActivityAt: string | null;
}

const ACTIVITY_METRICS: Record<string, { event: string; label: string }> = {
  tab_open_clicks: { event: 'navigation.tab_open', label: 'Section opens' },
  lead_open_clicks: { event: 'crm.lead_open', label: 'Lead opens' },
  deal_open_clicks: { event: 'crm.deal_open', label: 'Deal opens' },
  call_clicks: { event: 'crm.call_click', label: 'Call intents' },
  edit_open_clicks: { event: 'crm.edit_open', label: 'Edit intents' },
  edit_save_successes: { event: 'crm.edit_save_success', label: 'Successful edit saves' },
  edit_save_failures: { event: 'crm.edit_save_failed', label: 'Failed edit saves' },
  view_open_clicks: { event: 'navigation.view_open', label: 'View opens' },
  record_open_clicks: { event: 'ui.record_open', label: 'Record opens' },
  searches_completed: { event: 'ui.search_completed', label: 'Completed searches' },
  exports_completed: { event: 'report.export_completed', label: 'Completed exports' },
};

const EVENT_LABELS = new Map(Object.values(ACTIVITY_METRICS).map((item) => [item.event, item.label]));

function emptyDay(): DayValues {
  return {
    signIns: 0,
    workspaceSessions: 0,
    onlineSeconds: 0,
    activeSeconds: 0,
    uiActions: 0,
    edits: 0,
    retentionActions: 0,
    ticketCreates: 0,
    escalationCreates: 0,
    calls: 0,
    talkSeconds: 0,
    tasksCompleted: 0,
    automationStarted: 0,
    automationSucceeded: 0,
    automationFailed: 0,
    aiTurns: 0,
    aiToolCalls: 0,
    lastActivityAt: null,
  };
}

async function load<T>(source: string, run: () => Promise<T>): Promise<Load<T>> {
  try {
    return { value: await run(), failed: false };
  } catch (error) {
    logger.warn(
      { source, err: error instanceof Error ? error.message : String(error) },
      'Sales Mytrion usage source unavailable',
    );
    return { value: null, failed: true };
  }
}

function latest(current: string | null, next: string | null): string | null {
  if (!next) return current;
  const normalizedNext = new Date(next).toISOString();
  if (!current) return normalizedNext;
  const normalizedCurrent = new Date(current).toISOString();
  return normalizedNext > normalizedCurrent ? normalizedNext : normalizedCurrent;
}

function sum(rows: Iterable<DayValues>, field: keyof DayValues): number {
  let total = 0;
  for (const row of rows) {
    const value = row[field];
    if (typeof value === 'number') total += value;
  }
  return total;
}

function breakdown(
  key: string,
  label: string,
  available: boolean,
  count: number,
): MytrionUsageBreakdownRow {
  return { key, label, count: available ? count : null };
}

function mergeBreakdown(
  rows: UsageBreakdownFact[] | undefined,
  eligibleActorIds: ReadonlySet<string>,
): MytrionUsageBreakdownRow[] {
  const merged = new Map<string, MytrionUsageBreakdownRow>();
  for (const row of rows ?? []) {
    if (row.actorId && !eligibleActorIds.has(row.actorId.replace(/^zoho:/i, ''))) continue;
    const current = merged.get(row.key);
    merged.set(row.key, {
      key: row.key,
      label: current?.label ?? row.label,
      count: (current?.count ?? 0) + row.count,
    });
  }
  return [...merged.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
}

export async function computeSalesMytrionUsage(
  ctx: TenantContext,
  window: MytrionUsageWindow,
): Promise<MytrionUsageSnapshot> {
  const roster = await mytrionUsageTelemetryRepo.listEligibleSalesAgents(ctx);
  const [directoryLoad, spansLoad, auditLoad, ticketsLoad, callsLoad, tasksLoad, automationLoad, aiLoad,
    rollupsLoad, rollupCoverageLoad, presenceLoad, activityLoad, statusLoad] = await Promise.all([
    load('directory', () => mytrionUsageTelemetryRepo.directorySpan(ctx)),
    load('coverage', () => mytrionUsageFactsRepo.sourceSpans(ctx)),
    load('audit', () => mytrionUsageFactsRepo.listAuditUsage(ctx, window)),
    load('tickets', () => mytrionUsageFactsRepo.listTicketBreakdown(ctx, window)),
    load('calls', () => mytrionUsageFactsRepo.listCalls(ctx, window)),
    load('tasks', () => mytrionUsageFactsRepo.listCompletedTasks(ctx, window)),
    load('automations', () => mytrionUsageFactsRepo.listAutomations(ctx, window)),
    load('ai', () => mytrionUsageFactsRepo.listAiUsage(ctx, window)),
    load('rollups', () => mytrionUsageTelemetryRepo.listRollupMetrics(ctx, window)),
    load('rollup-coverage', () => mytrionUsageTelemetryRepo.listRollupCoverageDays(ctx, window)),
    load('presence', () => mytrionUsageTelemetryRepo.listRawPresence(ctx, window)),
    load('activity', () => mytrionUsageTelemetryRepo.listRawActivity(ctx, window)),
    load('presence-status', () => mytrionUsageTelemetryRepo.listCurrentStatus(ctx)),
  ]);

  const rosterStatus = directoryStatus(directoryLoad.value, directoryLoad.failed);
  if (rosterStatus !== 'complete') {
    throw new AppError('The eligible Sales directory is unavailable or too stale', {
      statusCode: 503,
      code: 'MYTRION_USAGE_DIRECTORY_UNAVAILABLE',
      expose: true,
    });
  }

  const spans = new Map((spansLoad.value ?? []).map((span) => [span.source, span]));
  const statuses = {
    authentication: spanStatus(spans.get('authentication'), auditLoad.failed, window),
    workspace: spanStatus(spans.get('workspace'), auditLoad.failed, window),
    presence: spanStatus(
      spans.get('presence'),
      presenceLoad.failed && rollupsLoad.failed,
      window,
    ),
    activity: spanStatus(
      spans.get('activity'),
      activityLoad.failed && rollupsLoad.failed,
      window,
    ),
    calls: spanStatus(spans.get('calls'), callsLoad.failed, window),
    tasks: spanStatus(spans.get('tasks'), tasksLoad.failed, window),
    edits: spanStatus(spans.get('edits'), auditLoad.failed, window),
    tickets: spanStatus(spans.get('tickets'), auditLoad.failed || ticketsLoad.failed, window),
    automations: spanStatus(spans.get('automations'), automationLoad.failed, window),
    ai: spanStatus(spans.get('ai'), aiLoad.failed, window),
  };
  if (!env.FF_MYTRION_USAGE_COLLECTION_ENABLED) {
    statuses.presence = 'unavailable';
    statuses.activity = 'unavailable';
  }
  if (!env.FF_AUDIT_LOG_ENABLED) {
    statuses.authentication = 'unavailable';
    statuses.workspace = 'unavailable';
    statuses.calls = 'unavailable';
    statuses.tasks = 'unavailable';
    statuses.edits = 'unavailable';
    statuses.tickets = 'unavailable';
    statuses.ai = 'unavailable';
  }
  if ((automationLoad.value?.unattributed ?? 0) > 0 && statuses.automations === 'complete') {
    statuses.automations = 'partial';
  }

  const dates = usageDates(window.from, window.to);
  const today = window.today;
  if (window.to >= today) {
    if (statuses.presence === 'complete') statuses.presence = 'partial';
    if (statuses.activity === 'complete') statuses.activity = 'partial';
  }
  const sourceDay = (source: string, status: MytrionUsageCoverageStatus, date: string): boolean =>
    sourceCoversDay(status, spans.get(source), date);
  const byWorkerDate = new Map<string, DayValues>();
  for (const agent of roster) {
    for (const date of dates) byWorkerDate.set(`${agent.workerId}:${date}`, emptyDay());
  }
  const byZoho = new Map(roster.map((agent) => [agent.zohoUserId, agent.workerId]));
  const eligibleActorIds = new Set(roster.map((agent) => agent.zohoUserId));
  const dayForActor = (actorId: string, date: string): DayValues | undefined => {
    const workerId = byZoho.get(actorId.replace(/^zoho:/i, ''));
    return workerId ? byWorkerDate.get(`${workerId}:${date}`) : undefined;
  };

  for (const fact of auditLoad.value ?? []) {
    const day = dayForActor(fact.actorId, fact.date);
    if (!day) continue;
    const authentication = sourceDay('authentication', statuses.authentication, fact.date);
    const workspace = sourceDay('workspace', statuses.workspace, fact.date);
    const edits = sourceDay('edits', statuses.edits, fact.date);
    const tickets = sourceDay('tickets', statuses.tickets, fact.date);
    day.signIns += authentication ? fact.signIns : 0;
    day.workspaceSessions += workspace ? fact.workspaceSessions : 0;
    day.edits += edits ? fact.edits : 0;
    day.retentionActions += edits ? fact.retentionActions : 0;
    day.ticketCreates += tickets ? fact.ticketCreates : 0;
    day.escalationCreates += tickets ? fact.escalationCreates : 0;
    if (workspace || edits || tickets) day.lastActivityAt = latest(day.lastActivityAt, fact.lastAt);
  }
  for (const fact of callsLoad.value ?? []) {
    const day = dayForActor(fact.actorId, fact.date);
    if (!day || !sourceDay('calls', statuses.calls, fact.date)) continue;
    day.calls += fact.calls;
    day.talkSeconds += fact.talkSeconds;
    day.lastActivityAt = latest(day.lastActivityAt, fact.lastAt);
  }
  for (const fact of tasksLoad.value ?? []) {
    const day = dayForActor(fact.actorId, fact.date);
    if (!day || !sourceDay('tasks', statuses.tasks, fact.date)) continue;
    day.tasksCompleted += fact.completed;
    day.lastActivityAt = latest(day.lastActivityAt, fact.lastAt);
  }
  for (const fact of automationLoad.value?.days ?? []) {
    const day = dayForActor(fact.actorId, fact.date);
    if (!day || !sourceDay('automations', statuses.automations, fact.date)) continue;
    day.automationStarted += fact.started;
    day.automationSucceeded += fact.succeeded;
    day.automationFailed += fact.failed;
    day.lastActivityAt = latest(day.lastActivityAt, fact.lastAt);
  }
  for (const fact of aiLoad.value?.days ?? []) {
    const day = dayForActor(fact.actorId, fact.date);
    if (!day || !sourceDay('ai', statuses.ai, fact.date)) continue;
    day.aiTurns += fact.turns;
    day.aiToolCalls += fact.toolCalls;
    day.lastActivityAt = latest(day.lastActivityAt, fact.lastAt);
  }

  const rollups = new Map<string, Map<string, number | null>>();
  const presenceUnavailableDates = new Set<string>();
  const activityUnavailableDates = new Set<string>();
  const rollupCoverage = new Map((rollupCoverageLoad.value ?? []).map((proof) => [proof.date, proof]));
  for (const fact of rollupsLoad.value ?? []) {
    const key = `${fact.workerId}:${fact.date}`;
    const presenceMetric = fact.metricKey === 'online_visible_seconds' || fact.metricKey === 'online_active_seconds';
    const activityMetric = Object.prototype.hasOwnProperty.call(ACTIVITY_METRICS, fact.metricKey);
    if (fact.status === 'unavailable' && fact.date !== today) {
      if (presenceMetric) presenceUnavailableDates.add(fact.date);
      if (activityMetric) activityUnavailableDates.add(fact.date);
    }
    const metrics = rollups.get(key) ?? new Map<string, number | null>();
    metrics.set(fact.metricKey, fact.value);
    rollups.set(key, metrics);
  }
  if (presenceLoad.failed && dates.includes(today)) presenceUnavailableDates.add(today);
  if (activityLoad.failed && dates.includes(today)) activityUnavailableDates.add(today);
  for (const date of dates) {
    if (date < today) {
      const proof = rollupCoverage.get(date);
      if (rollupCoverageLoad.failed || rollupsLoad.failed || proof?.presence !== 'complete') {
        presenceUnavailableDates.add(date);
      }
      if (rollupCoverageLoad.failed || rollupsLoad.failed || proof?.activity !== 'complete') {
        activityUnavailableDates.add(date);
      }
    }
    if (date > today) {
      presenceUnavailableDates.add(date);
      activityUnavailableDates.add(date);
    }
  }
  if (dates.some((date) => presenceUnavailableDates.has(date))) {
    statuses.presence = dates.every((date) => presenceUnavailableDates.has(date))
      ? 'unavailable'
      : statuses.presence === 'unavailable' ? 'unavailable' : 'partial';
  }
  if (dates.some((date) => activityUnavailableDates.has(date))) {
    statuses.activity = dates.every((date) => activityUnavailableDates.has(date))
      ? 'unavailable'
      : statuses.activity === 'unavailable' ? 'unavailable' : 'partial';
  }
  const presenceDayAvailable = (date: string): boolean =>
    !presenceUnavailableDates.has(date) && sourceDay('presence', statuses.presence, date);
  const activityDayAvailable = (date: string): boolean =>
    !activityUnavailableDates.has(date) && sourceDay('activity', statuses.activity, date);
  const presenceTotalsAvailable = dates.some(presenceDayAvailable);
  const activityTotalsAvailable = dates.some(activityDayAvailable);
  const rawPresence = new Map((presenceLoad.value ?? []).map((fact) => [
    `${fact.workerId}:${fact.date}`,
    fact,
  ]));
  const rawActivity = new Map<string, ActivityUsageDayFact[]>();
  for (const fact of activityLoad.value ?? []) {
    const key = `${fact.workerId}:${fact.date}`;
    rawActivity.set(key, [...(rawActivity.get(key) ?? []), fact]);
  }
  const activityCounts = new Map<string, number>();
  for (const agent of roster) {
    for (const date of dates) {
      const key = `${agent.workerId}:${date}`;
      const day = byWorkerDate.get(key);
      if (!day) continue;
      const rolled = date === today ? undefined : rollups.get(key);
      const raw = rawPresence.get(key);
      const hasPresenceRollup = rolled?.has('online_visible_seconds') || rolled?.has('online_active_seconds');
      if (presenceDayAvailable(date)) {
        day.onlineSeconds = hasPresenceRollup
          ? rolled?.get('online_visible_seconds') ?? 0
          : date === today ? raw?.onlineSeconds ?? 0 : 0;
        day.activeSeconds = hasPresenceRollup
          ? rolled?.get('online_active_seconds') ?? 0
          : date === today ? raw?.activeSeconds ?? 0 : 0;
      }
      const lastTelemetryEpoch = rolled?.get('last_telemetry_at_epoch_seconds');
      const rolledTelemetryAt = lastTelemetryEpoch && lastTelemetryEpoch > 0 &&
        (presenceDayAvailable(date) || activityDayAvailable(date))
        ? new Date(lastTelemetryEpoch * 1_000).toISOString()
        : null;
      day.lastActivityAt = latest(
        day.lastActivityAt,
        rolledTelemetryAt ?? (date === today && presenceDayAvailable(date) ? raw?.lastAt ?? null : null),
      );

      const rolledActions = rolled
        && Object.keys(ACTIVITY_METRICS).some((metric) => rolled.has(metric))
        ? [...Object.entries(ACTIVITY_METRICS)].map(([metric, item]) => ({
            eventName: item.event,
            count: rolled.get(metric) ?? 0,
            lastAt: null,
          }))
        : null;
      const rawActions = date === today ? rawActivity.get(key) ?? [] : [];
      for (const fact of activityDayAvailable(date) ? rolledActions ?? rawActions : []) {
        day.uiActions += fact.count;
        activityCounts.set(fact.eventName, (activityCounts.get(fact.eventName) ?? 0) + fact.count);
        day.lastActivityAt = latest(day.lastActivityAt, fact.lastAt);
      }
    }
  }

  const presenceStatus = new Map((statusLoad.value ?? []).map((row) => [row.workerId, row.status]));
  const workSources = [statuses.calls, statuses.tasks, statuses.edits, statuses.tickets, statuses.automations];
  const workAvailable = workSources.some(isAvailable);
  const workStatus: MytrionUsageCoverageStatus = workSources.every((status) => status === 'complete')
    ? 'complete'
    : workAvailable
      ? 'partial'
      : 'unavailable';
  const available = (source: keyof typeof statuses, date?: string): boolean =>
    date ? sourceDay(source === 'workspace' ? 'workspace' : source, statuses[source], date)
      : isAvailable(statuses[source]);
  const workOutcomeValue = (values: DayValues[], date?: string): number =>
    (available('calls', date) ? sum(values, 'calls') : 0) +
    (available('tasks', date) ? sum(values, 'tasksCompleted') : 0) +
    (available('edits', date) ? sum(values, 'edits') + sum(values, 'retentionActions') : 0) +
    (available('tickets', date) ? sum(values, 'ticketCreates') + sum(values, 'escalationCreates') : 0) +
    (available('automations', date) ? sum(values, 'automationSucceeded') : 0);
  const anyUsageCoverage = (date: string): boolean =>
    available('workspace', date) || presenceDayAvailable(date) || activityDayAvailable(date) ||
    ['edits', 'tickets', 'calls', 'tasks', 'automations', 'ai']
      .some((source) => available(source as keyof typeof statuses, date));
  const hasAvailableUsage = (day: DayValues, date: string): boolean =>
    (available('workspace', date) ? day.workspaceSessions : 0) +
    (presenceDayAvailable(date) ? day.onlineSeconds + day.activeSeconds : 0) +
    (activityDayAvailable(date) ? day.uiActions : 0) +
    (available('edits', date) ? day.edits + day.retentionActions : 0) +
    (available('tickets', date) ? day.ticketCreates + day.escalationCreates : 0) +
    (available('calls', date) ? day.calls : 0) +
    (available('tasks', date) ? day.tasksCompleted : 0) +
    (available('automations', date) ? day.automationStarted : 0) +
    (available('ai', date) ? day.aiTurns : 0) > 0;
  const anyUsageSource = dates.some(anyUsageCoverage);
  const agentRows: SalesAgentUsageRow[] = roster.map((agent) => {
    const values = dates.map((date) => byWorkerDate.get(`${agent.workerId}:${date}`) ?? emptyDay());
    const workOutcomes = workOutcomeValue(values);
    return {
      workerId: agent.workerId,
      displayName: agent.displayName,
      currentStatus: isAvailable(statuses.presence) && !statusLoad.failed
        ? ((presenceStatus.get(agent.workerId) ?? 'offline') as MytrionPresenceStatus)
        : null,
      signIns: isAvailable(statuses.authentication) ? sum(values, 'signIns') : null,
      workspaceSessions: isAvailable(statuses.workspace) ? sum(values, 'workspaceSessions') : null,
      onlineSeconds: presenceTotalsAvailable ? sum(values, 'onlineSeconds') : null,
      activeSeconds: presenceTotalsAvailable ? sum(values, 'activeSeconds') : null,
      activeDays: anyUsageSource
        ? values.filter((value, index) => hasAvailableUsage(value, dates[index] ?? '')).length
        : null,
      uiActions: activityTotalsAvailable ? sum(values, 'uiActions') : null,
      workOutcomes: workAvailable ? workOutcomes : null,
      ticketCreates: isAvailable(statuses.tickets) ? sum(values, 'ticketCreates') : null,
      escalationCreates: isAvailable(statuses.tickets) ? sum(values, 'escalationCreates') : null,
      automationStarted: isAvailable(statuses.automations) ? sum(values, 'automationStarted') : null,
      automationSucceeded: isAvailable(statuses.automations) ? sum(values, 'automationSucceeded') : null,
      automationFailed: isAvailable(statuses.automations) ? sum(values, 'automationFailed') : null,
      calls: isAvailable(statuses.calls) ? sum(values, 'calls') : null,
      talkSeconds: isAvailable(statuses.calls) ? sum(values, 'talkSeconds') : null,
      aiTurns: isAvailable(statuses.ai) ? sum(values, 'aiTurns') : null,
      aiToolCalls: isAvailable(statuses.ai) ? sum(values, 'aiToolCalls') : null,
      lastActivityAt: values.reduce<string | null>((last, value) => latest(last, value.lastActivityAt), null),
    };
  });

  const allValues = [...byWorkerDate.values()];
  const activeAgents = anyUsageSource ? agentRows.filter((row) => row.activeDays !== null && row.activeDays > 0).length : null;
  const coverage = [
    coverageRow('directory', 'Eligible Sales directory', rosterStatus, directoryLoad.value ?? undefined,
      rosterStatus === 'complete' ? 'Active exact-profile Sales Agent roster.' : 'The daily Sales directory refresh is paused, stale, or unavailable.'),
    coverageRow('authentication', 'Platform sign-ins', statuses.authentication, spans.get('authentication'), 'Platform-wide authentication events.'),
    coverageRow('workspace_sessions', 'Sales workspace sessions', statuses.workspace, spans.get('workspace'), '30-minute deduplicated Sales workspace access events.'),
    coverageRow(
      'presence',
      'Online and active time',
      statuses.presence,
      spans.get('presence'),
      statusLoad.failed ? 'Historical presence is available, but live 90-second status is unavailable.' : undefined,
    ),
    coverageRow('ui_activity', 'Semantic UI actions', statuses.activity, spans.get('activity')),
    coverageRow('work_outcomes', 'Work outcomes', workStatus,
      intersectSpans(spans, ['calls', 'tasks', 'edits', 'tickets', 'automations']),
      workStatus === 'partial' ? 'One or more outcome sources are unavailable or cover only part of this range.' : undefined),
    coverageRow('tickets', 'Tickets and escalations', statuses.tickets, spans.get('tickets')),
    coverageRow('automations', 'Sales automations', statuses.automations, spans.get('automations'),
      `Verified-session browser lifecycle; not server-correlated.${(automationLoad.value?.unattributed ?? 0) > 0
        ? ` ${automationLoad.value?.unattributed ?? 0} historical lifecycle rows lack a server actor.` : ''}`),
    coverageRow('ai', 'Sales AI usage', statuses.ai, spans.get('ai')),
  ];

  const workBreakdown = [
    breakdown('calls', 'Calls', isAvailable(statuses.calls), sum(byWorkerDate.values(), 'calls')),
    breakdown('tasks_completed', 'Tasks completed', isAvailable(statuses.tasks), sum(byWorkerDate.values(), 'tasksCompleted')),
    breakdown('edits', 'Successful edits', isAvailable(statuses.edits), sum(byWorkerDate.values(), 'edits')),
    breakdown('retention', 'Retention actions', isAvailable(statuses.edits), sum(byWorkerDate.values(), 'retentionActions')),
    breakdown('tickets', 'Tickets created', isAvailable(statuses.tickets), sum(byWorkerDate.values(), 'ticketCreates')),
    breakdown('escalations', 'Escalations created', isAvailable(statuses.tickets), sum(byWorkerDate.values(), 'escalationCreates')),
    breakdown('automations', 'Automations succeeded', isAvailable(statuses.automations), sum(byWorkerDate.values(), 'automationSucceeded')),
  ];

  return {
    scope: { mytrion: 'sales', population: 'sales_agent' },
    timeZone: MYTRION_USAGE_TIME_ZONE,
    range: { preset: window.preset, from: window.from, to: window.to },
    computedAt: new Date().toISOString(),
    population: { eligibleAgents: roster.length },
    coverage,
    summary: {
      eligibleAgents: roster.length,
      activeAgents,
      workspaceSessions: isAvailable(statuses.workspace) ? sum(allValues, 'workspaceSessions') : null,
      onlineSeconds: presenceTotalsAvailable ? sum(byWorkerDate.values(), 'onlineSeconds') : null,
      activeSeconds: presenceTotalsAvailable ? sum(byWorkerDate.values(), 'activeSeconds') : null,
      uiActions: activityTotalsAvailable ? sum(byWorkerDate.values(), 'uiActions') : null,
      workOutcomes: workAvailable ? agentRows.reduce((total, row) => total + (row.workOutcomes ?? 0), 0) : null,
    },
    days: dates.map((date) => {
      const values = roster.map((agent) => byWorkerDate.get(`${agent.workerId}:${date}`) ?? emptyDay());
      return {
        date,
        partial:
          date === today ||
          presenceUnavailableDates.has(date) ||
          activityUnavailableDates.has(date) ||
          coverage.some((item) => item.status === 'partial'),
        activeAgents: anyUsageCoverage(date) ? values.filter((value) => hasAvailableUsage(value, date)).length : null,
        workspaceSessions: available('workspace', date) ? sum(values, 'workspaceSessions') : null,
        onlineSeconds: presenceDayAvailable(date)
          ? sum(values, 'onlineSeconds') : null,
        activeSeconds: presenceDayAvailable(date)
          ? sum(values, 'activeSeconds') : null,
        uiActions: activityDayAvailable(date)
          ? sum(values, 'uiActions') : null,
        workOutcomes: ['calls', 'tasks', 'edits', 'tickets', 'automations']
          .some((source) => available(source as keyof typeof statuses, date))
          ? workOutcomeValue(values, date)
          : null,
        aiTurns: available('ai', date) ? sum(values, 'aiTurns') : null,
      };
    }),
    agents: agentRows,
    breakdowns: {
      activity: [...EVENT_LABELS].map(([event, label]) =>
        breakdown(event, label, activityTotalsAvailable, activityCounts.get(event) ?? 0)),
      workOutcomes: workBreakdown,
      tickets: isAvailable(statuses.tickets) ? mergeBreakdown(ticketsLoad.value ?? undefined, eligibleActorIds) : [breakdown('tickets_unavailable', 'Tickets unavailable', false, 0)],
      automations: isAvailable(statuses.automations) ? mergeBreakdown(automationLoad.value?.breakdown, eligibleActorIds) : [breakdown('automations_unavailable', 'Automations unavailable', false, 0)],
      ai: isAvailable(statuses.ai) ? mergeBreakdown(aiLoad.value?.breakdown, eligibleActorIds) : [breakdown('ai_unavailable', 'AI usage unavailable', false, 0)],
    },
  };
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: MytrionUsageSnapshot }>();
const inFlight = new Map<string, Promise<MytrionUsageSnapshot>>();

export async function getSalesMytrionUsage(
  ctx: TenantContext,
  window: MytrionUsageWindow,
  force = false,
): Promise<MytrionUsageSnapshot> {
  const key = `${ctx.tenantId}:${window.preset}:${window.from}:${window.to}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const running = !force ? inFlight.get(key) : undefined;
  if (running) return running;
  const compute = computeSalesMytrionUsage(ctx, window);
  if (!force) inFlight.set(key, compute);
  let value: MytrionUsageSnapshot;
  try {
    value = await compute;
  } finally {
    if (!force) inFlight.delete(key);
  }
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 100) cache.delete(cache.keys().next().value ?? key);
  return value;
}
