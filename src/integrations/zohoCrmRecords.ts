/**
 * Zoho CRM record CRUD + search + field metadata (REST v8) — the write-capable sibling of
 * the read-focused zohoCrm.ts wrapper (same auth/token via ZohoWrapper('zoho_crm')).
 *
 * Every mutation checks the PER-ROW response code: Zoho answers HTTP 200 with a row-level
 * failure code (and silently drops unknown/wrong-cased fields), so `updateRecord` throwing
 * on a non-SUCCESS row is the only reliable failure signal. Field-name casing is resolved
 * BEFORE calling these helpers (modules/customerService/fieldResolver.ts) — the org has
 * ambiguous casings (Limits_added vs Limits_Added) and a wrong-cased key is a silent no-op.
 * See .claude/skills/zoho-crm-api/SKILL.md §2 (records), §3 (search), §1 (fields).
 */
import { ZohoWrapper } from './zohoBase.js';

/** One row of a mutation response: HTTP 200 does NOT mean the row succeeded. */
interface MutationRow {
  code?: string;
  status?: string;
  message?: string;
  details?: { id?: string; [key: string]: unknown };
}

interface MutationResponse {
  data?: MutationRow[];
}

export interface CrmFieldMeta {
  api_name: string;
  data_type?: string;
  field_label?: string;
  pick_list_values?: Array<{ display_value?: string; actual_value?: string }>;
  [key: string]: unknown;
}

export interface SearchOptions {
  /** Exactly one of criteria/word/phone/email (Zoho search API contract). */
  criteria?: string;
  word?: string;
  phone?: string;
  email?: string;
  page?: number;
  perPage?: number;
  fields?: readonly string[];
}

export interface RecordPage {
  rows: Array<Record<string, unknown>>;
  moreRecords: boolean;
}

export class ZohoCrmRecordsWrapper extends ZohoWrapper {
  readonly name = 'zoho_crm_records';

  constructor() {
    super('zoho_crm');
  }

