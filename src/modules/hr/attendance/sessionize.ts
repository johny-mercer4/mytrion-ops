import type { HrAttendancePunch } from '../../../db/schema/index.js';

export interface AttendancePunchSession {
  checkIn: Date;
  checkOut: Date | null;
  checkInDoor: string | null;
  checkOutDoor: string | null;
  durationMs: number;
  status: 'complete' | 'open' | 'needs_review';
}

export type AttendancePresenceState =
  | 'in_office'
  | 'out_of_office'
  | 'no_activity'
  | 'needs_review';

export interface AttendancePunchPairing {
  sessions: AttendancePunchSession[];
  firstIn: Date | null;
  lastOut: Date | null;
  totalMs: number;
  currentState: AttendancePresenceState;
  unmatchedPunches: number;
}

/** A forgotten checkout must not leave somebody "in office" forever. */
export const MAX_LIVE_ATTENDANCE_SESSION_MS = 16 * 60 * 60 * 1000;

export interface AttendancePairingOptions {
  /** Pass one request timestamp so every employee/day in a response uses the same clock. */
  now?: Date;
  maxLiveSessionMs?: number;
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
  options: AttendancePairingOptions = {},
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
      status: 'complete',
    });
    open = null;
  }

  if (open) {
    const elapsedMs = options.now
      ? Math.max(0, options.now.getTime() - open.punchedAt.getTime())
      : 0;
    const maxLiveSessionMs = options.maxLiveSessionMs ?? MAX_LIVE_ATTENDANCE_SESSION_MS;
    const isLive = options.now != null && elapsedMs <= maxLiveSessionMs;
    sessions.push({
      checkIn: open.punchedAt,
      checkOut: null,
      checkInDoor: open.doorName,
      checkOutDoor: null,
      durationMs: isLive ? elapsedMs : 0,
      status: options.now && !isLive ? 'needs_review' : 'open',
    });
  }

  const completed = sessions.filter((session) => session.status === 'complete');
  const active = sessions.at(-1);
  return {
    sessions,
    firstIn: sessions[0]?.checkIn ?? null,
    lastOut: completed.at(-1)?.checkOut ?? null,
    totalMs: sessions.reduce((total, session) => total + session.durationMs, 0),
    currentState:
      punches.length === 0
        ? 'no_activity'
        : active?.status === 'open'
          ? 'in_office'
          : active?.status === 'needs_review'
            ? 'needs_review'
            : 'out_of_office',
    unmatchedPunches,
  };
}
