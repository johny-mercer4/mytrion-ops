import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MytrionUsageSnapshot, SalesAgentUsageRow } from '@/api/analytics';

const mocks = vi.hoisted(() => ({
  useUsage: vi.fn(),
  exportXlsx: vi.fn(),
}));

vi.mock('../useMytrionUsageSnapshot', () => ({
  useMytrionUsageSnapshot: mocks.useUsage,
}));
vi.mock('../mytrionUsageExport', () => ({
  exportMytrionUsageXlsx: mocks.exportXlsx,
}));

import type { DashboardFilterParams } from '../categories';
import { MytrionDashboard } from './MytrionDashboard';

const FILTERS: DashboardFilterParams = {
  agentId: null,
  agentName: null,
  range: 'last_7_days',
  from: null,
  to: null,
};

function agent(name: string, activeSeconds: number): SalesAgentUsageRow {
  return {
    workerId: `id-${name}`,
    displayName: name,
    currentStatus: activeSeconds ? 'active' : null,
    signIns: activeSeconds ? 1 : 0,
    workspaceSessions: activeSeconds ? 2 : 0,
    onlineSeconds: activeSeconds,
    activeSeconds,
    activeDays: activeSeconds ? 1 : 0,
    uiActions: activeSeconds ? 4 : 0,
    workOutcomes: activeSeconds ? 2 : 0,
    ticketCreates: 0,
    escalationCreates: 0,
    automationStarted: 0,
    automationSucceeded: 0,
    automationFailed: 0,
    calls: 0,
    talkSeconds: 0,
    aiTurns: 0,
    aiToolCalls: 0,
    lastActivityAt: activeSeconds ? '2026-08-17T20:00:00.000Z' : null,
  };
}

function snapshot(overrides: Partial<MytrionUsageSnapshot> = {}): MytrionUsageSnapshot {
  return {
    scope: { mytrion: 'sales', population: 'sales_agent' },
    timeZone: 'America/New_York',
    range: { preset: 'last_7_days', from: '2026-08-11', to: '2026-08-17' },
    computedAt: '2026-08-18T08:05:00.000Z',
    population: { eligibleAgents: 2 },
    coverage: [
      {
        source: 'ui_activity',
        label: 'UI activity',
        status: 'partial',
        availableFrom: '2026-08-14T00:00:00.000Z',
        availableThrough: '2026-08-18T08:04:00.000Z',
        note: 'Collection began mid-window.',
      },
      {
        source: 'work_outcomes',
        label: 'Work outcomes',
        status: 'complete',
        availableFrom: '2026-08-11T00:00:00.000Z',
        availableThrough: '2026-08-18T08:04:00.000Z',
        note: null,
      },
    ],
    summary: {
      eligibleAgents: 2,
      activeAgents: 1,
      workspaceSessions: 2,
      onlineSeconds: 7_200,
      activeSeconds: 3_600,
      uiActions: 4,
      workOutcomes: 2,
    },
    days: [
      {
        date: '2026-08-17',
        partial: false,
        activeAgents: 1,
        workspaceSessions: 2,
        onlineSeconds: 7_200,
        activeSeconds: 3_600,
        uiActions: 4,
        workOutcomes: 2,
        aiTurns: 0,
      },
    ],
    agents: [agent('Used Agent', 3_600), agent('Zero Agent', 0)],
    breakdowns: {
      activity: [{ key: 'navigation.view_open', label: 'Views opened', count: 4 }],
      workOutcomes: [{ key: 'calls', label: 'Calls completed', count: 2 }],
      tickets: [],
      automations: [],
      ai: [],
    },
    ...overrides,
  };
}

function show(value: MytrionUsageSnapshot): void {
  mocks.useUsage.mockReturnValue({
    current: { snapshot: value },
    loading: false,
    refreshing: false,
    hasAttempted: true,
    refresh: vi.fn(async () => undefined),
  });
}

describe('MytrionDashboard', () => {
  beforeEach(() => {
    mocks.useUsage.mockReset();
    mocks.exportXlsx.mockReset();
  });

  it('shows coverage partial state and keeps zero-use roster rows visible', () => {
    show(snapshot());
    render(<MytrionDashboard filters={FILTERS} onFiltersChange={vi.fn()} />);
    expect(screen.getByText('Coverage and freshness')).toBeInTheDocument();
    expect(screen.getByText(/Some sources cover only part/)).toBeInTheDocument();
    expect(screen.getByText('Collection began mid-window.')).toBeInTheDocument();
    expect(screen.getAllByText('Zero Agent').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: /including agents with zero recorded usage/i })).toBeInTheDocument();
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    const zeroCard = cards.find((card) => card.textContent?.includes('Zero Agent'))!;
    expect(within(zeroCard).getByText('—')).toBeInTheDocument();
  });

  it('uses ascending order to expose the least-used agents first', () => {
    show(snapshot());
    render(<MytrionDashboard filters={FILTERS} onFiltersChange={vi.fn()} />);
    const table = screen.getByRole('table');
    expect(within(within(table).getAllByRole('row')[1]!).getByText('Used Agent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Most first/ }));
    expect(within(within(table).getAllByRole('row')[1]!).getByText('Zero Agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Least first/ })).toBeInTheDocument();
  });

  it('exposes daily values and announces refresh progress', () => {
    mocks.useUsage.mockReturnValue({
      current: { snapshot: snapshot() },
      loading: false,
      refreshing: true,
      hasAttempted: true,
      refresh: vi.fn(async () => undefined),
    });
    render(<MytrionDashboard filters={FILTERS} onFiltersChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toHaveAttribute('aria-busy', 'true');
    const values = screen.getByText('View daily values').closest('details');
    expect(values).not.toBeNull();
    expect(within(values!).getByText('17 Aug')).toBeInTheDocument();
    expect(within(values!).getByText('1h')).toBeInTheDocument();
  });

  it('labels an unavailable breakdown instead of converting it into an empty zero state', () => {
    const value = snapshot();
    show({
      ...value,
      coverage: value.coverage.map((item) =>
        item.source === 'ui_activity'
          ? { ...item, status: 'unavailable', availableFrom: null, availableThrough: null }
          : item,
      ),
      breakdowns: { ...value.breakdowns, activity: [] },
      summary: { ...value.summary, uiActions: null },
    });
    render(<MytrionDashboard filters={FILTERS} onFiltersChange={vi.fn()} />);
    expect(screen.getByText('This source is unavailable for the selected window.')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
