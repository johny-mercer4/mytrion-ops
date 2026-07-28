/**
 * Map a Zoho People `department` getRecords row → projected hr_departments columns.
 * Field keys from live components (2026-07-28): Department, Department_Code, MailAlias,
 * Department_Lead (+.ID, .MailID), Parent_Department (+.ID).
 */
import type { PeopleFormRecord } from '../../integrations/zohoPeople.js';
import type { UpsertDepartmentFromZohoInput } from '../../repos/hrDepartmentRepo.js';

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function mapZohoDepartmentToUpsert(record: PeopleFormRecord): UpsertDepartmentFromZohoInput {
  const f = record.fields;
  return {
    zohoRecordId: record.recordId,
    name: str(f.Department) || 'Untitled',
    code: str(f.Department_Code) || null,
    mailAlias: str(f.MailAlias) || null,
    leadName: str(f.Department_Lead) || null,
    leadZohoId: str(f['Department_Lead.ID']) || null,
    leadEmail: str(f['Department_Lead.MailID']) || null,
    parentName: str(f.Parent_Department) || null,
    parentZohoId: str(f['Parent_Department.ID']) || null,
    rawFields: f,
  };
}
