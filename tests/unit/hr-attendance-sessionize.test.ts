import { describe, expect, it } from 'vitest';
import type { HrAttendancePunch } from '../../src/db/schema/index.js';
import { pairAttendancePunches } from '../../src/modules/hr/attendance/sessionize.js';
import { parseUzbWallClock } from '../../src/modules/hr/attendance/uzbTime.js';

function punch(
  kind: 'check_in' | 'check_out',
  localTime: string,
  id: string,
): HrAttendancePunch {
  return {
    id,
    tenantId: 'octane',
    employeeId: 'hre_1',
    faceId: '00000215',
    kind,
    punchedAt: parseUzbWallClock(`2026-07-30 ${localTime}`),
    workDate: '2026-07-30',
    source: 'hikvision',
    doorName: kind === 'check_in' ? 'Ganga 5F Entry' : 'Ganga 5F Exit',
    note: null,
    rawEvent: null,
    createdAt: new Date(),
  };
}

describe('attendance session pairing', () => {
  it('sums separate visits instead of first-in to last-out', () => {
    const result = pairAttendancePunches([
      punch('check_in', '19:00:00', '1'),
      punch('check_out', '21:00:00', '2'),
      punch('check_in', '22:00:00', '3'),
      punch('check_out', '23:30:00', '4'),
    ]);

    expect(result.sessions).toHaveLength(2);
    expect(result.totalMs).toBe(3.5 * 60 * 60 * 1000);
    expect(result.currentState).toBe('out_of_office');
    expect(result.unmatchedPunches).toBe(0);
  });

  it('keeps the earliest entry when internal readers produce repeated check-ins', () => {
    const result = pairAttendancePunches([
      punch('check_in', '19:00:00', '1'),
      punch('check_in', '19:03:00', '2'),
      punch('check_out', '20:00:00', '3'),
    ]);

    expect(result.sessions).toHaveLength(1);
    expect(result.totalMs).toBe(60 * 60 * 1000);
    expect(result.unmatchedPunches).toBe(1);
  });

  it('exposes an open in-office session without inventing worked time', () => {
    const result = pairAttendancePunches([punch('check_in', '19:00:00', '1')]);

    expect(result.sessions[0]?.checkOut).toBeNull();
    expect(result.totalMs).toBe(0);
    expect(result.currentState).toBe('in_office');
  });
});
