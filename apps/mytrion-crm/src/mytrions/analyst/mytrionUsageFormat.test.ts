import { describe, expect, it } from 'vitest';

import type { SalesAgentUsageRow } from '@/api/analytics';

import { formatActivityTime, formatDuration, sortUsageAgents } from './mytrionUsageFormat';

function agent(
  displayName: string,
  activeSeconds: number | null,
): SalesAgentUsageRow {
  return {
    workerId: displayName,
    displayName,
    currentStatus: 'offline',
    signIns: 0,
    workspaceSessions: 0,
    onlineSeconds: activeSeconds,
    activeSeconds,
    activeDays: 0,
    uiActions: 0,
    workOutcomes: 0,
    ticketCreates: 0,
    escalationCreates: 0,
    automationStarted: 0,
    automationSucceeded: 0,
    automationFailed: 0,
    calls: 0,
    talkSeconds: 0,
    aiTurns: 0,
    aiToolCalls: 0,
    lastActivityAt: null,
  };
}

describe('Sales Mytrion usage formatting', () => {
  it('defaults most-used ordering to descending with deterministic ties', () => {
    const sorted = sortUsageAgents(
      [agent('Zoe', 60), agent('Bea', 120), agent('Ada', 120)],
      'activeSeconds',
      'desc',
    );
    expect(sorted.map((row) => row.displayName)).toEqual(['Ada', 'Bea', 'Zoe']);
  });

  it('puts measured zero-use agents first in ascending order and unavailable rows last', () => {
    const sorted = sortUsageAgents(
      [agent('Unavailable', null), agent('Used', 60), agent('Zero use', 0)],
      'activeSeconds',
      'asc',
    );
    expect(sorted.map((row) => row.displayName)).toEqual(['Zero use', 'Used', 'Unavailable']);
  });

  it('formats concise operational durations without treating unavailable as zero', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(59)).toBe('<1m');
    expect(formatDuration(7_500)).toBe('2h 5m');
  });

  it('formats activity instants in the reporting timezone, not the viewer timezone', () => {
    expect(formatActivityTime('2026-08-18T14:20:00.000Z', 'America/New_York')).toBe(
      '18 Aug, 10:20',
    );
  });
});
