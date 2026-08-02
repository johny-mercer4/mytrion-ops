/**
 * Pipeline provider seam. The Sales Verification tab reads a PipelineSnapshot through this
 * interface. The production provider reads the credit_platform replica (read-only) by the direct
 * agent_deals.id → requests.request_id key, with carrier/application/DOT fallbacks. The mock remains
 * as a configuration-safe local fallback.
 */
import { verificationDb } from '../../integrations/verificationDb.js';
import { extractSalesRequirements, type RequirementEventInput } from './requirements.js';
import {
  STAGE_CATALOG,
  type PipelineDecision,
  type PipelineSnapshot,
  type PipelineStage,
  type PipelineStageStatus,
  normalizeStageStatus,
} from './types.js';

export interface PipelineKey {
  dealId?: string | null;
  carrierId?: string | null;
  applicationId?: string | null;
  dot?: string | null;
}

export interface PipelineProvider {
  /** Returns the pipeline snapshot for a client, or null when no verification record exists. */
  getPipeline(key: PipelineKey): Promise<PipelineSnapshot | null>;
}

interface RequestRow {
  request_id: string;
  status: string | null;
  result: Record<string, unknown> | null;
  manual_review_form: Record<string, unknown>;
  manual_review_resolution: Record<string, unknown>;
  updated_at: Date | string | null;
}

interface EventRow {
  id: number;
  request_id: string;
  stage: string;
  service_id: string | null;
  status: string | null;
  title: string;
  payload: Record<string, unknown> | null;
  created_at: Date | string | null;
}

interface AttachmentRow {
  id: number;
  file_name: string;
  content_type: string;
  byte_size: number;
  scope: string;
  created_at: Date | string | null;
}

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const txt = (value: unknown): string => (value == null ? '' : String(value).trim());
const num = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const iso = (value: Date | string | null): string | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function canonicalStage(value: string | null): string {
  const stage = txt(value).toLowerCase().replace(/_/g, '-');
  if (stage.startsWith('isoftpull')) return 'isoftpull';
  if (stage === 'stop-factor-pre' || stage === 'stop-factor-after') return stage;
  return stage;
}

function eventStage(event: EventRow): string {
  const service = canonicalStage(event.service_id);
  if (service) return service;
  return canonicalStage(event.stage);
}

function eventStatus(event: EventRow): PipelineStageStatus {
  const payloadStatus = txt(event.payload?.step_status);
  return normalizeStageStatus(payloadStatus || event.status);
}

function stageDetail(event: EventRow | undefined): string | undefined {
  if (!event) return undefined;
  const payload = event.payload ?? {};
  const detail = txt(payload.detail) || txt(payload.reason) || txt(payload.step_status);
  return detail ? detail.slice(0, 180) : undefined;
}

function resolveDecision(row: RequestRow): PipelineDecision {
  const resolution = rec(row.manual_review_resolution);
  const form = rec(row.manual_review_form);
  const result = rec(row.result);
  const summary = rec(result.summary);
  const raw = (
    txt(resolution.decision) ||
    txt(form.decision) ||
    txt(summary.decision) ||
    txt(result.decision) ||
    txt(row.status)
  ).toUpperCase();
  const reason =
    txt(resolution.reason) || txt(form.decision_reason) || txt(summary.reason) || txt(result.reason);
  if (/REJECT|DECLIN|DENIED|FAILED/.test(raw)) {
    return { outcome: 'rejected', ...(reason ? { reason } : {}) };
  }
  if (/APPROV|COMPLETED|PREPAID|LOC/.test(raw)) {
    const paymentType = txt(resolution.payment_type) || txt(form.payment_type) || txt(summary.payment_type);
    if (/prepay/i.test(paymentType) || /PREPAID/.test(raw)) {
      return { outcome: 'prepaid', reason: reason || 'Approved for prepaid' };
    }
    const providers = rec(form.providers);
    const credit = rec(providers.isoftpull);
    const approvedLimit = num(
      resolution.approved_limit ?? form.approved_limit ?? form.weekly_limit ?? summary.approved_limit,
    );
    const creditScore = num(credit.credit_score ?? summary.credit_score);
    const billingCycle = txt(resolution.billing_cycle ?? form.billing_cycle ?? summary.billing_cycle);
    return {
      outcome: 'loc',
      ...(approvedLimit !== undefined ? { approvedLimit } : {}),
      ...(creditScore !== undefined ? { creditScore } : {}),
      ...(billingCycle ? { billingCycle } : {}),
      ...(reason ? { reason } : {}),
    };
  }
  return { outcome: 'undecided', reason: txt(row.status) || 'Pipeline in progress' };
}

