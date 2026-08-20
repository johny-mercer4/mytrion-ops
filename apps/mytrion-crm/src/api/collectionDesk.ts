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

/** A move the Blueprint allows from where this case is, in Zoho's own wording. */
export interface StageTransition {
  label: string;
  to: CollectionStage;
  precedence: number;
  /** Present when the Blueprint gates the move on something beyond judgement — the $8,000 line. */
  hint?: string;
}

/**
 * The Zoho columns the Mytrion schema deliberately does not store, computed server-side from the
 * relational model. See `src/modules/collection/caseDossier.ts` for why they are not columns.
 */
export interface CaseDossier {
  promiseStatus: 'Kept' | 'Failed' | 'Pending' | null;
  promiseToPayDate: string | null;
  paymentPlanCreated: boolean;
  paymentPlanType: 'Weekly' | 'Monthly' | 'Custom' | null;
  weeklyPaymentAmount: string | null;
  nextPaymentDueDate: string | null;
  firstContactDate: string | null;
  contactMethod: 'Call' | 'Email' | 'SMS' | 'Mail' | null;
  contactResult: 'Connected' | 'No Answer' | 'Wrong Number' | 'Refused' | null;
  totalContactAttempts: number;
  lastActivityDate: string;
  lastStageChangeDate: string | null;
  daysInCurrentStage: number;
  totalRemainingAmount: string;
  /** Null when the agency has no rate we can stand behind — renders as "not known", never $0. */
  agencyFee: string | null;
  totalDebtWithFee: string;
}

export type CollectionTaskStatus = 'open' | 'done' | 'cancelled';
export type CollectionTaskPriority = 'low' | 'normal' | 'high';

export interface CollectionTask {
  id: string;
  caseId: string;
  title: string;
  note: string | null;
  dueDate: string;
  status: CollectionTaskStatus;
  priority: CollectionTaskPriority;
  assigneeUserId: string | null;
  assigneeName: string | null;
  completedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  /** Negative while it is still ahead; null once the follow-up is no longer open. */
  daysLate: number | null;
}

export interface CaseDeskBundle {
  plan: PaymentPlan | null;
  promises: PromiseRow[];
  tradeline: ArrayTradeline | null;
  /** Stages this case has actually been moved to, oldest first. Drives the spine's done marks. */
  stageHistory: CollectionStage[];
  tasks: CollectionTask[];
  dossier: CaseDossier;
  /** Only the moves allowed from the case's current stage. The desk offers these and no others. */
  transitions: StageTransition[];
  suggestedCourt: 'small_claims' | 'civil_court';
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

/** The hand-maintained field blocks. Everything optional; only what is sent is written. */
export interface CaseFieldPatch {
  currentAgency?: string | null;
  secondCollectionAgency?: string | null;
  caineWeinerTier?: string | null;
  agencyResponseStatus?: string | null;
  agencyTransferDate?: string | null;
  legalActionRequired?: boolean;
  courtType?: string | null;
  legalFilingDate?: string | null;
  legalDocumentsAttached?: boolean;
  courtStatus?: string | null;
  skipTraceRequired?: boolean;
  verifiedEmail?: string | null;
  verifiedPhone?: string | null;
  verifiedAddress?: string | null;
  escalationRequired?: boolean;
  escalationDate?: string | null;
  cooperationStatus?: string | null;
  lossReason?: string | null;
  paymentReceived?: boolean;
  paymentReceivedDate?: string | null;
  reminderCycleActive?: boolean;
  earlyBadDebtorFlag?: boolean;
  totalCostIncurred?: string;
  note?: string;
}

/**
 * One save for the whole record, not one per block. The blocks are edited together on the case
 * page, so five endpoints would mean five round trips and a half-saved record if the third failed.
 */
export async function patchCaseFields(
  caseId: string,
  patch: CaseFieldPatch,
): Promise<{ case: CollectionCaseRow }> {
  return (await request('PATCH', `/collection/cases/${encodeURIComponent(caseId)}/fields`, {
    body: patch,
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

/**
 * Take the case. With no body the server assigns it to the caller, which is the only case the
 * desk has today — there is no collection-team roster endpoint to pick someone else from, and a
 * picker over the wrong list would be worse than not offering one.
 */
export async function assignCase(
  caseId: string,
  input: { userId?: string; name?: string | null } = {},
): Promise<{ case: CollectionCaseRow }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/assignee`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

export async function unassignCase(caseId: string): Promise<{ case: CollectionCaseRow }> {
  return (await request('DELETE', `/collection/cases/${encodeURIComponent(caseId)}/assignee`, {
    headers: COLLECTION_HEADERS,
  })) as { case: CollectionCaseRow };
}

export async function createCaseTask(
  caseId: string,
  input: {
    title: string;
    dueDate: string;
    note?: string | null;
    priority?: CollectionTaskPriority;
    assigneeUserId?: string | null;
    assigneeName?: string | null;
  },
): Promise<{ task: CollectionTask }> {
  return (await request('POST', `/collection/cases/${encodeURIComponent(caseId)}/tasks`, {
    body: input,
    headers: COLLECTION_HEADERS,
  })) as { task: CollectionTask };
}

export async function updateCaseTask(
  taskId: string,
  patch: {
    title?: string;
    note?: string | null;
    dueDate?: string;
    priority?: CollectionTaskPriority;
    status?: CollectionTaskStatus;
  },
): Promise<{ task: CollectionTask }> {
  return (await request('PATCH', `/collection/tasks/${encodeURIComponent(taskId)}`, {
    body: patch,
    headers: COLLECTION_HEADERS,
  })) as { task: CollectionTask };
}
