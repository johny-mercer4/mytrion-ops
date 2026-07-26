/**
 * Sales record activity — the call history + Notes shown under a Lead/Deal in the Data Center.
 *
 * Call history merges TWO sources, tagged so the UI can badge them:
 *  - `mytrion` — our own `mytrion_calls` log (accurate duration the native Zoho log drops);
 *  - `zoho`    — the Zoho CRM Calls related to the record (the native RingCentral→Zoho call log).
 * Each source is best-effort: if one read fails the other still returns.
 *
 * Notes read/create go straight to the Zoho CRM Notes module (related to the Lead/Deal). Attachments
 * are added by the route after create via `zohoCrm.attachFileToRecord('Notes', noteId, …)`.
 */
import { mytrionCallRepo } from '../../repos/mytrionCallRepo.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import type { TenantContext } from '../../types/tenantContext.js';

export type CrmModule = 'Leads' | 'Deals';

export interface CallHistoryItem {
  source: 'mytrion' | 'zoho';
  id: string;
  /** Best-available timestamp (ISO-ish string). */
  when: string;
  /** Sort key — epoch ms (0 when unknown). */
  whenTs: number;
  durationSeconds: number | null;
  status: string;
  label: string;
  number: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  owner: string;
}

const sourceTypeFor = (m: CrmModule): 'lead' | 'deal' => (m === 'Leads' ? 'lead' : 'deal');

function tsOf(v: unknown): number {
  const t = Date.parse(v == null ? '' : String(v));
  return Number.isNaN(t) ? 0 : t;
}

/** Seconds from a Zoho Call row: `Call_Duration_in_seconds`, else parse `Call_Duration` ("m:ss"). */
function zohoCallSeconds(row: Record<string, unknown>): number | null {
  const secs = Number(row.Call_Duration_in_seconds);
  if (Number.isFinite(secs) && secs >= 0) return secs;
  const dur = typeof row.Call_Duration === 'string' ? row.Call_Duration : '';
  if (dur && /^\d+(:\d{1,2})+$/.test(dur)) {
    return dur.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  }
  return null;
}

/** Merged, newest-first call history for one Lead/Deal (our log + the Zoho Calls related to it). */
export async function fetchRecordCallHistory(
  ctx: TenantContext,
  module: CrmModule,
  id: string,
): Promise<CallHistoryItem[]> {
  const out: CallHistoryItem[] = [];

  // (1) Our own accurate log.
  try {
    const rows = await mytrionCallRepo.listForSource(ctx, sourceTypeFor(module), id, { limit: 200 });
    for (const r of rows) {
      const when = r.callTime ?? r.createdAt;
      const whenStr = when instanceof Date ? when.toISOString() : String(when ?? '');
      out.push({
        source: 'mytrion',
        id: r.id,
        when: whenStr,
        whenTs: tsOf(whenStr),
        durationSeconds: r.durationSeconds ?? null,
        status: r.callStatus === 'picked_up' ? 'Answered' : 'Missed',
        label: r.result || r.direction || 'Outbound',
        number: r.phoneNumber ?? '',
      });
    }
  } catch {
    /* best-effort — keep the Zoho side */
  }

  // (2) Zoho CRM Calls related to the record (leads relate via Who_Id, deals via What_Id). `id` is a
  //     numeric CRM record id (route-validated), so the interpolation is safe.
  try {
    const filterField = module === 'Leads' ? 'Who_Id' : 'What_Id';
    const q =
      `select id, Call_Type, Call_Start_Time, Call_Duration, Call_Duration_in_seconds, ` +
      `Outgoing_Call_Status, Subject, Call_Result from Calls where ${filterField} = '${id}' ` +
      `order by Call_Start_Time desc limit 0, 100`;
    const { rows } = await zohoCrm.runCoql(q);
    for (const r of rows) {
      const when = typeof r.Call_Start_Time === 'string' ? r.Call_Start_Time : '';
      out.push({
        source: 'zoho',
        id: String(r.id ?? ''),
        when,
        whenTs: tsOf(when),
        durationSeconds: zohoCallSeconds(r),
        status: String(r.Outgoing_Call_Status ?? r.Call_Result ?? r.Call_Type ?? ''),
        label: String(r.Subject ?? r.Call_Type ?? 'Call'),
        number: '',
      });
    }
  } catch {
    /* best-effort — keep the Mytrion side */
  }

  return out.sort((a, b) => b.whenTs - a.whenTs);
}

/** Existing Zoho Notes on a Lead/Deal (newest returned by Zoho first). */
export async function fetchRecordNotes(module: CrmModule, id: string): Promise<NoteItem[]> {
  const rows = await zohoCrmRecords.getRelatedRecords(module, id, 'Notes', [
    'Note_Title',
    'Note_Content',
    'Created_Time',
    'Owner',
  ]);
  return rows.map((r) => ({
    id: String(r.id ?? ''),
    title: typeof r.Note_Title === 'string' ? r.Note_Title : '',
    content: typeof r.Note_Content === 'string' ? r.Note_Content : '',
    createdAt: typeof r.Created_Time === 'string' ? r.Created_Time : '',
    owner:
      r.Owner && typeof r.Owner === 'object'
        ? String((r.Owner as { name?: unknown }).name ?? '')
        : '',
  }));
}

/** Create a Zoho Note under a Lead/Deal. Returns the new note id (for an optional attachment). */
export async function createRecordNote(
  module: CrmModule,
  id: string,
  input: { title?: string; content: string },
): Promise<string> {
  // Parent_Id is a multi-module lookup: Zoho requires `{ id, module: { api_name } }` (verified live).
  return zohoCrmRecords.insertRecord('Notes', {
    Note_Title: input.title?.trim() || 'Note',
    Note_Content: input.content,
    Parent_Id: { id, module: { api_name: module } },
  });
}
