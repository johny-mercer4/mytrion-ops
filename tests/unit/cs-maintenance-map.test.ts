/**
 * The Zoho `Maintenance` row → `maintenance_cases` mapper.
 *
 * Pure function, so no mocks: every assertion here pins a real trap discovered while reading the
 * live module (docs/crm-maintenance-module.md), and each one is silent if it regresses — a wrong
 * owner name renders as a plausible surname, a mis-cased carrier key reads as "no carrier", and a
 * dropped record just isn't in the list.
 */
import { describe, expect, it } from 'vitest';
import { mapMaintenanceRow, money } from '../../src/modules/customerService/maintenanceFields.js';

const OWNERS = new Map([
  ['9000000000000000001', 'Alex Rivera'],
  ['9000000000000000002', 'Dana Example'],
]);

/** A trimmed real record (see docs/crm-maintenance-module.md). */
const ROW: Record<string, unknown> = {
  id: '9000000000000000010',
  Name: 'Acme Hauling Llc',
  Company: { name: 'ACME HAULING LLC', id: '9000000000000000020' },
  Carrier_ID: '5000001',
  Unit_Number: '012',
  Status: 'In Process',
  Case_Type: 'Mechanical',
  Date: '2026-07-29',
  Case_Completion: '2026-07-29',
  Total_Amount: 500.0,
  Completion_Compensation: 5,
  Half_Completion_Compensation: 2.5,
  Lead_Compensation: 10,
  Reference_Number: 7000001,
  Invoiced: false,
  Card_Digits: null,
  Owner: { name: 'Example', id: '9000000000000000002' },
  Created_Time: '2026-07-29T09:39:37-04:00',
  Modified_Time: '2026-07-29T11:53:06-04:00',
};

describe('mapMaintenanceRow', () => {
  it('maps the identity + search keys', () => {
    const row = mapMaintenanceRow(ROW, OWNERS);
    expect(row.zohoRecordId).toBe('9000000000000000010');
    expect(row.source).toBe('zoho_migration');
    expect(row.name).toBe('Acme Hauling Llc');
    expect(row.companyName).toBe('ACME HAULING LLC');
    expect(row.companyZohoId).toBe('9000000000000000020');
    expect(row.carrierId).toBe('5000001');
  });

  it('reads Carrier_ID with a CAPITAL ID, and treats the Zelle/Chase spelling as absent', () => {
    // The org has both spellings across modules. Maintenance uses `Carrier_ID`; silently accepting
    // `Carrier_Id` here would hide a genuine mapping bug behind a passing test.
    expect(mapMaintenanceRow({ ...ROW, Carrier_ID: '5000001' }, OWNERS).carrierId).toBe('5000001');
    const wrongCase = mapMaintenanceRow({ ...ROW, Carrier_ID: null, Carrier_Id: '9999999' }, OWNERS);
    expect(wrongCase.carrierId).toBeNull();
  });

  it('keeps a zero-padded unit number as text', () => {
    // '012' through an integer column becomes 12, and the agent searching "012" finds nothing.
    expect(mapMaintenanceRow(ROW, OWNERS).unitNumber).toBe('012');
  });

  it('resolves the owner to a FULL name (COQL returns the last name only)', () => {
    expect(mapMaintenanceRow(ROW, OWNERS).ownerName).toBe('Dana Example');
  });

  it('falls back to the COQL last name when the owner is not in the directory', () => {
    // Deactivated users drop out of listActiveUsers. A blank owner on the card is worse than a
    // surname, so the fallback must never be null when Zoho gave us something.
    const row = mapMaintenanceRow({ ...ROW, Owner: { name: 'Chen', id: 'not-in-roster' } }, OWNERS);
    expect(row.ownerName).toBe('Chen');
    expect(row.ownerZohoUserId).toBe('not-in-roster');
  });

  it('tolerates a missing owner entirely', () => {
    const row = mapMaintenanceRow({ ...ROW, Owner: null }, OWNERS);
    expect(row.ownerZohoUserId).toBeNull();
    expect(row.ownerName).toBeNull();
  });

  it('formats currency at fixed scale, from a number or a separator-formatted string', () => {
    // This org returns plain numbers today; a multicurrency change starts returning "1,234.50",
    // which Number() alone turns into NaN.
    expect(mapMaintenanceRow(ROW, OWNERS).totalAmount).toBe('500.00');
    expect(mapMaintenanceRow({ ...ROW, Total_Amount: '1,234.5' }, OWNERS).totalAmount).toBe('1234.50');
    expect(mapMaintenanceRow({ ...ROW, Total_Amount: '$2,000' }, OWNERS).totalAmount).toBe('2000.00');
    expect(mapMaintenanceRow({ ...ROW, Total_Amount: null }, OWNERS).totalAmount).toBeNull();
    expect(mapMaintenanceRow({ ...ROW, Total_Amount: 'n/a' }, OWNERS).totalAmount).toBeNull();
  });

  it('truncates dates to YYYY-MM-DD and parses datetimes as instants', () => {
    const row = mapMaintenanceRow(ROW, OWNERS);
    expect(row.caseDate).toBe('2026-07-29');
    expect(row.caseCompletion).toBe('2026-07-29');
    // 09:39:37-04:00 is 13:39:37Z — keeping the local wall time would shift the day near midnight.
    expect((row.createdTime as Date).toISOString()).toBe('2026-07-29T13:39:37.000Z');
  });

  it('keeps a null completion date null rather than coercing it to a string', () => {
    expect(mapMaintenanceRow({ ...ROW, Case_Completion: null }, OWNERS).caseCompletion).toBeNull();
  });

  it("normalizes Zoho's synthetic '-None-' to null", () => {
    // '-None-' got stored as literal text on some records by an earlier widget build.
    expect(mapMaintenanceRow({ ...ROW, Case_Type: '-None-' }, OWNERS).caseType).toBeNull();
  });

  it('stores identifier-shaped numbers as text', () => {
    expect(mapMaintenanceRow(ROW, OWNERS).referenceNumber).toBe('7000001');
  });

  it('preserves boolean false rather than dropping it', () => {
    expect(mapMaintenanceRow(ROW, OWNERS).invoiced).toBe(false);
    expect(mapMaintenanceRow({ ...ROW, Invoiced: true }, OWNERS).invoiced).toBe(true);
    expect(mapMaintenanceRow({ ...ROW, Invoiced: null }, OWNERS).invoiced).toBeNull();
  });

  it('keeps unpromoted fields recoverable in raw', () => {
    const row = mapMaintenanceRow({ ...ROW, Some_Future_Field: 'kept' }, OWNERS);
    expect((row.raw as Record<string, unknown>).Some_Future_Field).toBe('kept');
  });

  it('throws when the row has no id, so the caller reports it instead of writing a keyless row', () => {
    expect(() => mapMaintenanceRow({ ...ROW, id: null }, OWNERS)).toThrow(/no id/);
    expect(() => mapMaintenanceRow({ ...ROW, id: '' }, OWNERS)).toThrow(/no id/);
  });
});

describe('money', () => {
  it('is null-safe and always fixed-scale', () => {
    expect(money(0)).toBe('0.00');
    expect(money(5)).toBe('5.00');
    expect(money(2.5)).toBe('2.50');
    expect(money(null)).toBeNull();
    expect(money(undefined)).toBeNull();
    expect(money('')).toBeNull();
  });
});
