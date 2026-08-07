import { describe, expect, it } from 'vitest';
import type { HrEmployeeDto } from '../../api/hr';
import { sortDirectory } from './hrData';

function emp(over: Partial<HrEmployeeDto> & { id: string }): HrEmployeeDto {
  return {
    firstName: over.id,
    lastName: 'X',
    status: 'Active',
    department: null,
    ...over,
  } as HrEmployeeDto;
}

const ids = (rows: HrEmployeeDto[]): string[] => rows.map((r) => r.id);

/**
 * The rule this pins: everyone who has left sorts AFTER everyone who has not. Ordering by department
 * first put a leaver between two colleagues inside every department block, so the people who still work
 * here were never a contiguous run — which is what the directory is mostly used to read.
 */
describe('sortDirectory', () => {
  it('puts every terminated person after every active one', () => {
    const rows = sortDirectory([
      emp({ id: 'goneA', status: 'Terminated', department: 'Analytics' }),
      emp({ id: 'liveZ', status: 'Active', department: 'Zebra' }),
      emp({ id: 'goneZ', status: 'Terminated', department: 'Zebra' }),
      emp({ id: 'liveA', status: 'Active', department: 'Analytics' }),
    ]);
    // Not interleaved by department, which is what the old order produced.
    expect(ids(rows)).toEqual(['liveA', 'liveZ', 'goneA', 'goneZ']);
  });

  it('groups by department within each half, then by name', () => {
    const rows = sortDirectory([
      emp({ id: 'b', firstName: 'Bob', department: 'Sales' }),
      emp({ id: 'a', firstName: 'Ann', department: 'Sales' }),
      emp({ id: 'c', firstName: 'Cal', department: 'Finance' }),
    ]);
    expect(ids(rows)).toEqual(['c', 'a', 'b']);
  });

  it('sorts the unassigned last within their half, not first', () => {
    const rows = sortDirectory([
      emp({ id: 'none', department: null }),
      emp({ id: 'zeta', department: 'Zeta' }),
    ]);
    expect(ids(rows)).toEqual(['zeta', 'none']);
  });

  it('treats a blank department the same as no department', () => {
    const rows = sortDirectory([
      emp({ id: 'blank', department: '   ' }),
      emp({ id: 'zeta', department: 'Zeta' }),
    ]);
    expect(ids(rows)).toEqual(['zeta', 'blank']);
  });

  it('reads status case-insensitively, the way the rest of HR does', () => {
    // `status` is free text mirrored from Zoho, so the casing is not guaranteed.
    const rows = sortDirectory([
      emp({ id: 'gone', status: 'terminated' }),
      emp({ id: 'live', status: 'active' }),
    ]);
    expect(ids(rows)).toEqual(['live', 'gone']);
  });

  it('does not mutate the array it was given', () => {
    const input = [emp({ id: 'b', status: 'Terminated' }), emp({ id: 'a' })];
    sortDirectory(input);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});
