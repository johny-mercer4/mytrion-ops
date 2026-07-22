/**
 * Sales Mytrion CRM-backed touchpoints — native replacements for the Zoho Deluge functions
 * mytrionFetchAnnouncements / mytrionFetchInbox / mytrionDeleteInboxMessage / mytrionCreateLead /
 * mytrionApplicationUpdate / mytrionTruckingNumberRequest. Each hit Zoho CRM directly (getRecords /
 * searchRecords / createRecord / getRelatedRecords / getRecordById / delete / subforms); we do the same
 * via `zohoCrmRecords`, dropping the Zoho Deluge round-trip. RETURN SHAPES are byte-compatible with the
 * Deluge output so the frontend parsers are unchanged.
 *
 * IDs interpolated into Zoho search criteria (Owner / Application_ID / Carrier_ID) are validated numeric
 * first — a non-numeric id can't be smuggled into the criteria string.
 */
import { zohoCrmRecords } from './zohoCrmRecords.js';

type Row = Record<string, unknown>;

/** Deluge `.toString().trim()` parity — '' for null/undefined. */
const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
const numericId = (v: string): boolean => /^\d+$/.test(v);

// ── ET date helpers (announcements + inbox use a 30-day America/New_York window, like the Deluge) ────
function etYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
/** YYYY-MM-DD `days` before today (ET). */
function etDaysAgo(days: number): string {
  const p = etYmd(new Date()).split('-');
  const dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) - days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
/** Date part of a Zoho Created_Time ("2026-07-21T09:00:00-05:00" → "2026-07-21"). */
function datePart(createdTime: string): string {
  const t = createdTime.trim();
  if (t.includes('T')) return t.slice(0, t.indexOf('T'));
  if (t.includes(' ')) return t.slice(0, t.indexOf(' '));
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. ANNOUNCEMENTS  (was standalone.mytrionFetchAnnouncements)
//    Sales_Announcements created in the last 30 days. Returns an ARRAY of announcement objects (the
//    Deluge returned a bare list; the touchpoint's 'permissive' unwrap passes an array straight through).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ANNOUNCEMENT_FIELDS = [
  'Content',
  'Created_By',
  'Is_Required',
  'Priority',
  'Name',
  'Owner',
  'Subject',
  'Tag',
  'Type',
  'Created_Time',
] as const;

