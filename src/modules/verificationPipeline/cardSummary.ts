/**
 * Bulk read-only compact facts for the Verification roster cards, keyed by deal id
 * (= requests.request_id for Deal intake): state, Plaid link, offer terms, missing fields, doc count,
 * and the verifier working the case. Read live from `requests`; degrades to empty on failure.
 */
import { verificationDb } from '../../integrations/verificationDb.js';
import { extractSalesRequirements, type RequirementEventInput } from './requirements.js';
import { normalizeReviewState, type VerificationCardSummary } from './types.js';

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
const txt = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const iso = (value: Date | string | null): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

interface RequestSummaryRow {
  request_id: string;
  status: string | null;
  manual_review_status: string | null;
  plaid_link_url: string | null;
  plaid_status: string | null;
  plaid_link_state: string | null;
  manual_review_resolution: Rec | null;
  applicant_profile: Rec | null;
  payload: Rec | null;
  manual_review_owner_username: string | null;
  updated_at: Date | string | null;
}

interface EventRow {
  id: number;
  request_id: string;
  status: string | null;
  title: string;
  payload: Rec | null;
  created_at: Date | string | null;
}

function computeMissing(profile: Rec, payload: Rec): string[] {
  const zoho = rec(payload.zoho_raw);
  const present = (...vals: unknown[]): boolean => vals.some((v) => txt(v) !== '');
  const missing: string[] = [];
  if (!present(profile.email, zoho.Email)) missing.push('email');
  if (!present(profile.phone, zoho.Phone)) missing.push('phone');
  if (!present(profile.dateOfBirth, zoho.Birth_Of_Date)) missing.push('date of birth');
  if (!present(profile.firstName, zoho.First_Name)) missing.push('first name');
  if (!present(profile.lastName, zoho.Last_Name)) missing.push('last name');
  if (!present(profile.address, zoho.Address, zoho.Street)) missing.push('address');
  if (!present(profile.city, zoho.City)) missing.push('city');
  if (!present(profile.state, zoho.State)) missing.push('state');
  if (!present(profile.zipCode, zoho.Zip_Code)) missing.push('zip');
  const hasDot = present(profile.dotNumber, payload.dot_number, zoho.DOT);
  const hasMc = present(profile.mcNumber, zoho.emc, zoho.MC);
  const hasCompanyState = present(payload.company_name, zoho.Name) && present(profile.state, zoho.State);
  if (!hasDot && !hasMc && !hasCompanyState) missing.push('DOT / MC / company');
  return missing;
}

export async function getLiveVerificationSummaries(
  dealIds: string[],
): Promise<Map<string, VerificationCardSummary>> {
  const ids = [...new Set(dealIds.map(txt).filter(Boolean))].slice(0, 1000);
  const summaries = new Map<string, VerificationCardSummary>();
  if (!verificationDb.isConfigured() || ids.length === 0) return summaries;

  const requests = await verificationDb.query<RequestSummaryRow>(
    `select request_id, status, manual_review_status, plaid_link_url, plaid_status, plaid_link_state,
            manual_review_resolution, applicant_profile, payload, manual_review_owner_username, updated_at
       from requests
      where request_id = any($1::text[])`,
    [ids],
  );
  const events = await verificationDb.query<EventRow>(
    `select id, request_id, status, title, payload, created_at
       from request_tracker_events
      where request_id = any($1::text[])
      order by id desc limit 5000`,
    [ids],
  );

  const owners = [...new Set(requests.map((r) => txt(r.manual_review_owner_username)).filter(Boolean))];
  const [docCounts, workerNames] = await Promise.all([
    verificationDb
      .query<{ request_id: string; n: string }>(
        `select request_id, count(*)::text as n from file_attachments
          where request_id = any($1::text[]) group by request_id`,
        [ids],
      )
      .catch(() => [] as Array<{ request_id: string; n: string }>),
    owners.length
      ? verificationDb
          .query<{ username: string; display_name: string | null }>(
            `select username, display_name from admin_users where username = any($1::text[])`,
            [owners],
          )
          .catch(() => [] as Array<{ username: string; display_name: string | null }>)
      : Promise.resolve([] as Array<{ username: string; display_name: string | null }>),
  ]);
  const docCountByRequest = new Map(docCounts.map((row) => [row.request_id, Number(row.n) || 0]));
  const workerByUsername = new Map(workerNames.map((row) => [row.username, txt(row.display_name)]));

  const eventsByRequest = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = eventsByRequest.get(event.request_id) ?? [];
    list.push(event);
    eventsByRequest.set(event.request_id, list);
  }

  for (const request of requests) {
    const resolution = rec(request.manual_review_resolution);
    const requirementEvents: RequirementEventInput[] = (eventsByRequest.get(request.request_id) ?? []).map(
      (event) => ({
        id: event.id,
        status: event.status,
        title: event.title,
        payload: event.payload,
        createdAt: iso(event.created_at) ?? '',
      }),
    );
    const ownerUsername = txt(request.manual_review_owner_username);
    const plaidStatus = txt(request.plaid_status);
    const plaidLinkUrl = txt(request.plaid_link_url);
    summaries.set(request.request_id, {
      state: normalizeReviewState(request.status, request.manual_review_status, txt(resolution.decision)),
      status: txt(request.status) || 'UNKNOWN',
      updatedAt: iso(request.updated_at),
      plaidLinkUrl: plaidLinkUrl && plaidStatus && plaidStatus !== 'none' ? plaidLinkUrl : null,
      plaidStatus: plaidStatus || null,
      approvedLimit: num(resolution.approved_limit),
      paymentType: txt(resolution.payment_type) || null,
      billingCycle: txt(resolution.billing_cycle) || null,
      missingFields: computeMissing(rec(request.applicant_profile), rec(request.payload)),
      docsUploaded: docCountByRequest.get(request.request_id) ?? 0,
      workingOn: (ownerUsername && (workerByUsername.get(ownerUsername) || ownerUsername)) || null,
      requirementEventIds: extractSalesRequirements(requirementEvents).map((item) => item.eventId),
    });
  }
  return summaries;
}
