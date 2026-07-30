import { describe, expect, it } from 'vitest';
import { mapZohoDepartmentToUpsert } from '../../src/modules/hr/mapZohoDepartment.js';

describe('mapZohoDepartmentToUpsert', () => {
  it('projects Zoho People department labelnames', () => {
    const mapped = mapZohoDepartmentToUpsert({
      recordId: 'zp_d1',
      fields: {
        Department: 'Marketing',
        Department_Code: 'MKT',
        MailAlias: 'mkt@example.com',
        Department_Lead: 'Ada Lovelace',
        'Department_Lead.ID': 'zp_e1',
        'Department_Lead.MailID': 'ada@example.com',
        Parent_Department: 'Operations',
        'Parent_Department.ID': 'zp_d0',
      },
    });
    expect(mapped).toMatchObject({
      zohoRecordId: 'zp_d1',
      name: 'Marketing',
      code: 'MKT',
      mailAlias: 'mkt@example.com',
      leadName: 'Ada Lovelace',
      leadZohoId: 'zp_e1',
      leadEmail: 'ada@example.com',
      parentName: 'Operations',
      parentZohoId: 'zp_d0',
    });
  });

  it('falls back to Untitled when name missing', () => {
    const mapped = mapZohoDepartmentToUpsert({ recordId: 'zp_0', fields: {} });
    expect(mapped.name).toBe('Untitled');
  });
});