export async function fetchAnnouncements(): Promise<Row[]> {
  const threshold = etDaysAgo(30);
  const { rows } = await zohoCrmRecords.listRecords('Sales_Announcements', ANNOUNCEMENT_FIELDS, {
    perPage: 200,
    sortBy: 'Created_Time',
    sortOrder: 'desc',
  });
  const out: Row[] = [];
  for (const r of rows) {
    const created = str(r.Created_Time);
    if (created && datePart(created) < threshold) continue; // last 30 days only
    out.push({
      Content: r.Content ?? null,
      Created_By: r.Created_By ?? null,
      Is_Required: r.Is_Required ?? null,
      Priority: r.Priority ?? null,
      Name: r.Name ?? null,
      Owner: r.Owner ?? null,
      Subject: r.Subject ?? null,
      Tag: r.Tag ?? null,
      Type: r.Type ?? null,
      Created_Time: r.Created_Time ?? null,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. INBOX  (was standalone.mytrionFetchInbox)
//    Org_Module records owned by the caller, created in the last 30 days.
//    Returns { status, userId, messages: [{ id, name, subject, content, type, priority, tag, sourceUrl,
//    createdDate, createdTime, ownerName, ownerEmail, ownerId }] }.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
const INBOX_FIELDS = [
  'Name',
  'Subject',
  'Content',
  'Type',
  'Priority',
  'Tag',
  'Source_Url',
  'Created_Time',
  'Owner',
] as const;

export async function fetchInbox(userId: string): Promise<Row> {
  if (!numericId(userId)) return { status: 'success', userId, messages: [] };
  try {
    const threshold = etDaysAgo(30);
    const { rows } = await zohoCrmRecords.searchRecords('Org_Module', {
      criteria: `(Owner:equals:${userId})`,
      fields: INBOX_FIELDS,
      perPage: 200,
    });
    const messages: Row[] = [];
    for (const r of rows) {
      const createdTimeRaw = str(r.Created_Time);
      const createdClean = datePart(createdTimeRaw);
      if (!createdClean || createdClean < threshold) continue;
      const owner = (r.Owner as Row) ?? {};
      messages.push({
        id: str(r.id),
        name: str(r.Name),
        subject: str(r.Subject),
        content: str(r.Content),
        type: str(r.Type),
        priority: str(r.Priority) || 'Normal',
        tag: str(r.Tag),
        sourceUrl: str(r.Source_Url),
        createdDate: createdClean,
        createdTime: createdTimeRaw,
        ownerName: str(owner.name),
        ownerEmail: str(owner.email),
        ownerId: str(owner.id),
      });
    }
    return { status: 'success', userId, messages };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. DELETE INBOX MESSAGE  (was standalone.mytrionDeleteInboxMessage)
//    Deletes an Org_Module record. Returns the bare string 'success' | 'error' (Deluge parity;
//    the touchpoint's 'permissive' unwrap passes the string through — the widget is fire-and-forget).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function deleteInboxMessage(recordId: string): Promise<'success' | 'error'> {
  try {
    await zohoCrmRecords.deleteRecord('Org_Module', recordId);
    return 'success';
  } catch {
    return 'error';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. CREATE LEAD  (was standalone.mytrionCreateLead)
//    Inserts a Leads record (workflow-triggered), owned by the caller. Returns { success, leadId,
//    message } on success; on failure { success:false, message, response } where `response` is the raw
//    Zoho row so the UI can pull an existing lead id out of a DUPLICATE_DATA result.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function createLead(userId: string, payload: Row): Promise<Row> {
  const p = (k: string): string => str(payload[k]);
  const phone = p('phone');
  const leadData: Row = {
    First_Name: p('firstName'),
    Last_Name: p('lastName') || 'Unknown',
    Company: p('companyName') || 'Unknown',
    Phone: phone,
    Cell: phone,
    Owner: userId,
    utm_source: 'mytrion',
    Status: 'New Lead',
  };
  const email = p('email');
  if (email) leadData.Email = email;
  const dot = p('dot');
  if (dot && Number.isFinite(Number(dot))) leadData.DOT = Number(dot);
  const fullAddress = p('fullAddress');
  if (fullAddress) leadData.Full_Address = fullAddress;
  const truckSize = p('truckSize');
  if (truckSize) {
    leadData.Fleet_size = truckSize;
    if (Number.isFinite(Number(truckSize))) leadData.Trucks = Number(truckSize);
  }
  const powerUnits = p('powerUnits');
  if (powerUnits && Number.isFinite(Number(powerUnits))) leadData.Power_Units = Number(powerUnits);
  const addDate = p('addDate');
  if (addDate) leadData.Start_Date = addDate;
  const changeDate = p('changeDate');
  if (changeDate) leadData.Status_Last_Change = changeDate;
  const operatingStatus = p('operatingStatus');
  if (operatingStatus) leadData.Description = operatingStatus;
  // Salutation (the "Title" dropdown) is collected by CreateLeadForm and passed through the
  // touchpoint schema — persist it to the standard Zoho Leads Salutation field (was dropped).
  const salutation = p('salutation');
  if (salutation) leadData.Salutation = salutation;

  try {
    const res = await zohoCrmRecords.insertRecordDetailed('Leads', leadData, ['workflow']);
    if (res.code === 'SUCCESS' && res.id) {
      return { success: true, leadId: res.id, message: 'Lead created successfully.' };
    }
    return { success: false, message: 'Failed to create lead.', response: res.row };
  } catch (err) {
    return {
      success: false,
      message: 'Failed to create lead.',
      response: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. APPLICATION UPDATE  (was standalone.mytrionApplicationUpdate)
//    Deal by Application_ID → its Comments (WEX task field) + related Tasks whose subject contains
//    "New Wex Task Received". Returns { status, dealId, wexTaskField, wexTasks: [{ sbj, description,
//    createdDate }] }.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchApplicationUpdate(appId: string): Promise<Row> {
  if (!numericId(appId)) return { status: 'error', message: `No deal found for application id: ${appId}` };
  try {
    const { rows } = await zohoCrmRecords.searchRecords('Deals', {
      criteria: `(Application_ID:equals:${appId})`,
      fields: ['Comments'],
      perPage: 1,
    });
    const deal = rows[0];
    if (!deal) return { status: 'error', message: `No deal found for application id: ${appId}` };
    const dealId = str(deal.id);
    const tasks = await zohoCrmRecords.getRelatedRecords('Deals', dealId, 'Tasks', [
      'Subject',
      'Description',
      'Created_Time',
    ]);
    const wexTasks: Row[] = [];
    for (const t of tasks) {
      if (str(t.Subject).includes('New Wex Task Received')) {
        wexTasks.push({
          sbj: t.Subject ?? null,
          description: t.Description ?? null,
          createdDate: t.Created_Time ?? null,
        });
      }
    }
    return { status: 'success', dealId, wexTaskField: deal.Comments ?? '', wexTasks };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 6. TRUCKING NUMBER REQUEST  (was standalone.mytrionTruckingNumberRequest)
//    Deal by Carrier_ID → Fedex_Tracking + the Tracking_Information subform. Returns { status, dealId,
//    dealName, fedexTracking, trackingInfo: [{ trackingNumber, startDate, cardsOrdered }] }.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchTruckingNumbers(carrierId: string): Promise<Row> {
  if (!numericId(carrierId)) return { status: 'error', message: `No deal found for carrierId: ${carrierId}` };
  try {
    const { rows } = await zohoCrmRecords.searchRecords('Deals', {
      criteria: `(Carrier_ID:equals:${carrierId})`,
      perPage: 1,
    });
    const found = rows[0];
    if (!found) return { status: 'error', message: `No deal found for carrierId: ${carrierId}` };
    const dealId = str(found.id);
    const record = await zohoCrmRecords.getRecord('Deals', dealId);
    if (!record) return { status: 'error', message: `No deal found for carrierId: ${carrierId}` };
    const subforms = Array.isArray(record.Tracking_Information)
      ? (record.Tracking_Information as Row[])
      : [];
    const trackingInfo = subforms.map((sf) => ({
      trackingNumber: sf.Tracking_Number ?? '',
      startDate: sf.Start_Date ?? '',
      cardsOrdered: sf.Cards_ordered ?? '',
    }));
    return {
      status: 'success',
      dealId,
      dealName: record.Deal_Name ?? '',
      fedexTracking: record.Fedex_Tracking ?? '',
      trackingInfo,
    };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