  /** Full record fetch (subforms + lookups included). 204/404 → null. */
  async getRecord(module: string, id: string): Promise<Record<string, unknown> | null> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}`;
    const res = await this.requestRaw('GET', path);
    if (res.status === 204 || res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw this.httpError('GET', path, res.status, text);
    const json = text ? (JSON.parse(text) as { data?: Array<Record<string, unknown>> }) : {};
    return json.data?.[0] ?? null;
  }

  /** Paged list. Zoho v8 requires an explicit field selection on GET /{module}. */
  async listRecords(
    module: string,
    fields: readonly string[],
    opts: { page?: number; perPage?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {},
  ): Promise<RecordPage> {
    const path = `/${encodeURIComponent(module)}`;
    const res = await this.requestRaw('GET', path, {
      query: {
        fields: fields.join(','),
        page: opts.page ?? 1,
        per_page: opts.perPage ?? 200,
        ...(opts.sortBy ? { sort_by: opts.sortBy, sort_order: opts.sortOrder ?? 'desc' } : {}),
      },
    });
    return this.parsePage('GET', path, res);
  }

  /**
   * Record search (`GET /{module}/search`) — criteria string or the dedicated word/phone/
   * email params (phone matches Zoho's normalized phone index, which is how the widget's
   * digit-normalized phone search behaves without COQL's no-LIKE-on-numeric limitation).
   */
  async searchRecords(module: string, opts: SearchOptions): Promise<RecordPage> {
    const path = `/${encodeURIComponent(module)}/search`;
    const res = await this.requestRaw('GET', path, {
      query: {
        ...(opts.criteria ? { criteria: opts.criteria } : {}),
        ...(opts.word ? { word: opts.word } : {}),
        ...(opts.phone ? { phone: opts.phone } : {}),
        ...(opts.email ? { email: opts.email } : {}),
        ...(opts.fields?.length ? { fields: opts.fields.join(',') } : {}),
        page: opts.page ?? 1,
        per_page: opts.perPage ?? 200,
      },
    });
    return this.parsePage('GET', path, res);
  }

  /** Update one record. Returns the record id; throws on a row-level failure code. */
  async updateRecord(
    module: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}`;
    const json = await this.request<MutationResponse>('PUT', path, {
      body: { data: [{ ...data, id }] },
    });
    return this.assertRowSuccess('update', module, json);
  }

  /** Insert one record. `trigger` mirrors the widget's workflow-triggering inserts. */
  async insertRecord(
    module: string,
    data: Record<string, unknown>,
    trigger?: readonly string[],
  ): Promise<string> {
    const path = `/${encodeURIComponent(module)}`;
    const json = await this.request<MutationResponse>('POST', path, {
      body: { data: [data], ...(trigger ? { trigger } : {}) },
    });
    return this.assertRowSuccess('insert', module, json);
  }

  /**
   * Insert one record but return the RAW per-row result (code + id + message + row) instead of throwing
   * on a non-SUCCESS code. Lets callers handle Zoho's row-level outcomes themselves — notably
   * DUPLICATE_DATA, which carries the EXISTING record id under `row.details.id` (the UI links to it).
   */
  async insertRecordDetailed(
    module: string,
    data: Record<string, unknown>,
    trigger?: readonly string[],
  ): Promise<{ code: string; id: string; message: string; row: Record<string, unknown> }> {
    const path = `/${encodeURIComponent(module)}`;
    const json = await this.request<MutationResponse>('POST', path, {
      body: { data: [data], ...(trigger ? { trigger } : {}) },
    });
    const row = (json.data?.[0] ?? {}) as MutationRow;
    return {
      code: String(row.code ?? ''),
      id: String(row.details?.id ?? ''),
      message: String(row.message ?? ''),
      row: row as Record<string, unknown>,
    };
  }

  /** Related-list records (`GET /{module}/{id}/{relatedList}`). 204/404 → []. */
  async getRelatedRecords(
    module: string,
    id: string,
    relatedList: string,
    fields?: readonly string[],
  ): Promise<Array<Record<string, unknown>>> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}/${encodeURIComponent(relatedList)}`;
    const res = await this.requestRaw('GET', path, {
      query: { ...(fields?.length ? { fields: fields.join(',') } : {}), per_page: 200 },
    });
    if (res.status === 204 || res.status === 404) return [];
    const text = await res.text();
    if (!res.ok) throw this.httpError('GET', path, res.status, text);
    const json = text ? (JSON.parse(text) as { data?: Array<Record<string, unknown>> }) : {};
    return json.data ?? [];
  }

  /** Delete one record (row-level code checked like every other mutation). */
  async deleteRecord(module: string, id: string): Promise<void> {
    const path = `/${encodeURIComponent(module)}`;
    const json = await this.request<MutationResponse>('DELETE', path, {
      query: { ids: id, wf_trigger: 'true' },
    });
    this.assertRowSuccess('delete', module, json);
  }

  /** Live field metadata (`GET /settings/fields`) — the casing/picklist source of truth. */
  async getModuleFields(module: string): Promise<CrmFieldMeta[]> {
    const json = await this.request<{ fields?: CrmFieldMeta[] }>('GET', '/settings/fields', {
      query: { module },
    });
    return json.fields ?? [];
  }

  private async parsePage(method: 'GET', path: string, res: Response): Promise<RecordPage> {
    if (res.status === 204) return { rows: [], moreRecords: false };
    const text = await res.text();
    if (!res.ok) throw this.httpError(method, path, res.status, text);
    const json = text
      ? (JSON.parse(text) as {
          data?: Array<Record<string, unknown>>;
          info?: { more_records?: boolean };
        })
      : {};
    return { rows: json.data ?? [], moreRecords: json.info?.more_records === true };
  }

  private assertRowSuccess(op: string, module: string, json: MutationResponse): string {
    const row = json.data?.[0];
    if (!row || row.code !== 'SUCCESS') {
      const detail = row ? `${row.code ?? 'NO_CODE'}: ${row.message ?? ''}` : 'empty response';
      throw new Error(`[zoho-crm-records] ${op} ${module} failed — ${detail}`.trim());
    }
    return row.details?.id ?? '';
  }
}

export const zohoCrmRecords = new ZohoCrmRecordsWrapper();
