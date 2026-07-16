/**
 * Zoho CRM wrapper — read access via COQL (auth + base URL via ZohoWrapper/ZohoAuthService).
 *
 * COQL: `POST /coql` with `{ "select_query": "select <fields> from <Module> [where …] [limit off,cnt]" }`.
 * Response `{ data: [...], info: { more_records, count } }`; HTTP 204 = no rows matched.
 * The LLM writes the query — module/field *API names* come from the vector DB (business context),
 * not hardcoded here. We only guard that the statement is a single read-only SELECT.
 * See .claude/skills/zoho-crm-api/SKILL.md §5 (COQL) and §0 (endpoints).
 */
import { ZohoWrapper } from './zohoBase.js';

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
 * Fail fast on a query that obviously isn't a single SELECT. This is a sanity check, NOT the
 * read-only boundary: the real guarantees are that `/coql` is a SELECT-only endpoint and the
 * configured OAuth scope is `ZohoCRM.coql.READ` (no write capability) — plus the tool's read
 * riskClass + RBAC. We deliberately do NOT scan the body for write keywords: a real write can't
 * start with SELECT, so such a scan only ever false-rejects legitimate reads whose field names or
 * literal values happen to contain words like "update" (e.g. a Stage of 'Update Pending').
 */
export function assertReadOnlyCoql(selectQuery: string): string {
  const q = selectQuery.trim();
  if (!/^select\b/i.test(q)) {
    throw new Error('[zoho-crm] COQL query must start with SELECT (read-only).');
  }
  if (q.includes(';')) {
    throw new Error('[zoho-crm] COQL query must be a single statement (no ";").');
  }
  return q;
}

/** Zoho returns snake_case keys on /org; the index signature carries any others. */
export interface OrgInfo {
  id?: string;
  company_name?: string;
  primary_email?: string;
  [key: string]: unknown;
}

/** A CRM user (Zoho Users API), reduced to the identity fields an "act as agent" picker needs. */
export interface CrmUser {
  zohoUserId: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
}

interface CrmUsersApiResponse {
  users?: Array<{
    id?: string;
    full_name?: string;
    email?: string;
    profile?: { name?: string } | null;
    role?: { name?: string } | null;
    status?: string;
  }>;
  info?: { more_records?: boolean; page?: number };
}

export class ZohoCrmWrapper extends ZohoWrapper {
  readonly name = 'zoho_crm';

  constructor() {
    super('zoho_crm');
  }

  /** Connectivity probe: GET /org is cheap and read-only. */
  protected override async probe(): Promise<void> {
    await this.getOrg();
  }

  /** Run a COQL SELECT. Returns rows (possibly empty on HTTP 204) plus pagination info. */
  async runCoql(selectQuery: string): Promise<CoqlResult> {
    const query = assertReadOnlyCoql(selectQuery);
    const res = await this.requestRaw('POST', '/coql', { body: { select_query: query } });
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

  /**
   * List ACTIVE CRM users (Zoho Users API `GET /users?type=ActiveUsers`, scope ZohoCRM.users.READ) —
   * the source for the admin "act as agent" picker. Paginates to a bounded cap; filtering to sales
   * profiles is done by the caller (admin route) so the raw list stays reusable.
   */
  async listActiveUsers(): Promise<CrmUser[]> {
    const out: CrmUser[] = [];
    const MAX_PAGES = 5; // 200/page → up to 1000 users; ample for an org's roster
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await this.requestRaw('GET', '/users', {
        query: { type: 'ActiveUsers', page, per_page: 200 },
      });
      if (res.status === 204) break;
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`[zoho-crm] GET /users HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = text ? (JSON.parse(text) as CrmUsersApiResponse) : {};
      const users = json.users ?? [];
      for (const u of users) {
        if (!u.id || u.status !== 'active') continue;
        out.push({
          zohoUserId: u.id,
          name: u.full_name ?? null,
          email: u.email ?? null,
          profile: u.profile?.name ?? null,
          role: u.role?.name ?? null,
        });
      }
      if (json.info?.more_records !== true) break;
    }
    return out;
  }

  /**
   * Attach a file to a CRM record (`POST /{module}/{id}/Attachments`, multipart field `file`).
   * Mirrors the widget's `ZOHO.CRM.API.attachFile` — the ticket/escalation attachment Deluge functions
   * then read this attachment off the record and push it to the Desk ticket. Returns the attachment id.
   * Scope: ZohoCRM.modules.attachments.CREATE. 20 MB upload budget → 60s timeout.
   */
  async attachFileToRecord(
    module: string,
    recordId: string,
    fileName: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<string> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(recordId)}/Attachments`;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), fileName);
    const res = await this.requestRaw('POST', path, { body: form, timeoutMs: 60_000 });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `[zoho-crm] attach file to ${module}/${recordId} HTTP ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    const json = text ? (JSON.parse(text) as { data?: Array<{ details?: { id?: string } }> }) : {};
    const id = json.data?.[0]?.details?.id;
    if (!id) throw new Error(`[zoho-crm] attach file returned no id: ${text.slice(0, 200)}`);
    return id;
  }

  /** Connectivity check: `GET /org` returns the CRM org profile (scope ZohoCRM.org.READ). */
  async getOrg(): Promise<OrgInfo> {
    const res = await this.requestRaw('GET', '/org');
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`[zoho-crm] GET /org HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = text ? (JSON.parse(text) as { org?: OrgInfo[] }) : {};
    return json.org?.[0] ?? {};
  }
}

export const zohoCrm = new ZohoCrmWrapper();

/** @deprecated Import { zohoCrm } and call the method — kept as a facade during migration. */
export const runCoql = (selectQuery: string): Promise<CoqlResult> => zohoCrm.runCoql(selectQuery);
/** @deprecated Import { zohoCrm } and call the method — kept as a facade during migration. */
export const listActiveUsers = (): Promise<CrmUser[]> => zohoCrm.listActiveUsers();
/** @deprecated Import { zohoCrm } and call the method — kept as a facade during migration. */
export const attachFileToRecord = (
  module: string,
  recordId: string,
  fileName: string,
  buffer: Buffer,
  contentType?: string,
): Promise<string> => zohoCrm.attachFileToRecord(module, recordId, fileName, buffer, contentType);
/** @deprecated Import { zohoCrm } and call the method — kept as a facade during migration. */
export const getOrg = (): Promise<OrgInfo> => zohoCrm.getOrg();

export { MAX_COQL_ROWS };