async function findRequest(key: PipelineKey): Promise<RequestRow | null> {
  const dealId = txt(key.dealId) || null;
  const carrierId = txt(key.carrierId) || null;
  const applicationId = txt(key.applicationId) || null;
  const dot = txt(key.dot) || null;
  if (!dealId && !carrierId && !applicationId && !dot) return null;
  const rows = await verificationDb.query<RequestRow>(
    `select request_id, status, result, manual_review_form, manual_review_resolution, updated_at
       from requests
      where ($1::text is not null and request_id = $1)
         or ($2::text is not null and carrier_id = $2)
         or ($3::text is not null and (
               payload->>'zoho_application_id' = $3
               or payload->'zoho_raw'->>'Application_ID' = $3
             ))
         or ($4::text is not null and (
               payload->>'dot_number' = $4
               or payload->'zoho_raw'->>'DOT' = $4
             ))
      order by case when request_id = $1 then 0 else 1 end, updated_at desc nulls last
      limit 1`,
    [dealId, carrierId, applicationId, dot],
  );
  return rows[0] ?? null;
}

/** Live, read-only snapshot with safe event/attachment metadata only (never raw reports or PII). */
export const creditPlatformPipelineProvider: PipelineProvider = {
  async getPipeline(key: PipelineKey): Promise<PipelineSnapshot | null> {
    const request = await findRequest(key);
    if (!request) return null;
    const [events, attachments] = await Promise.all([
      verificationDb.query<EventRow>(
        `select id, request_id, stage, service_id, status, title, payload, created_at
           from request_tracker_events where request_id = $1 order by id desc limit 200`,
        [request.request_id],
      ),
      verificationDb.query<AttachmentRow>(
        `select id, file_name, content_type, byte_size, scope, created_at
           from file_attachments
          where request_id = $1 or linked_entity_id = $1
          order by id desc limit 50`,
        [request.request_id],
      ),
    ]);
    const stages: PipelineStage[] = STAGE_CATALOG.map((stage) => {
      const event = events.find((candidate) => eventStage(candidate) === stage.id);
      const detail = stageDetail(event);
      return {
        ...stage,
        status: event ? eventStatus(event) : 'not_started',
        ...(detail ? { detail } : {}),
      };
    });
    const requirementEvents: RequirementEventInput[] = events.map((event) => ({
      id: event.id,
      status: event.status,
      title: event.title,
      payload: event.payload,
      createdAt: iso(event.created_at) ?? '',
    }));
    return {
      requestId: request.request_id,
      status: txt(request.status) || 'UNKNOWN',
      updatedAt: iso(request.updated_at),
      stages,
      decision: resolveDecision(request),
      requirements: extractSalesRequirements(requirementEvents),
      events: events.slice(0, 30).map((event) => ({
        id: String(event.id),
        stage: event.stage,
        status: event.status,
        title: event.title,
        createdAt: iso(event.created_at) ?? '',
      })),
      attachments: attachments.map((attachment) => ({
        id: String(attachment.id),
        fileName: attachment.file_name,
        contentType: attachment.content_type,
        byteSize: Number(attachment.byte_size) || 0,
        scope: attachment.scope,
        createdAt: iso(attachment.created_at) ?? '',
      })),
      source: 'credit_platform',
    };
  },
};

export interface LiveVerificationSummary {
  status: string;
  updatedAt: string | null;
  requirementEventIds: string[];
}

