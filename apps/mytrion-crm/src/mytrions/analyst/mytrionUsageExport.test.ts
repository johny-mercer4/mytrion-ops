import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import type { MytrionUsageSnapshot } from '@/api/analytics';

import { buildMytrionUsageWorkbook } from './mytrionUsageExport';

const SNAPSHOT: MytrionUsageSnapshot = {
  scope: { mytrion: 'sales', population: 'sales_agent' },
  timeZone: 'America/New_York',
  range: { preset: 'last_7_days', from: '2026-08-11', to: '2026-08-17' },
  computedAt: '2026-08-18T08:05:00.000Z',
  population: { eligibleAgents: 2 },
  coverage: [
    {
      source: 'presence',
      label: 'Browser presence',
      status: 'partial',
      availableFrom: '2026-08-14T00:00:00.000Z',
      availableThrough: '2026-08-18T08:04:00.000Z',
      note: 'Collection began mid-window.',
    },
  ],
  summary: {
    eligibleAgents: 2,
    activeAgents: 1,
    workspaceSessions: 3,
    onlineSeconds: 7_200,
    activeSeconds: 3_600,
    uiActions: 12,
    workOutcomes: 4,
  },
  days: [
    {
      date: '2026-08-17',
      partial: false,
      activeAgents: 1,
      workspaceSessions: 3,
      onlineSeconds: 7_200,
      activeSeconds: 3_600,
      uiActions: 12,
      workOutcomes: 4,
      aiTurns: 2,
    },
  ],
  agents: [
    {
      workerId: 'zoho:raw-id-must-not-export',
      displayName: 'Ada Agent',
      currentStatus: 'active',
      signIns: 1,
      workspaceSessions: 3,
      onlineSeconds: 7_200,
      activeSeconds: 3_600,
      activeDays: 1,
      uiActions: 12,
      workOutcomes: 4,
      ticketCreates: 1,
      escalationCreates: 1,
      automationStarted: 2,
      automationSucceeded: 1,
      automationFailed: 1,
      calls: 2,
      talkSeconds: 900,
      aiTurns: 2,
      aiToolCalls: 5,
      lastActivityAt: '2026-08-17T20:00:00.000Z',
    },
  ],
  breakdowns: {
    activity: [{ key: 'navigation.view_open', label: 'Views opened', count: 4 }],
    workOutcomes: [{ key: 'calls', label: 'Calls completed', count: 2 }],
    tickets: [{ key: 'ticket', label: 'Tickets created', count: 1 }],
    automations: [{ key: 'succeeded', label: 'Succeeded', count: 1 }],
    ai: [{ key: 'turns', label: 'Completed turns', count: 2 }],
  },
};

async function workbook(): Promise<ExcelJS.Workbook> {
  const buffer = await buildMytrionUsageWorkbook(SNAPSHOT);
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(buffer);
  return result;
}

describe('Sales Mytrion usage workbook', () => {
  it('contains the eight requested filtered aggregate sheets', async () => {
    expect((await workbook()).worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Agents',
      'Daily Trend',
      'Activity',
      'Tickets',
      'Automations',
      'AI Usage',
      'Coverage',
    ]);
  });

  it('exports typed aggregate cells and omits the internal worker id', async () => {
    const result = await workbook();
    const agents = result.getWorksheet('Agents')!;
    expect(agents.getCell('A5').value).toBe('Ada Agent');
    expect(typeof agents.getCell('C5').value).toBe('number');
    expect(agents.getCell('S5').value).toBeInstanceOf(Date);
    expect((agents.getCell('S5').value as Date).getUTCHours()).toBe(16);
    expect(agents.getCell('S4').value).toBe('Last activity (America/New_York)');

    const text = result.worksheets
      .flatMap((sheet) => sheet.getSheetValues())
      .join(' ');
    expect(text).not.toContain('raw-id-must-not-export');
    expect(text.toLowerCase()).not.toContain('prompt');
  });

  it('carries coverage status and filtered date range into the workbook', async () => {
    const result = await workbook();
    const coverage = result.getWorksheet('Coverage')!;
    expect(coverage.getCell('A5').value).toBe('Browser presence');
    expect(coverage.getCell('B5').value).toBe('partial');
    expect(String(coverage.getCell('A2').value)).toContain('2026-08-11 → 2026-08-17');
  });
});
