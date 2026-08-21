/**
 * Data Center Broker Snapshot search — our DWH table, one key per call.
 *
 * `public.stg_broker_snapshot` is the same warehouse Phase 2 / Sales already read. Data Center
 * returns the WHOLE row (plus a typed summary). There is no MC column, so the compact control
 * is USDOT | Name — name is `owner_full_name`, a PERSON, not a legal name.
 * Name uses `left(lower(...))` prefix equality so a typed `%` cannot become a scan.
 *
 * READ-ONLY. Never writes findings; Phase 4 `authority/run` still does that.
 * DWH down / empty env is `{ available: false }`, never a thrown 5xx the UI would mix with RBAC.
 */
import { dwh } from '../../integrations/dwh.js';
import { errorMessage } from '../../lib/errors.js';
import { jsonFields, jsonValue, type JsonValue } from '../../lib/jsonFields.js';
import { logger } from '../../lib/logger.js';
import {
  BROKER_SNAPSHOT_NAME_MIN,
  BROKER_SNAPSHOT_SEARCH_LIMIT,
  searchBrokerSnapshotByDot,
  searchBrokerSnapshotByName,
} from '../../repos/dwhBrokerSnapshotRepo.js';

export type BrokerSnapshotSearchBy = 'dot' | 'name';

export interface BrokerSnapshotRecord {
  id: string;
  dotNumber: string | null;
  ownerFullName: string | null;
  phoneNumber: string | null;
  email: string | null;
  physicalAddress: string | null;
  operatingStatus: string | null;
  powerUnits: number | null;
  truckSize: number | null;
  addDate: string | null;
  changeDate: string | null;
  isActive: boolean;
  /** Every column on the warehouse row, including keys the summary does not name. */
  fields?: Record<string, JsonValue>;
}

export interface BrokerSnapshotSearchResult {
  available: boolean;
  error: string | null;
  matchedOn: BrokerSnapshotSearchBy | null;
  notFound: boolean;
  truncated: boolean;
  records: BrokerSnapshotRecord[];
}

const NOT_CONFIGURED = 'DWH_DATABASE_URL is not configured';

function unavailable(error: string): BrokerSnapshotSearchResult {
  return {
    available: false,
    error,
    matchedOn: null,
    notFound: false,
    truncated: false,
    records: [],
  };
}

function emptyHit(matchedOn: BrokerSnapshotSearchBy): BrokerSnapshotSearchResult {
  return {
    available: true,
    error: null,
    matchedOn,
    notFound: true,
    truncated: false,
    records: [],
  };
}

function textCell(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function numCell(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateCell(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  return text === '' ? null : text.slice(0, 10);
}

function snapshotFields(row: Record<string, unknown>): Record<string, JsonValue> | undefined {
  const plain: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      const iso = Number.isNaN(value.getTime()) ? null : value.toISOString();
      if (iso !== null) plain[key] = iso;
      continue;
    }
    const next = jsonValue(value);
    if (next !== undefined) plain[key] = next;
  }
  return jsonFields(plain);
}

function toRecord(row: Record<string, unknown>): BrokerSnapshotRecord | null {
  const id = textCell(row.id);
  if (id === null) return null;
  const record: BrokerSnapshotRecord = {
    id,
    dotNumber: textCell(row.dot_number),
    ownerFullName: textCell(row.owner_full_name),
    phoneNumber: textCell(row.phone_number),
    email: textCell(row.email),
    physicalAddress: textCell(row.physical_address),
    operatingStatus: textCell(row.operating_status),
    powerUnits: numCell(row.power_units),
    truckSize: numCell(row.truck_size),
    addDate: dateCell(row.add_date),
    changeDate: dateCell(row.change_date),
    isActive: row.is_active === true,
  };
  const fields = snapshotFields(row);
  if (fields !== undefined) record.fields = fields;
  return record;
}

/** Digits, never zero — same sentinel as Phase 1 warehouse match. */
function normaliseDot(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits !== '' && Number(digits) !== 0 ? digits : null;
}

export async function searchBrokerSnapshot(query: {
  by: BrokerSnapshotSearchBy;
  q: string;
}): Promise<BrokerSnapshotSearchResult> {
  if (!dwh.isConfigured()) return unavailable(NOT_CONFIGURED);

  const q = query.q.trim();
  const by = query.by;
  if (by === 'dot') {
    const dot = normaliseDot(q);
    if (dot === null) return emptyHit('dot');
    return runSearch('dot', () => searchBrokerSnapshotByDot(dot));
  }

  if (q.length < BROKER_SNAPSHOT_NAME_MIN) return emptyHit('name');
  return runSearch('name', () => searchBrokerSnapshotByName(q));
}

async function runSearch(
  matchedOn: BrokerSnapshotSearchBy,
  query: () => Promise<Record<string, unknown>[]>,
): Promise<BrokerSnapshotSearchResult> {
  try {
    const rows = await query();
    const records = rows
      .map(toRecord)
      .filter((row): row is BrokerSnapshotRecord => row !== null);
    return {
      available: true,
      error: null,
      matchedOn,
      notFound: records.length === 0,
      truncated: rows.length >= BROKER_SNAPSHOT_SEARCH_LIMIT,
      records,
    };
  } catch (err) {
    logger.warn({ err: errorMessage(err), matchedOn }, 'broker snapshot search failed');
    return unavailable(errorMessage(err));
  }
}
