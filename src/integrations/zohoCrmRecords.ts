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

export interface BlueprintFieldOption {
  label: string;
  value: string;
}

export interface BlueprintTransitionField {
  apiName: string;
  label: string;
  dataType: string;
  mandatory: boolean;
  readOnly: boolean;
  value: unknown;
  options: BlueprintFieldOption[];
}

export interface BlueprintTransition {
  id: string;
  name: string;
  nextValue: string;
  type: string;
  criteriaMatched: boolean;
  criteriaMessage: string;
  fields: BlueprintTransitionField[];
}

export interface BlueprintDetails {
  process: {
    id: string;
    name: string;
    fieldApiName: string;
    fieldLabel: string;
    currentValue: string;
  };
  transitions: BlueprintTransition[];
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
    // requestRaw (NOT request) so a duplicate is PARSED rather than thrown: Zoho returns the existing
    // record id inside a DUPLICATE_DATA body on an HTTP 400 (often wrapped in MULTIPLE_OR_MULTI_ERRORS),
    // and the caller needs that raw row to link the existing record.
    const res = await this.requestRaw('POST', path, {
      body: { data: [data], ...(trigger ? { trigger } : {}) },
    });
    const text = await res.text();
    let parsed: MutationResponse = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as MutationResponse;
      } catch {
        /* non-JSON error body — leave parsed empty */
      }
    }
    const row = (parsed.data?.[0] ?? {}) as MutationRow;
    const hasRow = Object.keys(row).length > 0;
    return {
      code: String(row.code ?? ''),
      id: String(row.details?.id ?? ''),
      message: String(row.message ?? ''),
      row: (hasRow ? row : parsed) as Record<string, unknown>,
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

  /**
   * Record timeline (`GET /{module}/{id}/__timeline`) — field history + done_by actor.
   * Use `doneByUserId` to filter to one CRM user (timeline “by …”).
   */
  async getRecordTimeline(
    module: string,
    recordId: string,
    opts: { doneByUserId?: string; perPage?: number } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(recordId)}/__timeline`;
    const query: Record<string, string | number> = {
      sort_by: 'audited_time',
      per_page: opts.perPage ?? 50,
      include_inner_details: 'field_history.field_label,done_by.profile',
    };
    if (opts.doneByUserId?.trim()) {
      query.filters = JSON.stringify({
        field: { api_name: 'done_by.id' },
        comparator: 'in',
        value: [opts.doneByUserId.trim()],
      });
    }
    const res = await this.requestRaw('GET', path, { query });
    if (res.status === 204 || res.status === 404) return [];
    const text = await res.text();
    if (!res.ok) throw this.httpError('GET', path, res.status, text);
    const json = text ? (JSON.parse(text) as { __timeline?: Array<Record<string, unknown>> }) : {};
    return json.__timeline ?? [];
  }

  /** The record's live Blueprint state and currently available transitions. */
  async getBlueprintDetails(module: string, id: string): Promise<BlueprintDetails | null> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}/actions/blueprint`;
    const res = await this.requestRaw('GET', path);
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try {
        code = String((JSON.parse(text) as { code?: unknown }).code ?? '');
      } catch {
        // Preserve Zoho's raw body in the wrapper error when it is not JSON.
      }
      if (res.status === 400 && code === 'RECORD_NOT_IN_PROCESS') return null;
      throw this.httpError('GET', path, res.status, text);
    }
    if (!text) return null;
    const json = JSON.parse(text) as {
      blueprint?: {
        process_info?: {
          id?: unknown;
          name?: unknown;
          api_name?: unknown;
          field_label?: unknown;
          field_value?: unknown;
        };
        transitions?: Array<{
          id?: unknown;
          name?: unknown;
          next_field_value?: unknown;
          type?: unknown;
          criteria_matched?: unknown;
          criteria_message?: unknown;
          data?: Record<string, unknown>;
          fields?: Array<{
            api_name?: unknown;
            field_label?: unknown;
            display_label?: unknown;
            data_type?: unknown;
            mandatory?: unknown;
            system_mandatory?: unknown;
            read_only?: unknown;
            field_read_only?: unknown;
            pick_list_values?: Array<{ display_value?: unknown; actual_value?: unknown }>;
          }>;
        }>;
      };
    };
    const blueprint = json.blueprint;
    if (!blueprint?.process_info) return null;
    const process = blueprint.process_info;
    const transitions: BlueprintTransition[] = (blueprint.transitions ?? [])
      .filter((transition) => typeof transition.id === 'string')
      .map((transition) => ({
        id: String(transition.id),
        name: typeof transition.name === 'string' ? transition.name : '',
        nextValue: typeof transition.next_field_value === 'string' ? transition.next_field_value : '',
        type: typeof transition.type === 'string' ? transition.type : 'manual',
        criteriaMatched: transition.criteria_matched !== false,
        criteriaMessage: typeof transition.criteria_message === 'string' ? transition.criteria_message : '',
        fields: (transition.fields ?? [])
          .map((field) => {
            // Widget/related-list metadata can omit api_name. Keep those fields in the response so
            // a mandatory unsupported input blocks the transition instead of being silently lost.
            const apiName = typeof field.api_name === 'string' ? field.api_name : '';
            return {
              apiName,
              label:
                typeof field.display_label === 'string'
                  ? field.display_label
                  : typeof field.field_label === 'string'
                    ? field.field_label
                    : apiName,
              dataType: typeof field.data_type === 'string' ? field.data_type : 'text',
              mandatory: field.mandatory === true || field.system_mandatory === true,
              readOnly: field.read_only === true || field.field_read_only === true,
              value: transition.data?.[apiName] ?? null,
              options: (field.pick_list_values ?? []).flatMap((option) => {
                // Zoho sometimes omits `actual_value` and only sends `display_value`.
                const actual = typeof option.actual_value === 'string' ? option.actual_value : '';
                const display = typeof option.display_value === 'string' ? option.display_value : '';
                const value = actual || display;
                if (!value) return [];
                return [{ label: display || value, value }];
              }),
            };
          }),
      }));
    return {
      process: {
        id: typeof process.id === 'string' ? process.id : '',
        name: typeof process.name === 'string' ? process.name : '',
        fieldApiName: typeof process.api_name === 'string' ? process.api_name : '',
        fieldLabel: typeof process.field_label === 'string' ? process.field_label : 'Status',
        currentValue: typeof process.field_value === 'string' ? process.field_value : '',
      },
      transitions,
    };
  }

  /** Compatibility projection used by status-by-value callers. */
  async getBlueprintTransitions(
    module: string,
    id: string,
  ): Promise<Array<{ id: string; nextValue: string; name: string }>> {
    const blueprint = await this.getBlueprintDetails(module, id);
    return blueprint?.transitions.map(({ id: transitionId, nextValue, name }) => ({
      id: transitionId,
      nextValue,
      name,
    })) ?? [];
  }

  /**
   * Execute a blueprint transition — the only way to move a blueprint-controlled field (e.g. Lead
   * `Status`) when the record is in an active blueprint. `data` supplies any fields the transition
   * requires (e.g. a reason). Throws on a row-level failure code.
   * `PUT /{module}/{id}/actions/blueprint`.
   */
  async executeBlueprintTransition(
    module: string,
    id: string,
    transitionId: string,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}/actions/blueprint`;
    const res = await this.requestRaw('PUT', path, {
      body: { blueprint: [{ transition_id: transitionId, data }] },
    });
    const text = await res.text();
    if (!res.ok) throw this.httpError('PUT', path, res.status, text);
    const json = text
      ? (JSON.parse(text) as MutationRow & { data?: MutationRow[]; blueprint?: MutationRow[] })
      : {};
    const row = json.data?.[0] ?? json.blueprint?.[0] ?? json;
    if (row && row.code && row.code !== 'SUCCESS') {
      throw new Error(`[zoho-crm-records] blueprint transition ${module} failed — ${row.code}: ${row.message ?? ''}`);
    }
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
