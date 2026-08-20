/**
 * Collection desk — the worklist, the case timeline, the commitments, the placement queue, and
 * every write.
 *
 * Split from `api/collection.ts` (the finder-owned snapshots) rather than added to it, because
 * the two halves have different owners and different guarantees: everything there is a read of a
 * table an upsert job writes; everything here is a read or write of a table this app owns.
 *
 * Money stays a STRING end to end. Numerics leave Postgres as strings and are formatted at the
 * edge; a float in the middle is how a cent goes missing.
 */
import { request } from './transport';
import type { CollectionCaseRow, CollectionStage } from './collection';

const COLLECTION_HEADERS = { 'x-department-access': 'collection' } as const;

export const WORKLIST_LANES = [
  'plan_broken',
  'promise_due',
  'agency_returned',
  'agency_threshold',
  'payment_posted',
  'new_intake',
  'silent',
] as const;
export type WorklistLane = (typeof WORKLIST_LANES)[number];

export const CONTACT_CHANNELS = ['call', 'email', 'sms', 'letter'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_OUTCOMES = ['reached', 'no_answer', 'voicemail', 'wrong_number', 'refused'] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];

export const PLAN_FREQUENCIES = ['weekly', 'fortnightly', 'monthly'] as const;
export type PlanFrequency = (typeof PLAN_FREQUENCIES)[number];

export type ActivityKind =
  | 'contact'
  | 'promise'
  | 'plan'
  | 'payment'
  | 'stage'
  | 'agency'
  | 'note'
  | 'close';

/** The thresholds the server judged these cases against. Rendered, never re-derived here. */
export interface DeskPolicy {
  agencyMinDaysPastDue: number;
  agencyMinRemaining: number;
  agencyWarnWindowDays: number;
  promiseGraceDays: number;
  silentAfterDays: number;
  intakeUncontactedDays: number;
  agingBands: readonly number[];
}

export interface LastContact {
  occurredAt: string;
  channel: ContactChannel | null;
  outcome: ContactOutcome | null;
}

export interface PromiseRow {
  id: string;
  caseId: string;
  amount: string;
  dueDate: string;
  status: 'open' | 'kept' | 'broken' | 'cancelled';
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface PlanInstalment {
  id: string;
  seq: number;
  dueDate: string;
  amount: string;
  status: 'scheduled' | 'paid' | 'missed';
  paidAt: string | null;
}

export interface PaymentPlan {
  id: string;
  caseId: string;
  status: 'active' | 'completed' | 'cancelled' | 'broken';
  instalmentAmount: string;
  instalmentCount: number;
  frequency: PlanFrequency;
  firstPaymentDate: string;
  note: string | null;
  supersedesPlanId: string | null;
  createdByName: string | null;
  createdAt: string;
  instalments: PlanInstalment[];
}

export interface PlanProgress {
  planId: string;
  paid: number;
  missed: number;
  total: number;
}

/** What the desk knows about a case on top of the finder's snapshot. */
export interface CaseDeskInfo {
  lastContact: LastContact | null;
  daysSinceContact: number | null;
  promise: (PromiseRow & { daysLate: number }) | null;
  plan: PlanProgress | null;
}

export interface ActivityRow {
  id: string;
  caseId: string;
  kind: ActivityKind;
  channel: ContactChannel | null;
  outcome: ContactOutcome | null;
  summary: string;
  note: string | null;
  contactName: string | null;
  amount: string | null;
  actorUserId: string | null;
  actorName: string | null;
  meta: Record<string, unknown> | null;
  occurredAt: string;
}

export interface WorklistItem {
  case: CollectionCaseRow;
  lane: WorklistLane;
  score: number;
  lastContact: LastContact | null;
  daysSinceContact: number | null;
  promise: (PromiseRow & { daysLate: number }) | null;
  plan: PlanProgress | null;
  agencyReturned: boolean;
  daysToAgency: number;
}

export interface WorklistResult {
  items: WorklistItem[];
  total: number;
  lanes: Record<WorklistLane, number>;
  /** True when the open book exceeded the server's scan cap — the lane counts are then partial. */
  scanTruncated: boolean;
  policy: DeskPolicy;
}

export interface DeskSummary {
  recoveredMtd: string;
  openCases: number;
  remainingDebt: string;
  agencyPlaced: number;
}

export interface ArrayTradeline {
  reportPeriod: string;
  accountStatus: string | null;
  agencyName: string | null;
  hasAgency: boolean | null;
  dateOfBirth: string | null;
  excludedReason: string | null;
  validationErrors: string | null;
}

export interface CaseDeskBundle {
  plan: PaymentPlan | null;
  promises: PromiseRow[];
  tradeline: ArrayTradeline | null;
  /** Stages this case has actually been moved to, oldest first. Drives the spine's done marks. */
  stageHistory: CollectionStage[];
  policy: DeskPolicy;
}

export const METRO2_FIELDS = ['dateOfBirth', 'address', 'mcDot', 'firstDelinquency'] as const;
export type Metro2Field = (typeof METRO2_FIELDS)[number];
export type PlacementState = 'ready' | 'blocked' | 'error' | 'hold' | 'filed';

export interface PlacementRow {
  caseId: string;
  carrierId: string;
  name: string;
  mcDot: string | null;
  remaining: string;
  daysPastDue: number;
  stage: CollectionStage;
  state: PlacementState;
  readiness: Record<Metro2Field, boolean>;
  missing: Metro2Field[];
  blocking: string | null;
  reportPeriod: string | null;
  accountStatus: string | null;
  agencyName: string | null;
  placementDate: string | null;
}

export interface PlacementResult {
  items: PlacementRow[];
  total: number;
  counts: Record<PlacementState, number>;
  readyAmount: string;
  scanTruncated: boolean;
  metro2Fields: readonly Metro2Field[];
  policy: DeskPolicy;
}

function query(filter: object): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'boolean') out[key] = String(value);
    else if (typeof value === 'number' || typeof value === 'string') out[key] = value;
  }
  return out;
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

