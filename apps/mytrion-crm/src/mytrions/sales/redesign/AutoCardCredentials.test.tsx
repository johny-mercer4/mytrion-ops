import { describe, expect, it } from 'vitest';
import { mapCardCredentials } from './AutoCardCredentials';

describe('current EFS card credential mapping', () => {
  it('maps the direct getCard response without substituting cached values', () => {
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

  it('renders missing card-level prompts as empty values', () => {
    expect(mapCardCredentials({
      status: 'Inactive',
      unit_number: null,
      driver_id: null,
      driver_name: null,
    })).toEqual({
      status: 'Inactive',
      unitNumber: '',
      driverId: '',
      driverName: '',
    });
  });
});
