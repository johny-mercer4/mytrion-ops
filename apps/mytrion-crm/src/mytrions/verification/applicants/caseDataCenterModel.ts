/**
 * Data Center helpers — prefill and the scannable fields from a QCMobile row.
 *
 * Prefill prefers USDOT, then MC, then legal name, because that is the register's own ladder.
 * Search itself is typed: the agent picks the key. We do not auto-run on open — that would hit
 * FMCSA on every case open, including from hosts the edge denies.
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
import { formatDollars } from './caseAuthority';

export interface FmcsaPrefillCase {
  dot?: string | null;
  mc?: string | null;
  companyName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export function fmcsaPrefill(row: FmcsaPrefillCase): { by: FmcsaSearchBy; q: string } {
  const dot = (row.dot ?? '').trim();
  if (dot) return { by: 'dot', q: dot };
  const mc = (row.mc ?? '').trim();
  if (mc) return { by: 'mc', q: mc };
  const company = (row.companyName ?? '').trim();
  if (company) return { by: 'name', q: company };
  const person = [row.firstName, row.lastName]
    .map((part) => (part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ');
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
