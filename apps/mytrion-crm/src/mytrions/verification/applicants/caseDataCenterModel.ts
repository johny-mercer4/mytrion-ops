/**
 * Data Center helpers — prefill and the scannable fields from a vendor row.
 *
 * Prefill prefers USDOT, then MC, then legal name, because that is the register's own ladder.
 * Motus (Socrata) has no MC client, so its prefill skips MC. Search itself is typed: the agent
 * picks the key. We do not auto-run on open — that would hit FMCSA on every case open, including
 * from hosts the edge denies.
 */
import type {
  FmcsaAuthorityLine,
  FmcsaCarrierRow,
  FmcsaFlag,
  FmcsaInsuranceLine,
  FmcsaSearchBy,
  FmcsaSearchResult,
  FmcsaStatusVerdict,
} from '@/api/verificationFmcsa';
import type { MotusCensusRecord, MotusSearchBy } from '@/api/verificationMotus';
import type { BrokerSnapshotRecord, BrokerSnapshotSearchBy } from '@/api/verificationBrokerSnapshot';
import type { BlacklistSearchBy } from '@/api/verificationBlacklist';
import { authorityActiveFromStatus, formatDollars } from './caseAuthority';

export interface FmcsaPrefillCase {
  dot?: string | null;
  mc?: string | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Workspace landing: `?dot=` / `?mc=` / `?name=` (or `?q=` as a name). Empty params stay empty. */
export function fmcsaPrefillFromSearch(search: string): FmcsaPrefillCase {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    dot: params.get('dot'),
    mc: params.get('mc'),
    companyName: params.get('name') ?? params.get('q'),
    email: params.get('email'),
    phone: params.get('phone'),
  };
}

