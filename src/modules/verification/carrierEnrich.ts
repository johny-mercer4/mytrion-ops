import { dwh } from '../../integrations/dwh.js';
import type { VerificationMatchVia } from '../../db/schema/verification_cases.js';

export interface BrokerSnapshotMatch {
  snapshotId: string;
  via: VerificationMatchVia;
  operatingStatus: string;
  units: string;
  address: string;
  dot: string;
  phone: string;
  email: string;
  ownerName: string;
}

interface SnapshotRow {
  id: string | number;
  dot_number: string | number | null;
  owner_full_name: string | null;
  phone_number: string | null;
  email: string | null;
  physical_address: string | null;
  operating_status: string | null;
  power_units: string | number | null;
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeCompany(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,'"()/]/g, '')
    .replace(/\s+/g, ' ');
}

function asRow(row: SnapshotRow): Omit<BrokerSnapshotMatch, 'via'> {
  return {
    snapshotId: String(row.id),
    operatingStatus: String(row.operating_status ?? '').trim(),
    units: row.power_units == null ? '' : String(row.power_units),
    address: String(row.physical_address ?? '').trim(),
    dot: row.dot_number == null ? '' : String(row.dot_number).trim(),
    phone: String(row.phone_number ?? '').trim(),
    email: String(row.email ?? '').trim(),
    ownerName: String(row.owner_full_name ?? '').trim(),
  };
}

const SELECT = `id, dot_number, owner_full_name, phone_number, email, physical_address,
            operating_status, power_units`;

async function querySnapshot(sql: string, params: readonly unknown[]): Promise<SnapshotRow[]> {
  return dwh.query<SnapshotRow>(sql, params);
}

/**
 * Phone → Email → DOT → company name. First confident exact match on
 * `public.stg_broker_snapshot` (the Sales Carriers source). Miss is OK.
 */
export async function matchBrokerSnapshot(input: {
  phone?: string | null;
  email?: string | null;
  dot?: string | null;
  companyName?: string | null;
}): Promise<BrokerSnapshotMatch | null> {
  const phone = digitsOnly(input.phone ?? '');
  if (phone.length >= 7) {
    const rows = await querySnapshot(
      `select ${SELECT}
         from public.stg_broker_snapshot
        where is_active = true
          and regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g') = $1
        limit 2`,
      [phone],
    );
    if (rows.length === 1 && rows[0]) return { ...asRow(rows[0]), via: 'phone' };
  }

  const email = (input.email ?? '').trim().toLowerCase();
  if (email.includes('@')) {
    const rows = await querySnapshot(
      `select ${SELECT}
         from public.stg_broker_snapshot
        where is_active = true
          and lower(trim(coalesce(email, ''))) = $1
        limit 2`,
      [email],
    );
    if (rows.length === 1 && rows[0]) return { ...asRow(rows[0]), via: 'email' };
  }

  const dot = digitsOnly(input.dot ?? '');
  if (dot.length >= 4) {
    const rows = await querySnapshot(
      `select ${SELECT}
         from public.stg_broker_snapshot
        where is_active = true
          and regexp_replace(dot_number::text, '\\D', '', 'g') = $1
        limit 2`,
      [dot],
    );
    if (rows.length === 1 && rows[0]) return { ...asRow(rows[0]), via: 'dot' };
  }

  const company = normalizeCompany(input.companyName ?? '');
  if (company.length >= 3) {
    const rows = await querySnapshot(
      `select ${SELECT}
         from public.stg_broker_snapshot
        where is_active = true
          and regexp_replace(lower(trim(coalesce(owner_full_name, ''))), '[.,''"/()]', '', 'g') = $1
        limit 2`,
      [company],
    );
    if (rows.length === 1 && rows[0]) return { ...asRow(rows[0]), via: 'company_name' };
  }

  return null;
}
