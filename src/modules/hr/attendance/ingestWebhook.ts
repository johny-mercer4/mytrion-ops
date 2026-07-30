/**
 * Ingest Hikvision / servercrm attendance events into hr_attendance_punches.
 * Mytrion-only — no Zoho People write.
 */
import { systemContext } from '../../auth/authService.js';
import { hrAttendancePunchRepo } from '../../../repos/hrAttendancePunchRepo.js';
import { hrAttendanceShiftRepo } from '../../../repos/hrAttendanceShiftRepo.js';
import { hrEmployeeRepo } from '../../../repos/hrEmployeeRepo.js';
import { doorKind, parseUzbWallClock, workDateForPunch } from './uzbTime.js';

export interface AttendanceWebhookEvent {
  empCode?: string;
  emp_code?: string;
  emp_name?: string;
  name?: string;
  event_date_time?: string;
  door_name?: string;
  [key: string]: unknown;
}

export interface IngestStats {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

function asEvents(body: unknown): AttendanceWebhookEvent[] {
  if (Array.isArray(body)) return body as AttendanceWebhookEvent[];
  if (body && typeof body === 'object') return [body as AttendanceWebhookEvent];
  return [];
}

export async function ingestAttendanceWebhook(
  body: unknown,
  requestId: string,
): Promise<IngestStats> {
  const ctx = systemContext(requestId);
  const events = asEvents(body);
  const stats: IngestStats = { success: 0, failed: 0, skipped: 0, errors: [] };

  for (const event of events) {
    try {
      const faceId = String(event.empCode ?? event.emp_code ?? '').trim();
      const doorName = String(event.door_name ?? '').trim();
      const rawTime = String(event.event_date_time ?? '').trim();
      if (!faceId || !rawTime || !doorName) {
        stats.skipped += 1;
        stats.errors.push('Missing empCode, event_date_time, or door_name');
        continue;
      }
      const kind = doorKind(doorName);
      if (!kind) {
        stats.skipped += 1;
        stats.errors.push(`Unrecognized door_name: ${doorName}`);
        continue;
      }
      const punchedAt = parseUzbWallClock(rawTime);
      const employee = await hrEmployeeRepo.findByFaceId(ctx, faceId);
      let shift: { startLocal: string; endLocal: string } | null = null;
      if (employee) {
        const calDate = workDateForPunch(punchedAt, null);
        const asg = await hrAttendanceShiftRepo.assignmentForDate(ctx, employee.id, calDate);
        if (asg) shift = { startLocal: asg.shift.startLocal, endLocal: asg.shift.endLocal };
      }
      // Recompute work_date with shift overnight rule once we know the shift.
      const workDate = workDateForPunch(punchedAt, shift);
      if (employee && shift) {
        // If overnight moved the day, re-resolve assignment for that work_date (usually same).
        const asg2 = await hrAttendanceShiftRepo.assignmentForDate(ctx, employee.id, workDate);
        if (asg2) {
          shift = { startLocal: asg2.shift.startLocal, endLocal: asg2.shift.endLocal };
        }
      }
      const finalWorkDate = workDateForPunch(punchedAt, shift);
      const outcome = await hrAttendancePunchRepo.insert(ctx, {
        employeeId: employee?.id ?? null,
        faceId,
        kind,
        punchedAt,
        workDate: finalWorkDate,
        source: 'hikvision',
        doorName,
        rawEvent: event as Record<string, unknown>,
      });
      if (outcome === 'duplicate') {
        stats.skipped += 1;
      } else {
        stats.success += 1;
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return stats;
}