function personName(row: FmcsaPrefillCase): string {
  return [row.firstName, row.lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ');
}

export function fmcsaPrefill(row: FmcsaPrefillCase): { by: FmcsaSearchBy; q: string } {
  const dot = (row.dot ?? '').trim();
  if (dot) return { by: 'dot', q: dot };
  const mc = (row.mc ?? '').trim();
  if (mc) return { by: 'mc', q: mc };
  const company = (row.companyName ?? '').trim();
  if (company) return { by: 'name', q: company };
  const person = personName(row);
  if (person) return { by: 'name', q: person };
  return { by: 'dot', q: '' };
}

/** Census / filings take a USDOT or a legal name — never an MC typed into the DOT box. */
export function motusPrefill(row: FmcsaPrefillCase): { by: MotusSearchBy; q: string } {
  const dot = (row.dot ?? '').trim();
  if (dot) return { by: 'dot', q: dot };
  const company = (row.companyName ?? '').trim();
  if (company) return { by: 'name', q: company };
  const person = personName(row);
  if (person) return { by: 'name', q: person };
  return { by: 'dot', q: '' };
}

/**
 * Snapshot is keyed on DOT and `owner_full_name` (a person). No MC column — never prefill MC
 * into the DOT box. Person before company because that is the column agents will hit.
 */
export function brokerPrefill(row: FmcsaPrefillCase): { by: BrokerSnapshotSearchBy; q: string } {
  const dot = (row.dot ?? '').trim();
  if (dot) return { by: 'dot', q: dot };
  const person = personName(row);
  if (person) return { by: 'name', q: person };
  const company = (row.companyName ?? '').trim();
  if (company) return { by: 'name', q: company };
  return { by: 'dot', q: '' };
}

/**
 * Blacklist keys are USDOT → MC → email → phone → name. Same ladder as the compact
 * type+value control; we do not auto-run.
 */
export function blacklistPrefill(row: FmcsaPrefillCase): { by: BlacklistSearchBy; q: string } {
  const dot = (row.dot ?? '').trim();
  if (dot) return { by: 'dot', q: dot };
  const mc = (row.mc ?? '').trim();
  if (mc) return { by: 'mc', q: mc };
  const email = (row.email ?? '').trim();
  if (email) return { by: 'email', q: email };
  const phone = (row.phone ?? '').trim();
  if (phone) return { by: 'phone', q: phone };
  const company = (row.companyName ?? '').trim();
  if (company) return { by: 'name', q: company };
  const person = personName(row);
  if (person) return { by: 'name', q: person };
  return { by: 'dot', q: '' };
}

export function fmcsaRows(result: FmcsaSearchResult): FmcsaCarrierRow[] {
  const seen = new Set<string>();
  const out: FmcsaCarrierRow[] = [];
  const source = result.carrier ? [result.carrier, ...result.candidates] : result.candidates;
  for (const row of source) {
    const key = row.dotNumber ?? row.legalName;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(row);
  }
  return out;
}

export function fmcsaStatusLabel(status: FmcsaStatusVerdict): string {
  if (status === 'active') return 'Active';
  if (status === 'inactive') return 'Inactive';
  return 'Unknown';
}

export function fmcsaFlagLabel(flag: FmcsaFlag): string {
  if (flag === 'yes') return 'Yes';
  if (flag === 'no') return 'No';
  return '—';
}

export function fmcsaAuthorityLabel(line: FmcsaAuthorityLine): string {
  if (line.verdict === 'active') return 'Active';
  if (line.verdict === 'none') return 'None';
  return line.raw?.trim() || '—';
}

export function fmcsaInsuranceLabel(line: FmcsaInsuranceLine): string {
  if (line.onFile && line.dollars != null) return formatDollars(line.dollars);
  if (line.dollars === 0 || line.raw === '0') return 'None';
  return '—';
}

export function fmcsaCityState(row: FmcsaCarrierRow): string | null {
  const cityState = [row.phyCity, row.phyState].filter((part) => Boolean(part?.trim())).join(', ');
  return cityState === '' ? null : cityState;
}

export function fmcsaAddress(row: FmcsaCarrierRow): string | null {
  const line = [row.phyStreet, fmcsaCityState(row), row.phyZipcode]
    .filter((part) => Boolean(part?.trim()))
    .join(' · ');
  return line === '' ? null : line;
}

export function fmcsaCarrierTitle(row: FmcsaCarrierRow): string {
  return row.legalName?.trim() || row.dbaName?.trim() || row.dotNumber?.trim() || 'Unnamed carrier';
}

export interface VendorFact {
  label: string;
  value: string;
}

const FMCSA_ROW_KEYS = ['legalName', 'dbaName', 'dotNumber'] as const;
const CENSUS_ROW_KEYS = ['legal_name', 'dba_name', 'dot_number'] as const;

/** Flatten a vendor row into definition-list facts. Skip null / empty / already-shown keys. */
export function flattenFields(input: Record<string, unknown> | undefined, skip: readonly string[] = []): VendorFact[] {
  if (!input) return [];
  const hidden = new Set(skip);
  const out: VendorFact[] = [];
  const walk = (value: unknown, path: string): void => {
    if (value == null) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (text !== '') out.push({ label: path, value: text });
      return;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out.push({ label: path, value: String(value) });
      return;
    }
    if (typeof value === 'boolean') {
      out.push({ label: path, value: value ? 'true' : 'false' });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`));
      return;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        walk(item, path === '' ? key : `${path}.${key}`);
      }
    }
  };
  for (const [key, value] of Object.entries(input)) {
    if (hidden.has(key)) continue;
    walk(value, key);
  }
  return out;
}

export function fmcsaDetailFacts(row: FmcsaCarrierRow): VendorFact[] {
  if (row.fields) return flattenFields(row.fields, FMCSA_ROW_KEYS);
  const curated: VendorFact[] = [];
  const push = (label: string, value: string | null | undefined): void => {
    const text = value?.trim();
    if (text) curated.push({ label, value: text });
  };
  push('ein', row.ein);
  push('allowedToOperate', fmcsaFlagLabel(row.allowedToOperate));
  push('address', fmcsaAddress(row));
  push('carrierOperationDesc', row.carrierOperationDesc);
  push('commonAuthority', fmcsaAuthorityLabel(row.authority.common));
  push('contractAuthority', fmcsaAuthorityLabel(row.authority.contract));
  push('brokerAuthority', fmcsaAuthorityLabel(row.authority.broker));
  push('bipd', fmcsaInsuranceLabel(row.insurance.bipd));
  push('bond', fmcsaInsuranceLabel(row.insurance.bond));
  push('cargo', fmcsaInsuranceLabel(row.insurance.cargo));
  push('safetyRating', row.safetyRating);
  push('oosDate', row.oosDate);
  return curated;
}

export function motusCensusTitle(row: MotusCensusRecord): string {
  return row.legalName?.trim() || row.dbaName?.trim() || row.dotNumber.trim() || 'Unnamed carrier';
}

export function motusMcLabel(row: MotusCensusRecord): string | null {
  const docket = row.dockets.find((item) => item.prefix === 'MC');
  if (!docket) return null;
  return `MC ${docket.number.replace(/^0+/, '') || docket.number}`;
}

export function motusCensusFacts(row: MotusCensusRecord): VendorFact[] {
  if (row.fields) return flattenFields(row.fields, CENSUS_ROW_KEYS);
  const curated: VendorFact[] = [];
  const push = (label: string, value: string | null | undefined): void => {
    const text = value?.trim();
    if (text) curated.push({ label, value: text });
  };
  push('status', row.statusLabel);
  push('operation', row.carrierOperationLabel);
  if (row.powerUnits != null) push('powerUnits', String(row.powerUnits));
  if (row.totalDrivers != null) push('totalDrivers', String(row.totalDrivers));
  push('addDate', row.addDate);
  push('safetyRating', row.safetyRating);
  push('phone', row.phone);
  const city = [row.address.city, row.address.state].filter((part) => Boolean(part?.trim())).join(', ');
  const address = [row.address.street, city, row.address.zip].filter((part) => Boolean(part?.trim())).join(' · ');
  push('address', address);
  return curated;
}

const SNAPSHOT_ROW_KEYS = ['owner_full_name', 'dot_number'] as const;

export function brokerSnapshotTitle(row: BrokerSnapshotRecord): string {
  return row.ownerFullName?.trim() || row.dotNumber?.trim() || 'Unnamed carrier';
}

export function brokerStatusVerdict(status: string | null): FmcsaStatusVerdict {
  const active = authorityActiveFromStatus(status);
  if (active === true) return 'active';
  if (active === false) return 'inactive';
  return 'unknown';
}

export function brokerSnapshotFacts(row: BrokerSnapshotRecord): VendorFact[] {
  if (row.fields) return flattenFields(row.fields, SNAPSHOT_ROW_KEYS);
  const curated: VendorFact[] = [];
  const push = (label: string, value: string | null | undefined): void => {
    const text = value?.trim();
    if (text) curated.push({ label, value: text });
  };
  push('phone_number', row.phoneNumber);
  push('email', row.email);
  push('physical_address', row.physicalAddress);
  push('operating_status', row.operatingStatus);
  if (row.powerUnits != null) push('power_units', String(row.powerUnits));
  if (row.truckSize != null) push('truck_size', String(row.truckSize));
  push('add_date', row.addDate);
  push('change_date', row.changeDate);
  return curated;
}
