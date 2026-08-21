import type { MytrionUsageBreakdownRow, MytrionUsageSnapshot } from '@/api/analytics';
import { deliverExport } from '@/lib/deliverExport';

type ExportValue = string | number | Date | null;

interface ExportColumn {
  label: string;
  width: number;
  format?: string;
}

const FONT = 'Arial';
const COLOR = {
  ink: 'FF0F172A',
  muted: 'FF64748B',
  header: 'FF1E293B',
  band: 'FFF8FAFC',
  line: 'FFE2E8F0',
  white: 'FFFFFFFF',
};

const COUNT = '#,##0';
const DATE_TIME = 'yyyy-mm-dd hh:mm';

function isoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

function zonedInstant(value: string | null, timeZone: string): Date | null {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return new Date(Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
  ));
}

function zonedInstantText(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

function breakdownRows(rows: MytrionUsageBreakdownRow[]): ExportValue[][] {
  return rows.map((row) => [row.label, row.count]);
}

/** Creates the filtered workbook from the same safe aggregate snapshot rendered on screen. */
export async function buildMytrionUsageWorkbook(
  snapshot: MytrionUsageSnapshot,
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(snapshot.computedAt);
  workbook.creator = 'Mytrion Analytics';

  const addSheet = (
    name: string,
    columns: ExportColumn[],
    rows: ExportValue[][],
  ): void => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.columns = columns.map((column) => ({ width: column.width }));
    sheet.mergeCells(1, 1, 1, columns.length);
    const title = sheet.getCell(1, 1);
    title.value = name;
    title.font = { name: FONT, size: 16, bold: true, color: { argb: COLOR.ink } };
    sheet.mergeCells(2, 1, 2, columns.length);
    const context = sheet.getCell(2, 1);
    context.value = `${snapshot.range.from} → ${snapshot.range.to} · ${snapshot.timeZone} · computed ${zonedInstantText(snapshot.computedAt, snapshot.timeZone)}`;
    context.font = { name: FONT, size: 10, color: { argb: COLOR.muted } };

    const header = sheet.getRow(4);
    columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.label;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLOR.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.header } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });

    rows.forEach((values, rowIndex) => {
      const row = sheet.getRow(rowIndex + 5);
      values.forEach((value, columnIndex) => {
        const cell = row.getCell(columnIndex + 1);
        cell.value = value;
        const format = columns[columnIndex]?.format;
        if (format) cell.numFmt = format;
        cell.font = { name: FONT, size: 10, color: { argb: COLOR.ink } };
        cell.border = { bottom: { style: 'hair', color: { argb: COLOR.line } } };
        if (rowIndex % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.band } };
        }
      });
    });
    sheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: 4 + Math.max(rows.length, 1), column: columns.length },
    };
  };

  addSheet(
    'Summary',
    [
      { label: 'Metric', width: 28 },
      { label: 'Value', width: 18, format: COUNT },
      { label: 'Unit', width: 18 },
    ],
    [
      ['Eligible Sales agents', snapshot.summary.eligibleAgents, 'agents'],
      ['Active agents', snapshot.summary.activeAgents, 'agents'],
      ['Workspace sessions', snapshot.summary.workspaceSessions, 'sessions'],
      ['Online time', snapshot.summary.onlineSeconds, 'seconds'],
      ['Active time', snapshot.summary.activeSeconds, 'seconds'],
      ['UI actions', snapshot.summary.uiActions, 'actions'],
      ['Work outcomes', snapshot.summary.workOutcomes, 'outcomes'],
    ],
  );

  addSheet(
    'Agents',
    [
      { label: 'Agent', width: 28 },
      { label: 'Current status', width: 16 },
      { label: 'Sign-ins', width: 12, format: COUNT },
      { label: 'Workspace sessions', width: 18, format: COUNT },
      { label: 'Online seconds', width: 16, format: COUNT },
      { label: 'Active seconds', width: 16, format: COUNT },
      { label: 'Active days', width: 13, format: COUNT },
      { label: 'UI actions', width: 13, format: COUNT },
      { label: 'Work outcomes', width: 15, format: COUNT },
      { label: 'Tickets created', width: 15, format: COUNT },
      { label: 'Escalations created', width: 18, format: COUNT },
      { label: 'Automations started', width: 18, format: COUNT },
      { label: 'Automations succeeded', width: 20, format: COUNT },
      { label: 'Automations failed', width: 18, format: COUNT },
      { label: 'Calls', width: 10, format: COUNT },
      { label: 'Talk seconds', width: 14, format: COUNT },
      { label: 'AI turns', width: 11, format: COUNT },
      { label: 'AI tool calls', width: 13, format: COUNT },
      { label: `Last activity (${snapshot.timeZone})`, width: 28, format: DATE_TIME },
    ],
    snapshot.agents.map((agent) => [
      agent.displayName,
      agent.currentStatus,
      agent.signIns,
      agent.workspaceSessions,
      agent.onlineSeconds,
      agent.activeSeconds,
      agent.activeDays,
      agent.uiActions,
      agent.workOutcomes,
      agent.ticketCreates,
      agent.escalationCreates,
      agent.automationStarted,
      agent.automationSucceeded,
      agent.automationFailed,
      agent.calls,
      agent.talkSeconds,
      agent.aiTurns,
      agent.aiToolCalls,
      zonedInstant(agent.lastActivityAt, snapshot.timeZone),
    ]),
  );

  addSheet(
    'Daily Trend',
    [
      { label: 'Date', width: 14, format: 'yyyy-mm-dd' },
      { label: 'Partial day', width: 12 },
      { label: 'Active agents', width: 14, format: COUNT },
      { label: 'Workspace sessions', width: 18, format: COUNT },
      { label: 'Online seconds', width: 16, format: COUNT },
      { label: 'Active seconds', width: 16, format: COUNT },
      { label: 'UI actions', width: 13, format: COUNT },
      { label: 'Work outcomes', width: 15, format: COUNT },
      { label: 'AI turns', width: 11, format: COUNT },
    ],
    snapshot.days.map((day) => [
      isoDate(day.date),
      day.partial ? 'Yes' : 'No',
      day.activeAgents,
      day.workspaceSessions,
      day.onlineSeconds,
      day.activeSeconds,
      day.uiActions,
      day.workOutcomes,
      day.aiTurns,
    ]),
  );

  addSheet(
    'Activity',
    [{ label: 'Semantic action', width: 34 }, { label: 'Count', width: 14, format: COUNT }],
    breakdownRows(snapshot.breakdowns.activity),
  );
  addSheet(
    'Tickets',
    [{ label: 'Ticket or escalation type', width: 36 }, { label: 'Count', width: 14, format: COUNT }],
    breakdownRows(snapshot.breakdowns.tickets),
  );
  addSheet(
    'Automations',
    [{ label: 'Automation outcome', width: 34 }, { label: 'Count', width: 14, format: COUNT }],
    breakdownRows(snapshot.breakdowns.automations),
  );
  addSheet(
    'AI Usage',
    [{ label: 'AI activity', width: 34 }, { label: 'Count', width: 14, format: COUNT }],
    breakdownRows(snapshot.breakdowns.ai),
  );
  addSheet(
    'Coverage',
    [
      { label: 'Source', width: 24 },
      { label: 'Status', width: 14 },
      { label: `Available from (${snapshot.timeZone})`, width: 28, format: DATE_TIME },
      { label: `Available through (${snapshot.timeZone})`, width: 28, format: DATE_TIME },
      { label: 'Note', width: 52 },
    ],
    snapshot.coverage.map((coverage) => [
      coverage.label,
      coverage.status,
      zonedInstant(coverage.availableFrom, snapshot.timeZone),
      zonedInstant(coverage.availableThrough, snapshot.timeZone),
      coverage.note,
    ]),
  );

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function exportMytrionUsageXlsx(snapshot: MytrionUsageSnapshot): Promise<void> {
  const buffer = await buildMytrionUsageWorkbook(snapshot);
  await deliverExport(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `sales-mytrion-usage-${snapshot.range.from}-to-${snapshot.range.to}.xlsx`,
  );
}
