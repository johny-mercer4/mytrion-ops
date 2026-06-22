/**
 * Zoho CRM — read access via COQL (auth + base URL from the Zoho wrapper).
 *
 * COQL: `POST /coql` with `{ "select_query": "select <fields> from <Module> [where …] [limit off,cnt]" }`.
 * Response `{ data: [...], info: { more_records, count } }`; HTTP 204 = no rows matched.
 * The LLM writes the query — module/field *API names* come from the vector DB (business context),
 * not hardcoded here. We only guard that the statement is a single read-only SELECT.
 * See .claude/skills/zoho-crm-api/SKILL.md §5 (COQL) and §0 (endpoints).
 */
import { authHeaders, baseUrl } from './wrapper.js';

/** COQL hard limits (skill §5): max 200 rows per page, offset ≤ 100k. */
const MAX_COQL_ROWS = 200;

export interface CoqlResult {
  rows: Array<Record<string, unknown>>;
  count: number;
  moreRecords: boolean;
}

interface CoqlResponse {
  data?: Array<Record<string, unknown>>;
  info?: { more_records?: boolean; count?: number };
}

/**
 * Reject anything that isn't a single read-only SELECT before it reaches Zoho. COQL only supports
 * SELECT, but the query is model-generated, so we fail closed on write keywords and statement
 * chaining rather than trusting the upstream to refuse them.
 */
export function assertReadOnlyCoql(selectQuery: string): string {
  const q = selectQuery.trim();
  if (!/^select\b/i.test(q)) {
    throw new Error('[zoho-crm] COQL query must start with SELECT (read-only).');
  }
  if (q.includes(';')) {
    throw new Error('[zoho-crm] COQL query must be a single statement (no ";").');
  }
  if (/\b(insert|update|delete|drop|create|alter|truncate|merge)\b/i.test(q)) {
    throw new Error('[zoho-crm] COQL query contains a forbidden write keyword.');
  }
  return q;
}

/** Run a COQL SELECT. Returns rows (possibly empty on HTTP 204) plus pagination info. */
export async function runCoql(selectQuery: string): Promise<CoqlResult> {
  const query = assertReadOnlyCoql(selectQuery);
  const url = `${baseUrl('zoho_crm').replace(/\/+$/, '')}/coql`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(await authHeaders('zoho_crm')), 'Content-Type': 'application/json' },
    body: JSON.stringify({ select_query: query }),
  });

  // 204 = the query is valid but matched no rows.
  if (res.status === 204) return { rows: [], count: 0, moreRecords: false };

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[zoho-crm] COQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = text ? (JSON.parse(text) as CoqlResponse) : {};
  const rows = Array.isArray(json.data) ? json.data : [];
  return {
    rows,
    count: typeof json.info?.count === 'number' ? json.info.count : rows.length,
    moreRecords: json.info?.more_records === true,
  };
}

export interface OrgInfo {
  id?: string;
  companyName?: string;
  primaryEmail?: string;
  [key: string]: unknown;
}

/** Connectivity check: `GET /org` returns the CRM org profile (scope ZohoCRM.org.READ). */
export async function getOrg(): Promise<OrgInfo> {
  const url = `${baseUrl('zoho_crm').replace(/\/+$/, '')}/org`;
  const res = await fetch(url, { headers: await authHeaders('zoho_crm') });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[zoho-crm] GET /org HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = text ? (JSON.parse(text) as { org?: OrgInfo[] }) : {};
  return json.org?.[0] ?? {};
}

export { MAX_COQL_ROWS };
