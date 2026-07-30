import type { HrAttendancePunch } from '../../../db/schema/index.js';

export interface AttendancePunchSession {
  checkIn: Date;
  checkOut: Date | null;
  checkInDoor: string | null;
  checkOutDoor: string | null;
  durationMs: number;
}

export interface AttendancePunchPairing {
  sessions: AttendancePunchSession[];
  firstIn: Date | null;
  lastOut: Date | null;
  totalMs: number;
  currentState: 'in_office' | 'out_of_office' | 'no_activity';
  unmatchedPunches: number;
}

/**
 * Turn a device event stream into actual office sessions.
 *
 * Repeated entry scans while someone is already inside keep the earliest entry; an exit closes the
 * open session. This avoids inflating hours when a person scans at two internal entry readers while
 * moving through the building, and it sums multiple valid in/out visits instead of treating the
 * entire first-in → last-out span as time in the office.
 */
export function pairAttendancePunches(
  input: readonly HrAttendancePunch[],
): AttendancePunchPairing {
  const punches = [...input].sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());
  const sessions: AttendancePunchSession[] = [];
  let open: HrAttendancePunch | null = null;
  let unmatchedPunches = 0;

  for (const punch of punches) {
    if (punch.kind === 'check_in') {
      if (open) {
        unmatchedPunches += 1;
      } else {
        open = punch;
      }
      continue;
    }

    if (!open || punch.punchedAt.getTime() <= open.punchedAt.getTime()) {
      unmatchedPunches += 1;
      continue;
    }

    sessions.push({
      checkIn: open.punchedAt,
      checkOut: punch.punchedAt,
      checkInDoor: open.doorName,
      checkOutDoor: punch.doorName,
      durationMs: punch.punchedAt.getTime() - open.punchedAt.getTime(),
    });
    open = null;
  }

  if (open) {
    sessions.push({
      checkIn: open.punchedAt,
      checkOut: null,
      checkInDoor: open.doorName,
      checkOutDoor: null,
      durationMs: 0,
    });
  }

  const completed = sessions.filter((session) => session.checkOut);
  return {
    sessions,
    firstIn: sessions[0]?.checkIn ?? null,
    lastOut: completed.at(-1)?.checkOut ?? null,
    totalMs: completed.reduce((total, session) => total + session.durationMs, 0),
    currentState:
      punches.length === 0
        ? 'no_activity'
        : punches.at(-1)?.kind === 'check_in'
          ? 'in_office'
          : 'out_of_office',
    unmatchedPunches,
  };
}
