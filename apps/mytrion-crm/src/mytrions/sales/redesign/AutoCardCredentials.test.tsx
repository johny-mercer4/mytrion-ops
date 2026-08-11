import { describe, expect, it } from 'vitest';
import { mapCardCredentials } from './AutoCardCredentials';

describe('current EFS card credential mapping', () => {
  it('maps a live efs.cards row without substituting cached values', () => {
    expect(mapCardCredentials({
      status: 'Active',
      unit_number: 'UNIT-12',
      driver_id: 'DR-99',
      driver_name: 'Alex Driver',
    })).toEqual({
      status: 'Active',
      unitNumber: 'UNIT-12',
      driverId: 'DR-99',
      driverName: 'Alex Driver',
    });
  });

  it('accepts camelCase EFS fields and empty prompts', () => {
    expect(mapCardCredentials({
      status: 'Inactive',
      unitNumber: null,
      driverId: null,
      driverName: null,
    })).toEqual({
      status: 'Inactive',
      unitNumber: '',
      driverId: '',
      driverName: '',
    });
  });
});
