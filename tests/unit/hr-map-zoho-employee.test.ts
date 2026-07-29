import { describe, expect, it } from 'vitest';
import { mapZohoEmployeeToUpsert } from '../../src/modules/hr/mapZohoEmployee.js';

describe('mapZohoEmployeeToUpsert', () => {
  it('projects Zoho People labelnames into hr_employees columns', () => {
    const mapped = mapZohoEmployeeToUpsert({
      recordId: 'zp_99',
      fields: {
        FirstName: 'Grace',
        LastName: 'Hopper',
        EmployeeID: 'HRM99',
        EmailID: 'grace@example.com',
        Department: 'Engineering',
        'Department.ID': 'zp_dept_1',
        Designation: 'Admiral',
        LocationName: 'NYC',
        Employeestatus: 'Active',
        Role: 'Staff',
        Dateofjoining: '09-Dec-1943',
        Mobile: '+1',
        Face_ID: '00000390',
        Reporting_To: 'Boss',
        'Reporting_To.ID': 'zp_1',
        Photo_downloadUrl: 'https://example.com/p.jpg',
      },
    });
    expect(mapped).toMatchObject({
      zohoRecordId: 'zp_99',
      employeeId: 'HRM99',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      department: 'Engineering',
      departmentZohoId: 'zp_dept_1',
      designation: 'Admiral',
      location: 'NYC',
      status: 'Active',
      faceId: '00000390',
      reportingToZohoId: 'zp_1',
      photoUrl: 'https://example.com/p.jpg',
    });
  });

  it('falls back to Unknown when names are missing', () => {
    const mapped = mapZohoEmployeeToUpsert({ recordId: 'zp_0', fields: {} });
    expect(mapped.firstName).toBe('Unknown');
    expect(mapped.lastName).toBe('Unknown');
    expect(mapped.status).toBe('Active');
  });
});
