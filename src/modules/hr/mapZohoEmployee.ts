/**
 * Map a Zoho People employee getRecords row → projected hr_employees columns.
 * Field keys are Zoho labelnames (see peopleSchema / meta:zoho-people).
 */
import type { EmployeeRecord } from '../../integrations/zohoPeople.js';
import type { UpsertFromZohoInput } from '../../repos/hrEmployeeSyncRepo.js';

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Zoho dates often arrive as `25-Jan-2023` or ISO — store as trimmed display string for now. */
function dateStr(v: unknown): string {
  return str(v);
}

export function mapZohoEmployeeToUpsert(record: EmployeeRecord): UpsertFromZohoInput {
  const f = record.fields;
  const firstName = str(f.FirstName) || str(f.firstName) || 'Unknown';
  const lastName = str(f.LastName) || str(f.lastName) || 'Unknown';
  return {
    zohoRecordId: record.recordId,
    employeeId: str(f.EmployeeID) || null,
    firstName,
    lastName,
    email: str(f.EmailID) || null,
    department: str(f.Department) || null,
    departmentZohoId: str(f['Department.ID']) || null,
    designation: str(f.Designation) || null,
    location: str(f.LocationName) || str(f.Location) || null,
    status: str(f.Employeestatus) || str(f.EmployeeStatus) || 'Active',
    role: str(f.Role) || null,
    dateOfJoining: dateStr(f.Dateofjoining) || dateStr(f.Date_of_joining) || null,
    mobile: str(f.Mobile) || null,
    /** Zoho People biometric / access-control id (`Face_ID`). Keep as text — values are zero-padded. */
    faceId: str(f.Face_ID) || str(f.FaceID) || null,
    reportingTo: str(f.Reporting_To) || null,
    reportingToZohoId: str(f['Reporting_To.ID']) || null,
    photoUrl: str(f.Photo_downloadUrl) || str(f.Photo) || null,
    rawFields: f,
  };
}