export async function getWorklist(
  filter: { lane?: WorklistLane | undefined; search?: string; limit?: number; offset?: number } = {},
): Promise<WorklistResult> {
  return (await request('GET', '/collection/worklist', {
    query: query(filter),
    headers: COLLECTION_HEADERS,
  })) as WorklistResult;
}

export async function getDeskSummary(): Promise<DeskSummary> {
  return (await request('GET', '/collection/summary', { headers: COLLECTION_HEADERS })) as DeskSummary;
}

export async function listActivity(
  caseId: string,
  filter: { kind?: ActivityKind | undefined; limit?: number; offset?: number } = {},
): Promise<{ items: ActivityRow[]; total: number }> {
  return (await request('GET', `/collection/cases/${encodeURIComponent(caseId)}/activity`, {
    query: query(filter),
    headers: COLLECTION_HEADERS,
  })) as { items: ActivityRow[]; total: number };
}

/** Plan + promises + the carrier's latest Array filing, in one call — they render together. */
export async function getCaseDesk(caseId: string): Promise<CaseDeskBundle> {
  return (await request('GET', `/collection/cases/${encodeURIComponent(caseId)}/desk`, {
    headers: COLLECTION_HEADERS,
  })) as CaseDeskBundle;
}

export async function getPlacementQueue(
  filter: { state?: PlacementState | undefined; search?: string; limit?: number; offset?: number } = {},
): Promise<PlacementResult> {
  return (await request('GET', '/collection/placement-queue', {
    query: query(filter),
    headers: COLLECTION_HEADERS,
  })) as PlacementResult;
}

/* ── Writes ────────────────────────────────────────────────────────────── */

export interface LogContactInput {
  channel: ContactChannel;
  outcome: ContactOutcome;
  note?: string | undefined;
  contactName?: string | undefined;
  promise?: { amount: string; dueDate: string } | undefined;
}

export async function logContact(
  caseId: string,
  input: LogContactInput,
): Promise<{ activity: ActivityRow; promise: PromiseRow | null }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/contact`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { activity: ActivityRow; promise: PromiseRow | null };
}

export async function createPromise(
  caseId: string,
  input: { amount: string; dueDate: string; note?: string | undefined },
): Promise<{ promise: PromiseRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/promises`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { promise: PromiseRow };
}

export async function createPaymentPlan(
  caseId: string,
  input: {
    instalmentAmount: string;
    instalmentCount: number;
    frequency: PlanFrequency;
    firstPaymentDate: string;
    note?: string | undefined;
  },
): Promise<{ plan: PaymentPlan }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/plan`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { plan: PaymentPlan };
}

export async function setStage(
  caseId: string,
  input: { stage: CollectionStage; note?: string | undefined },
): Promise<{ case: CollectionCaseRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/stage`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

export async function placeWithAgency(
  caseId: string,
  input: { agency: string; placementDate: string; note?: string | undefined },
): Promise<{ case: CollectionCaseRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/placement`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

export async function closeCase(
  caseId: string,
  input: {
    reason: 'paid_in_full' | 'below_threshold' | 'left_cmp' | 'manual' | 'case_lost';
    writeOffAmount?: string | undefined;
    note?: string | undefined;
  },
): Promise<{ case: CollectionCaseRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/close`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

export async function reopenCase(caseId: string): Promise<{ case: CollectionCaseRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/reopen`, {
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

export async function addNote(caseId: string, note: string): Promise<{ activity: ActivityRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/notes`, {
    body: { note },
    headers: COLLECTION_HEADERS,
  })) as { activity: ActivityRow };
}

export async function setInstalmentStatus(
  caseId: string,
  seq: number,
  status: 'scheduled' | 'paid' | 'missed',
): Promise<{ plan: PaymentPlan | null }> {
  return (await request('PATCH', `/collection/cases/${encodeURIComponent(caseId)}/instalments/${seq}`, {
    body: { status },
    headers: COLLECTION_HEADERS,
  })) as { plan: PaymentPlan | null };
}
