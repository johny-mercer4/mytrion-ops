import { describe, expect, it } from 'vitest';
import { carrierToCreatePayload } from './carrierLead';
import type { CarrierSearchVM } from './live';

const base: CarrierSearchVM = {
  id: '1',
  dot: '602070',
  owner: 'Jane Marie Doe',
  phone: '(555) 123-4567',
  email: 'jane@example.com',
  status: 'Authorized',
  units: '12',
  unitsNum: 12,
  address: '1 Main St',
  truckSize: '53',
  addDate: '2024-01-15T12:00:00Z',
  changeDate: '2024-06-01',
};

describe('carrierToCreatePayload', () => {
  it('splits owner name and maps FMCSA fields like the widget', () => {
    expect(carrierToCreatePayload(base)).toEqual({
      firstName: 'Jane Marie',
      lastName: 'Doe',
      companyName: 'Jane Marie Doe',
      phone: '5551234567',
      email: 'jane@example.com',
      dot: '602070',
      fullAddress: '1 Main St',
      truckSize: '53',
      powerUnits: '12',
      addDate: '2024-01-15',
      changeDate: '2024-06-01',
      operatingStatus: 'Authorized',
    });
  });

  it('uses Unknown when owner is blank', () => {
    const p = carrierToCreatePayload({ ...base, owner: '—', phone: '—', email: '—' });
    expect(p.lastName).toBe('Unknown');
    expect(p.companyName).toBe('Unknown');
    expect(p.phone).toBe('');
    expect(p.email).toBeUndefined();
  });
});
