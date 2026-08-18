/**
 * Attendance → a real .xlsx (not CSV): the team roster, or one person's week.
 *
 * ExcelJS is dynamically imported so its large chunk only loads on an actual export — the same
 * approach the analyst / billing / sales exports use. Counts are written as numbers so the sheet
 * sorts, filters and SUMs; times stay as the Tashkent wall-clock strings the API already formats.
 *
 * Gating lives at the call site: only the roster pane (team leads / managers / HR / admins) renders
 * these buttons — a plain employee never reaches them. The backend still re-checks every read.
 */
import { deliverExport } from '../../lib/deliverExport';
import type { AttendanceSummaryDto, AttendanceTeamListItem } from '../../api/hr';

const HEAD_FILL = 'FF1E293B';
const HEAD_INK = 'FFFFFFFF';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PRESENCE: Record<string, string> = {
  in_office: 'In office',
  out_of_office: 'Out of office',
  needs_review: 'Needs review',
  no_activity: 'No activity',
};

/** Excel forbids []:*?/\ in sheet names and caps them at 31 chars. */
function safeSheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Attendance';
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
}

async function deliver(buffer: ArrayBuffer, filename: string): Promise<void> {
  await deliverExport(new Blob([buffer], { type: XLSX_MIME }), filename);
}

/** The whole roster for a week — one row per person, with the weekly tally. */
export async function exportTeamAttendanceXlsx(input: {
  items: AttendanceTeamListItem[];
  weekLabel: string;
  scopeLabel: string;
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(`${input.scopeLabel} ${input.weekLabel}`), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Name', width: 26 },
    { header: 'Employee ID', width: 14 },
    { header: 'Department', width: 22 },
    { header: 'Designation', width: 22 },
    { header: 'Shift', width: 24 },
    { header: 'Present', width: 10 },
    { header: 'Absent', width: 10 },
    { header: 'Weekend', width: 10 },
    { header: 'Unscheduled', width: 12 },
    { header: 'Right now', width: 14 },
    { header: 'Last scan', width: 22 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: HEAD_INK } };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  });
  for (const it of input.items) {
    ws.addRow([
      `${it.firstName} ${it.lastName}`.trim(),
      it.employeeCode ?? '',
      it.department ?? '',
      it.designation ?? '',
      it.shift ? `${it.shift.name} (${it.shift.startLocal}–${it.shift.endLocal})` : '',
      it.totals?.present ?? 0,
      it.totals?.absent ?? 0,
      it.totals?.weekend ?? 0,
      it.totals?.unscheduled ?? 0,
      PRESENCE[it.currentState] ?? it.currentState,
      it.lastPunch?.localDateTime ?? '',
    ]);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 11 } };
  const buffer = await wb.xlsx.writeBuffer();
  await deliver(buffer, `attendance-${slug(input.scopeLabel)}-${input.weekLabel}.xlsx`);
}

/** One person's week — a day per row, plus each visit's check-in/out. */
export async function exportPersonAttendanceXlsx(input: {
  summary: AttendanceSummaryDto;
  name: string;
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(safeSheetName(input.name), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Date', width: 14 },
    { header: 'Status', width: 14 },
    { header: 'First in', width: 12 },
    { header: 'Last out', width: 12 },
    { header: 'Hours', width: 10 },
    { header: 'Check-in', width: 12 },
    { header: 'Check-out', width: 12 },
    { header: 'Visit', width: 12 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: HEAD_INK } };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  });
  for (const day of input.summary.days) {
    if (day.sessions.length === 0) {
      ws.addRow([day.date, day.status, day.firstIn ?? '', day.lastOut ?? '', day.hoursWorked, '', '', '']);
      continue;
    }
    // A day with visits gets one row per visit, so a split shift is legible rather than collapsed.
    day.sessions.forEach((s, i) => {
      ws.addRow([
        i === 0 ? day.date : '',
        i === 0 ? day.status : '',
        i === 0 ? (day.firstIn ?? '') : '',
        i === 0 ? (day.lastOut ?? '') : '',
        i === 0 ? day.hoursWorked : '',
        s.checkIn,
        s.checkOut ?? (s.status === 'needs_review' ? 'Missing' : 'Still inside'),
        s.status === 'needs_review' ? '—' : s.duration,
      ]);
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  await deliver(buffer, `attendance-${slug(input.name)}-${input.summary.from}.xlsx`);
}