/** One bulk read for card-level red flags; avoids an N+1 pipeline request per agent_deals card. */
export async function getLiveVerificationSummaries(
  dealIds: string[],
): Promise<Map<string, LiveVerificationSummary>> {
  const ids = [...new Set(dealIds.map(txt).filter(Boolean))].slice(0, 1000);
  const summaries = new Map<string, LiveVerificationSummary>();
  if (!verificationDb.isConfigured() || ids.length === 0) return summaries;
  const [requests, events] = await Promise.all([
    verificationDb.query<{ request_id: string; status: string | null; updated_at: Date | string | null }>(
      `select request_id, status, updated_at from requests where request_id = any($1::text[])`,
      [ids],
    ),
    verificationDb.query<EventRow>(
      `select id, request_id, stage, service_id, status, title, payload, created_at
         from request_tracker_events
        where request_id = any($1::text[])
        order by id desc limit 5000`,
      [ids],
    ),
  ]);
  const eventsByRequest = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = eventsByRequest.get(event.request_id) ?? [];
    list.push(event);
    eventsByRequest.set(event.request_id, list);
  }
  for (const request of requests) {
    const requirementEvents: RequirementEventInput[] = (eventsByRequest.get(request.request_id) ?? []).map(
      (event) => ({
        id: event.id,
        status: event.status,
        title: event.title,
        payload: event.payload,
        createdAt: iso(event.created_at) ?? '',
      }),
    );
    summaries.set(request.request_id, {
      status: txt(request.status) || 'UNKNOWN',
      updatedAt: iso(request.updated_at),
      requirementEventIds: extractSalesRequirements(requirementEvents).map((item) => item.eventId),
    });
  }
  return summaries;
}

/** Small deterministic PRNG (mulberry32) seeded from the client key — stable state per client. */
function seededRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic mock: derives a realistic pipeline from the client key. A "progress" value places
 * the client somewhere along the 9 stages; stages before it are resolved (mostly done, some
 * skipped, occasionally failed), the current stage is pending, later stages are not_started. The
 * final decision is coherent with progress (fully-through → LOC/Prepaid/rejected; mid → undecided).
 */
export const mockPipelineProvider: PipelineProvider = {
  async getPipeline(key: PipelineKey): Promise<PipelineSnapshot | null> {
    const seed = String(key.dealId ?? key.carrierId ?? key.applicationId ?? key.dot ?? '').trim();
    if (!seed) return null;
    const rng = seededRng(`vp:${seed}`);

    const total = STAGE_CATALOG.length; // 9
    // progressIdx = how many stages are resolved (0..total). Bias toward mid/late so the UI is lively.
    const progressIdx = Math.floor(rng() * (total + 1));

    const stages: PipelineStage[] = STAGE_CATALOG.map((def) => {
      let status: PipelineStageStatus;
      if (def.order <= progressIdx) {
        const r = rng();
        status = r < 0.12 ? 'failed' : r < 0.24 ? 'skipped' : 'done';
      } else if (def.order === progressIdx + 1) {
        status = 'pending';
      } else {
        status = 'not_started';
      }
      const stage: PipelineStage = { id: def.id, order: def.order, label: def.label, status };
      // Illustrative per-stage detail for resolved stages (mock values).
      if (status !== 'not_started' && status !== 'pending') {
        if (def.id === 'isoftpull' && status === 'done') stage.detail = `Score ${580 + Math.floor(rng() * 240)}`;
        else if (def.id === 'blacklist') stage.detail = status === 'done' ? 'No match' : `${Math.floor(rng() * 3)} match(es)`;
        else if (def.id === 'antifraud') stage.detail = ['Low', 'Medium', 'High'][Math.floor(rng() * 3)] + ' risk';
        else if (def.id === 'crosscheck' && status === 'done') stage.detail = 'Consistent';
      }
      return stage;
    });

    const complete = progressIdx >= total;
    const anyFailed = stages.some((s) => s.status === 'failed');
    let decision: PipelineDecision;
    if (!complete) {
      decision = { outcome: 'undecided', reason: 'Pipeline in progress' };
    } else if (anyFailed || rng() < 0.2) {
      decision = { outcome: 'rejected', reason: 'Did not pass compliance checks' };
    } else if (rng() < 0.55) {
      const score = 600 + Math.floor(rng() * 220);
      decision = {
        outcome: 'loc',
        creditScore: score,
        approvedLimit: (5 + Math.floor(rng() * 45)) * 1000,
        billingCycle: rng() < 0.5 ? 'Weekly' : 'Bi-Weekly',
      };
    } else {
      decision = { outcome: 'prepaid', reason: 'Approved for prepaid' };
    }

    return {
      requestId: seed,
      status: decision.outcome === 'undecided' ? 'IN_PROGRESS' : 'COMPLETED',
      updatedAt: null,
      stages,
      decision,
      requirements: [],
      events: [],
      attachments: [],
      source: 'mock',
    };
  },
};

/**
 * Select live whenever the replica is configured. Local/test environments without credentials keep
 * the deterministic mock so the frontend remains developable without external network access.
 */
export function getPipelineProvider(): PipelineProvider {
  return verificationDb.isConfigured() ? creditPlatformPipelineProvider : mockPipelineProvider;
}
