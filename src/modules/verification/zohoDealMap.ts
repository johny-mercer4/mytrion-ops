/**
 * Zoho Deal → verification case fields. Mirrors credit-platform
 * `_deal_record_with_application_aliases` so DOT1/Trucks1/Cell keep working.
 */

export const ZOHO_DEAL_POLL_STAGES = [
  'Application Sent',
  'Application Filled',
  'Vendor Validation',
  'CS Validation',
  'EFS Processing',
  'Cards Sent',
  'Cards Activated',
] as const;

export const ZOHO_DEAL_POLL_LIMIT = 1000;

export function buildDealPollCoql(watermark: string, limit = ZOHO_DEAL_POLL_LIMIT): string {
  const safeDate = watermark.slice(0, 10).replace(/'/g, '');
  const stages = ZOHO_DEAL_POLL_STAGES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
  return (
    `select id, Application_Date from Deals` +
    ` where Stage in (${stages})` +
    ` and Application_Date >= '${safeDate}'` +
    ` order by Application_Date asc limit 0, ${Math.max(1, Math.min(limit, ZOHO_DEAL_POLL_LIMIT))}`
  );
}

function lookupName(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    return String(rec.name ?? rec.Name ?? '').trim();
  }
  return value == null ? '' : String(value).trim();
}

function lookupId(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    return String(rec.id ?? rec.Id ?? '').trim();
  }
  return value == null ? '' : String(value).trim();
}

function field(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const raw = record[key];
    const text = lookupName(raw) || (raw == null ? '' : String(raw).trim());
    if (text && text !== '[object Object]') return text;
  }
  return '';
}

function splitPerson(full: string): { first: string; last: string } {
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

export interface MappedZohoDeal {
  zohoDealId: string;
  zohoApplicationId: string;
  carrierId: string;
  companyName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cell: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  dateOfBirth: string;
  dot: string;
  mc: string;
  truckCount: string;
  businessType: string;
  zohoStage: string;
  applicationStatus: string;
  applicationDate: string;
  creditScore: string;
  creditsafeGrade: string;
  zohoOwnerId: string;
  zohoOwnerName: string;
  zohoRaw: Record<string, unknown>;
}

export function mapZohoDeal(record: Record<string, unknown>): MappedZohoDeal {
  const zohoDealId = field(record, 'id');
  const companyName =
    lookupName(record.Account_Name) || field(record, 'Deal_Name', 'Name', 'company_name');
  const contact = splitPerson(lookupName(record.Contact_Name));
  const firstName = field(record, 'First_name', 'First_Name') || contact.first;
  const lastName = field(record, 'Last_Name', 'Last_name') || contact.last;
  const phone = field(record, 'Phone') || field(record, 'Cell');
  const applicationDate = field(record, 'Application_Date').slice(0, 10);
  const zohoRaw: Record<string, unknown> = {
    ...record,
    Name: field(record, 'Name') || companyName,
    First_Name: firstName,
    Last_Name: lastName,
    DOT: field(record, 'DOT1', 'DOT'),
    emc: field(record, 'emc', 'MC'),
    Number_of_Trucks: field(record, 'Number_of_Trucks', 'Trucks1'),
    Phone: phone,
    _module: 'Deals',
  };
  return {
    zohoDealId,
    zohoApplicationId: field(record, 'Application_ID', 'application_id'),
    carrierId: field(record, 'Carrier_ID', 'carrier_id'),
    companyName,
    firstName,
    lastName,
    email: field(record, 'Email'),
    phone,
    cell: field(record, 'Cell'),
    address: field(record, 'Address'),
    city: field(record, 'City'),
    state: field(record, 'State'),
    zip: field(record, 'Zip_Code', 'Zip'),
    dateOfBirth: field(record, 'Birth_Of_Date').slice(0, 10),
    // Deals COQL cannot select `DOT` (400). Hydrated records use DOT1.
    dot: field(record, 'DOT1', 'DOT'),
    mc: field(record, 'MC', 'emc'),
    truckCount: field(record, 'Trucks1', 'Number_of_Trucks'),
    businessType: field(record, 'Business_Type', 'Type_of_Business'),
    zohoStage: field(record, 'Stage'),
    applicationStatus: field(record, 'Application_Status'),
    applicationDate,
    creditScore: field(record, 'Credit_Score'),
    creditsafeGrade: field(record, 'CreditSafe_Grade'),
    zohoOwnerId: lookupId(record.Owner),
    zohoOwnerName: lookupName(record.Owner),
    zohoRaw,
  };
}

export function maxApplicationDate(dates: string[], fallback: string): string {
  let max = fallback;
  for (const raw of dates) {
    const day = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day > max) max = day;
  }
  return max;
}
