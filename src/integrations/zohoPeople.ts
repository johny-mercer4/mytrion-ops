/**
 * Zoho People — employee reads (auth via the Zoho wrapper). Uses the legacy forms API
 * `getRecords` on the `employee` form (success sentinel `response.status === 0`; results are
 * `{ "<recordId>": [ {fields…} ] }`). Filtering uses `searchParams` (Contains, pipe = AND).
 * See .claude/skills/zoho-people-api/SKILL.md §3–§4.
 */
import { authHeaders, baseUrl } from './wrapper.js';

// Zoho People system field/label names. These are the standard ones; if this org renamed
// them, adjust here (the metadata catalog `pnpm meta:zoho-people` lists the form's fields).
const EMPLOYEE_FORM = 'employee';
const FIELD_FIRST_NAME = 'FirstName';
const FIELD_LAST_NAME = 'LastName';
const FIELD_DEPARTMENT = 'Department';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface EmployeeRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

export interface SearchEmployeesInput {
  /** Matches first OR last name (partial). Two words → first + last. */
  name?: string | undefined;
  /** Matches the employee's department (partial). */
  department?: string | undefined;
  limit?: number | undefined;
}

interface Criterion {
  field: string;
  op: 'Contains' | 'Is';
  text: string;
}

/** People searchParams values are single-quoted; strip embedded single quotes so the expr stays valid. */
function esc(value: string): string {
  return value.replace(/'/g, '');
}

function criterion(c: Criterion): string {
  return `{searchField:'${esc(c.field)}',searchOperator:'${c.op}',searchText:'${esc(c.text)}'}`;
}

/**
 * Build the set(s) of AND-criteria to run. Name needs OR across first/last, which searchParams
 * (AND only) can't express in one call — so a single-word name fans out to two requests we union.
 */
function buildCriteriaSets(name?: string, department?: string): Criterion[][] {
  const base: Criterion[] = [];
  if (department) base.push({ field: FIELD_DEPARTMENT, op: 'Contains', text: department });

  const trimmed = name?.trim();
  if (!trimmed) return [base];

  const tokens = trimmed.split(/\s+/);
  if (tokens.length >= 2) {
    return [
      [
        ...base,
        { field: FIELD_FIRST_NAME, op: 'Contains', text: tokens[0] as string },
        { field: FIELD_LAST_NAME, op: 'Contains', text: tokens[tokens.length - 1] as string },
      ],
    ];
  }
  return [
    [...base, { field: FIELD_FIRST_NAME, op: 'Contains', text: trimmed }],
    [...base, { field: FIELD_LAST_NAME, op: 'Contains', text: trimmed }],
  ];
}

interface PeopleResponse {
  response?: { result?: unknown; status?: number; message?: string };
}

/** Parse a forms getRecords payload into flat employee records. */
function parseGetRecords(json: PeopleResponse): EmployeeRecord[] {
  const resp = json.response;
  const result = resp?.result;
  if (!Array.isArray(result)) {
    if (resp && typeof resp.status === 'number' && resp.status !== 0) {
      throw new Error(`[zoho-people] getRecords error: ${resp.message ?? `status ${resp.status}`}`);
    }
    return [];
  }
  const out: EmployeeRecord[] = [];
  for (const entry of result) {
    if (!entry || typeof entry !== 'object') continue;
    const recordId = Object.keys(entry)[0];
    if (!recordId) continue;
    const sections = (entry as Record<string, unknown>)[recordId];
    const fields: Record<string, unknown> = Array.isArray(sections)
      ? Object.assign({}, ...sections.filter((s) => s && typeof s === 'object'))
      : sections && typeof sections === 'object'
        ? (sections as Record<string, unknown>)
        : {};
    out.push({ recordId, fields });
  }
  return out;
}

async function fetchEmployeePage(criteria: Criterion[], limit: number): Promise<EmployeeRecord[]> {
  const url = new URL(`${baseUrl('zoho_people').replace(/\/+$/, '')}/forms/${EMPLOYEE_FORM}/getRecords`);
  url.searchParams.set('sIndex', '1');
  url.searchParams.set('limit', String(limit));
  if (criteria.length > 0) {
    url.searchParams.set('searchParams', criteria.map(criterion).join('|'));
  }
  const res = await fetch(url, { headers: await authHeaders('zoho_people') });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[zoho-people] getRecords HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return parseGetRecords(text ? (JSON.parse(text) as PeopleResponse) : {});
}

/**
 * Search employees. No filters → first page of all employees; `name` and/or `department`
 * filter server-side. Results are deduped by recordId and capped at `limit`.
 */
export async function searchEmployees(input: SearchEmployeesInput = {}): Promise<EmployeeRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const byId = new Map<string, EmployeeRecord>();
  for (const criteria of buildCriteriaSets(input.name, input.department)) {
    const page = await fetchEmployeePage(criteria, limit);
    for (const record of page) {
      if (!byId.has(record.recordId)) byId.set(record.recordId, record);
    }
    if (byId.size >= limit) break;
  }
  return [...byId.values()].slice(0, limit);
}
