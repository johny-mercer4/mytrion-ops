/**
 * diffMaintenanceCase — the Timeline History entry builder (CS feedback 2026-07-31). Pure
 * function: given the row's prior values (or null on create) and exactly what a save wrote, it
 * produces the "field was updated from X to Y" list the CRM's Timeline shows.
 */
import { describe, expect, it } from 'vitest';
import { diffMaintenanceCase } from '../../src/modules/customerService/maintenanceFields.js';

describe('on create (before = null)', () => {
  it('reports every field the create actually set, each "from blank"', () => {
    const out = diffMaintenanceCase(null, { name: 'ACME', status: 'In Process' });
    expect(out).toEqual([
      { field: 'name', label: 'Company Name', from: null, to: 'ACME' },
      { field: 'status', label: 'Status', from: null, to: 'In Process' },
    ]);
  });

  it('does not report a field the create left null', () => {
    const out = diffMaintenanceCase(null, { name: 'ACME', referenceNumber: null });
    expect(out).toEqual([{ field: 'name', label: 'Company Name', from: null, to: 'ACME' }]);
  });
});

describe('on update (before = the prior row)', () => {
  it('reports only fields that actually changed', () => {
    const out = diffMaintenanceCase(
      { status: 'In Process', referenceNumber: '7000001' },
      { status: 'Completed', referenceNumber: '7000001' },
    );
    expect(out).toEqual([{ field: 'status', label: 'Status', from: 'In Process', to: 'Completed' }]);
  });

  it('produces no entries for a no-op patch (field resent with its existing value)', () => {
    const out = diffMaintenanceCase({ status: 'Completed' }, { status: 'Completed' });
    expect(out).toEqual([]);
  });

  it('reports clearing a field as "to null"', () => {
    const out = diffMaintenanceCase({ referenceNumber: '7000001' }, { referenceNumber: null });
    expect(out).toEqual([{ field: 'referenceNumber', label: 'Reference Number', from: '7000001', to: null }]);
  });

  it('reports a field the prior row never had as "from blank"', () => {
    const out = diffMaintenanceCase({}, { driverName: 'J. Smith' });
    expect(out).toEqual([{ field: 'driverName', label: 'Driver Name', from: null, to: 'J. Smith' }]);
  });
});

describe('id-only fields', () => {
  it('never surfaces a bare CRM/Zoho id — the paired *Name field already says it', () => {
    const out = diffMaintenanceCase(null, {
      ownerZohoUserId: '9000000000000000002',
      ownerName: 'Dana Example',
      bonusCompletionUserId: '9000000000000000003',
      bonusCompletionName: 'Alex Rivera',
      companyZohoId: '9000000000000000020',
      companyName: 'ACME HAULING LLC',
    });
    expect(out).toEqual([
      { field: 'ownerName', label: 'Owner', from: null, to: 'Dana Example' },
      { field: 'bonusCompletionName', label: 'Second Agent', from: null, to: 'Alex Rivera' },
      { field: 'companyName', label: 'Company', from: null, to: 'ACME HAULING LLC' },
    ]);
  });
});
