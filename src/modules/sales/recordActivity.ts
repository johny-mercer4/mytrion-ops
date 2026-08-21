/**
 * Sales record activity — the call history + Notes shown under a Lead/Deal in the Data Center.
 *
 * Call history merges TWO sources, tagged so the UI can badge them:
 *  - `mytrion` — our own `mytrion_calls` log (accurate duration the native Zoho log drops);
 *  - `zoho`    — the Zoho CRM Calls related to the record (the native RingCentral→Zoho call log).
 * Each source is best-effort: if one read fails the other still returns.
 *
 * Notes read/create go straight to the Zoho CRM Notes module (related to the Lead/Deal).
 */
import { mytrionCallRepo } from '../../repos/mytrionCallRepo.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import {
  deleteRecordAsUser,
  insertNoteAsUser,
  patchRecordAsUser,
  zohoActorId,
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
    const rows = await mytrionCallRepo.listForSource(ctx, sourceTypeFor(module), id, {
      limit: 200,
    });
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

function viewedZohoUserId(ctx: TenantContext): string | undefined {
  const match = /^zoho:(.+)$/.exec(ctx.userId);
  const zohoUserId = match?.[1]?.trim();
  return zohoUserId && !zohoUserId.startsWith('zuid:') ? zohoUserId : undefined;
}

function lookupId(value: unknown): string {
  return value && typeof value === 'object' ? String((value as { id?: unknown }).id ?? '') : '';
}

/** Manager/admin authority is derived from the verified server context, never browser claims. */
export function canManageRecordNote(ctx: TenantContext, creatorId: string): boolean {
  const managerIdentity = [...(ctx.profiles ?? []), ctx.callerRole ?? '']
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === 'manager' || value === 'management' || value === 'sales manager');
  return (
    ctx.bypassRbac === true ||
    ctx.role === 'admin' ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('management') ||
    managerIdentity ||
    (Boolean(creatorId) && viewedZohoUserId(ctx) === creatorId)
  );
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
    'Created_By',
    'Owner',
  ]);
  return rows.map((r) => {
    const creator = r.Created_By && typeof r.Created_By === 'object' ? r.Created_By : r.Owner;
    return {
      id: String(r.id ?? ''),
      title: typeof r.Note_Title === 'string' ? r.Note_Title : '',
      content: typeof r.Note_Content === 'string' ? r.Note_Content : '',
      createdAt: typeof r.Created_Time === 'string' ? r.Created_Time : '',
      // Created_By is immutable action attribution. Owner may be reassigned independently.
      owner:
        creator && typeof creator === 'object'
          ? String((creator as { name?: unknown }).name ?? '')
          : '',
      canManage: canManageRecordNote(ctx, lookupId(creator)),
    };
  });
}

/**
 * Create a Zoho Note under a Lead/Deal. Returns the new note id (for an optional attachment).
 *
 * The insert always uses the real actor's token so Zoho's Created_By/timeline identity is the
 * human agent (or the real admin behind an act-as session). Missing/expired grants fail closed.
 */
export async function createRecordNote(
  module: CrmModule,
  id: string,
  input: { title?: string; content: string },
  ctx: TenantContext,
): Promise<string> {
  const zohoUserId = zohoActorId(ctx);

  const noteData: Record<string, unknown> = {
    Note_Title: input.title?.trim() || 'Note',
    Note_Content: input.content,
    // Parent_Id is a multi-module lookup: Zoho requires `{ id, module: { api_name } }` (verified live).
    Parent_Id: { id, module: { api_name: module } },
    Owner: { id: zohoUserId },
  };
  return insertNoteAsUser(ctx.tenantId, zohoUserId, noteData);
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
    throw new AppError('Note not found', {
      statusCode: 404,
      code: 'NOT_FOUND',
      expose: true,
    });
  }
  const creatorId = lookupId(note.Created_By) || lookupId(note.Owner);
  if (!canManageRecordNote(ctx, creatorId)) {
    throw new RBACError('You can only edit or delete notes you created');
  }
}

/** Update a note through the real actor's OAuth token after server-side ownership checks. */
export async function updateRecordNote(
  ctx: TenantContext,
  module: CrmModule,
  parentId: string,
  noteId: string,
  input: { title: string; content: string },
): Promise<void> {
  await assertManageableNote(ctx, module, parentId, noteId);
  await patchRecordAsUser(ctx.tenantId, zohoActorId(ctx), 'Notes', noteId, {
    Note_Title: input.title.trim(),
    Note_Content: input.content,
  });
}

/** Delete a note through the real actor's OAuth token after server-side ownership checks. */
export async function deleteRecordNote(
  ctx: TenantContext,
  module: CrmModule,
  parentId: string,
  noteId: string,
): Promise<void> {
  await assertManageableNote(ctx, module, parentId, noteId);
  await deleteRecordAsUser(ctx.tenantId, zohoActorId(ctx), 'Notes', noteId);
}
