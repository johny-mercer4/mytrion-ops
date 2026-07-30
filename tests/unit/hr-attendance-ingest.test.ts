import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    findByFaceId: vi.fn(),
  },
}));

vi.mock('../../src/repos/hrAttendanceShiftRepo.js', () => ({
  hrAttendanceShiftRepo: {
    assignmentForDate: vi.fn(async () => undefined),
  },
}));

vi.mock('../../src/repos/hrAttendancePunchRepo.js', () => ({
  hrAttendancePunchRepo: {
    insert: vi.fn(async () => 'inserted'),
    linkUnmappedForEmployee: vi.fn(async () => 0),
  },
}));

import { ingestAttendanceWebhook } from '../../src/modules/hr/attendance/ingestWebhook.js';
import { hrAttendancePunchRepo } from '../../src/repos/hrAttendancePunchRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';

const employees = vi.mocked(hrEmployeeRepo);
const punches = vi.mocked(hrAttendancePunchRepo);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('attendance webhook ingestion', () => {
  it('ignores every non-Ganga reader before employee lookup or insert', async () => {
    const result = await ingestAttendanceWebhook(
      {
        emp_code: '00000215',
        door_name: 'Oybek 3F Entry',
        event_date_time: '2026-07-30T20:25:08',
      },
      'req_filter',
    );

    expect(result).toMatchObject({ success: 0, failed: 0, skipped: 1 });
    expect(result.errors[0]).toContain('non-Ganga');
    expect(employees.findByFaceId).not.toHaveBeenCalled();
    expect(punches.insert).not.toHaveBeenCalled();
  });

  it('stores Ganga time as the correct UTC instant and maps by Face ID', async () => {
    employees.findByFaceId.mockResolvedValueOnce({
      id: 'hre_farxod',
      tenantId: 'octane',
      firstName: 'Farxod',
      lastName: 'Karimov',
      faceId: '215',
    } as never);

    const result = await ingestAttendanceWebhook(
      {
        emp_code: '00000215',
        door_name: 'Ganga 5F Entry',
        event_date_time: '2026-07-30T20:25:08',
      },
      'req_map',
    );

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 0 });
    expect(punches.linkUnmappedForEmployee).toHaveBeenCalledWith(
      expect.anything(),
      'hre_farxod',
      '00000215',
    );
    expect(punches.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        employeeId: 'hre_farxod',
        kind: 'check_in',
        workDate: '2026-07-30',
        doorName: 'Ganga 5F Entry',
        punchedAt: new Date('2026-07-30T15:25:08.000Z'),
      }),
    );
  });

  it('keeps an unknown Ganga Face ID for later reconciliation', async () => {
    employees.findByFaceId.mockResolvedValueOnce(undefined);

    await ingestAttendanceWebhook(
      {
        emp_code: '00000803',
        door_name: 'Ganga 5F Exit',
        event_date_time: '2026-07-30T22:00:00',
      },
      'req_unmapped',
    );

    expect(punches.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: null, faceId: '00000803', kind: 'check_out' }),
    );
  });
});
