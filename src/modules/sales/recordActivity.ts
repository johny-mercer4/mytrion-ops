/**
 * Sales record activity — the call history + Notes shown under a Lead/Deal in the Data Center.
 *
 * Call history merges TWO sources, tagged so the UI can badge them:
 *  - `mytrion` — our own `mytrion_calls` log (accurate duration the native Zoho log drops);
 *  - `zoho`    — the Zoho CRM Calls related to the record (the native RingCentral→Zoho call log).
 * Each source is best-effort: if one read fails the other still returns.
 *
 * Notes read/create/edit/delete go straight to the Zoho CRM Notes module (related to the Lead/Deal).
 * Attachments are added by the route after create via
 * `zohoCrm.attachFileToRecord('Notes', noteId, …)`.
 */
import { mytrionCallRepo } from '../../repos/mytrionCallRepo.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import {
  deleteNoteAsUser,
  insertNoteAsUser,
  updateNoteAsUser,
} from '../../integrations/zohoUserAuth.js';
import { AppError, RBACError } from '../../lib/errors.js';
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
  /** Server-authoritative: the caller is the note owner or has manager/admin authority. */
  canManage: boolean;
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

function zohoUserIdFromContext(ctx?: TenantContext): string | undefined {
  return ctx?.userId?.startsWith('zoho:') && !ctx.userId.startsWith('zoho:zuid:')
    ? ctx.userId.slice('zoho:'.length)
    : undefined;
}

/** Manager/admin authority is derived from the verified server context, never browser claims. */
export function canManageRecordNote(ctx: TenantContext, ownerId: string): boolean {
  const managerIdentity = [...(ctx.profiles ?? []), ctx.callerRole ?? '']
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === 'manager' || value === 'management' || value === 'sales manager');
  return (
    ctx.bypassRbac === true ||
    ctx.role === 'admin' ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('management') ||
    managerIdentity ||
    (Boolean(ownerId) && zohoUserIdFromContext(ctx) === ownerId)
  );
}

function lookupId(value: unknown): string {
  return value && typeof value === 'object' ? String((value as { id?: unknown }).id ?? '') : '';
}

/** Existing Zoho Notes on a Lead/Deal (newest returned by Zoho first). */
export async function fetchRecordNotes(
  module: CrmModule,
  id: string,
  ctx: TenantContext,
): Promise<NoteItem[]> {
  const rows = await zohoCrmRecords.getRelatedRecords(module, id, 'Notes', [
    'Note_Title',
    'Note_Content',
    'Created_Time',
    'Owner',
  ]);
  return rows.map((r) => {
    const ownerId = lookupId(r.Owner);
    return {
      id: String(r.id ?? ''),
      title: typeof r.Note_Title === 'string' ? r.Note_Title : '',
      content: typeof r.Note_Content === 'string' ? r.Note_Content : '',
      createdAt: typeof r.Created_Time === 'string' ? r.Created_Time : '',
      owner:
        r.Owner && typeof r.Owner === 'object'
          ? String((r.Owner as { name?: unknown }).name ?? '')
          : '',
      canManage: canManageRecordNote(ctx, ownerId),
    };
  });
}

/**
 * Create a Zoho Note under a Lead/Deal. Returns the new note id (for an optional attachment).
 *
 * When ctx carries a real Zoho user id and a refresh token has been stored for that user, the
 * insert is made using their own access token so that Zoho's "Created By" field reflects the
 * real agent. The Owner field is always set to the agent's Zoho user id regardless of which
 * token path is used. Falls back to the service account on any failure.
 */
export async function createRecordNote(
  module: CrmModule,
  id: string,
  input: { title?: string; content: string },
  ctx?: TenantContext,
): Promise<string> {
  const zohoUserId = zohoUserIdFromContext(ctx);

  const noteData: Record<string, unknown> = {
    Note_Title: input.title?.trim() || 'Note',
    Note_Content: input.content,
    // Parent_Id is a multi-module lookup: Zoho requires `{ id, module: { api_name } }` (verified live).
    Parent_Id: { id, module: { api_name: module } },
    ...(zohoUserId ? { Owner: { id: zohoUserId } } : {}),
  };

  // Attempt user-attributed insert; fall back to service account if unavailable.
  if (zohoUserId && ctx) {
    const noteId = await insertNoteAsUser(ctx.tenantId, zohoUserId, noteData);
    if (noteId) return noteId;
  }

  return zohoCrmRecords.insertRecord('Notes', noteData);
}

async function assertManageableNote(
  ctx: TenantContext,
  module: CrmModule,
  parentId: string,
  noteId: string,
): Promise<void> {
  const note = await zohoCrmRecords.getRecord('Notes', noteId);
  const parentModule = typeof note?.$se_module === 'string' ? note.$se_module : '';
  if (!note || lookupId(note.Parent_Id) !== parentId || (parentModule && parentModule !== module)) {
    throw new AppError('Note not found', { statusCode: 404, code: 'NOT_FOUND', expose: true });
  }
  if (!canManageRecordNote(ctx, lookupId(note.Owner))) {
    throw new RBACError('You can only edit or delete notes you created');
  }
}

/** Update a note after verifying it belongs to this record and is manageable by the caller. */
export async function updateRecordNote(
  ctx: TenantContext,
  module: CrmModule,
  parentId: string,
  noteId: string,
  input: { title: string; content: string },
): Promise<void> {
  await assertManageableNote(ctx, module, parentId, noteId);
  const noteData = { Note_Title: input.title.trim(), Note_Content: input.content };
  const zohoUserId = zohoUserIdFromContext(ctx);
  if (zohoUserId && (await updateNoteAsUser(ctx.tenantId, zohoUserId, noteId, noteData))) return;
  await zohoCrmRecords.patchRecord('Notes', noteId, noteData);
}

/** Delete a note after verifying it belongs to this record and is manageable by the caller. */
export async function deleteRecordNote(
  ctx: TenantContext,
  module: CrmModule,
  parentId: string,
  noteId: string,
): Promise<void> {
  await assertManageableNote(ctx, module, parentId, noteId);
  const zohoUserId = zohoUserIdFromContext(ctx);
  if (zohoUserId && (await deleteNoteAsUser(ctx.tenantId, zohoUserId, noteId))) return;
  await zohoCrmRecords.deleteRecordById('Notes', noteId);
}
