/**
 * EFS Console — the two dispatchers. Every read and every write in the console goes through one
 * of these functions, so the gate, the window rule, the redaction, the error mapping and the audit
 * key are stated once each.
 *
 * ERROR MAPPING. There are five different ServerCrmHttpError→client mappings in this repo already.
 * This module uses the shared-wrapper one (4xx passes through, everything else 502), NOT
 * financeEfs's (which collapses 404 into 502 and would turn "no such carrier at EFS" into "the
 * integration is down"). One addition: servercrm's own 403 means ITS write gate
 * (EFS_TOUCHPOINTS_WRITES_ENABLED) is off, which is a second switch we do not control, so it is
 * surfaced as a specific 409 rather than a generic rejection.
 *
 * PARTIAL SUCCESS IS NORMAL. EFS routinely answers 200 with one leg failed —
 * `parent/snapshot` returns `creditLimitsError: "ADBException: Unexpected subelement
 * getCreditLimits"` alongside a perfectly good balance, and `carrier/snapshot` has `cardDetailError`.
 * Those fields are passed through untouched so the UI can show a per-section warning chip; they
 * must never be promoted into a thrown error, or a working balance disappears behind a card bug.
 */
import { serverCrm, ServerCrmHttpError } from '../../../integrations/serverCrm.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';
import type { EfsAction, EfsFetcher } from './types.js';
import { resolveEfsWindow } from './window.js';

const CONSOLE_BASE = '/api/efs/console';

/** Statuses that mean "servercrm understood and refused" — pass them to the caller verbatim. */
const PASSTHROUGH = new Set([400, 404, 409, 422]);

function upstreamMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const msg = parsed['message'] ?? parsed['error'];
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return bodyText.slice(0, 200) || 'servercrm rejected the request';
}

function mapError(err: unknown, what: string): AppError {
  if (err instanceof ServerCrmHttpError) {
    if (err.status === 403) {
      return new ConflictError(
        'servercrm has EFS writes disabled (EFS_TOUCHPOINTS_WRITES_ENABLED=false). That switch is not ours to flip.',
      );
    }
    if (PASSTHROUGH.has(err.status)) {
      return new AppError(upstreamMessage(err.bodyText), {
        statusCode: err.status,
        code: 'EFS_REJECTED',
        expose: true,
        cause: err,
      });
    }
  }
  return new AppError(`EFS ${what} failed`, { statusCode: 502, code: 'EFS_UNAVAILABLE', expose: true, cause: err });
}

/** Substitute `:param` placeholders, rejecting anything that is not a safe path segment. */
function buildPath(template: string, params: Record<string, string>): string {
  return template.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') {
      throw new ValidationError(`missing path parameter: ${name}`);
    }
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
      throw new ValidationError(`invalid path parameter ${name}: ${value}`);
    }
    return encodeURIComponent(value);
  });
}

export interface FetcherInput {
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  body?: unknown;
}

export interface FetcherResult {
  key: string;
  window: { from: string; to: string; days: number } | null;
  fetchedAt: string;
  payload: unknown;
}

/** Run one catalogued read. */
export async function runFetcher(fetcher: EfsFetcher, input: FetcherInput): Promise<FetcherResult> {
  if (fetcher.health === 'broken') {
    // Refuse loudly and specifically rather than letting an operator watch a spinner end in a 502.
    throw new AppError(fetcher.brokenReason ?? 'This EFS endpoint is broken upstream.', {
      statusCode: 503,
      code: 'EFS_ENDPOINT_BROKEN',
      expose: true,
    });
  }

  const window = resolveEfsWindow(fetcher.window, { from: input.query['from'], to: input.query['to'] });
  const path = `${CONSOLE_BASE}/fetchers${buildPath(fetcher.path, input.params)}`;

  // Allow-list the query so a typo'd filter 400s upstream rather than being silently dropped and
  // answered with an unfiltered result set.
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const name of fetcher.query ?? []) {
    const value = input.query[name];
    if (value !== undefined && value !== '') query[name] = value;
  }
  if (window) {
    query['from'] = window.from;
    query['to'] = window.to;
  }

  let payload: unknown;
  try {
    if (fetcher.method === 'POST') {
      const parsed = fetcher.bodySchema ? fetcher.bodySchema.parse(input.body ?? {}) : (input.body ?? {});
      payload = await serverCrm.post(path, parsed);
    } else {
      payload = await serverCrm.get(path, query);
    }
  } catch (err) {
    throw mapError(err, fetcher.key);
  }

  return {
    key: fetcher.key,
    window,
    fetchedAt: new Date().toISOString(),
    payload: fetcher.redact ? fetcher.redact(payload) : payload,
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────

export type WriteMode = 'disabled' | 'armed';

export interface WritePosture {
  mode: WriteMode;
  /** Per-action allowlist. Arming happens one key at a time, never as a single boolean cliff. */
  liveActions: readonly string[];
}

/**
 * The console's own write gate, read from env on every call so flipping it does not need a deploy
 * to be *reasoned* about (it still needs a restart to take effect — env is parsed at boot).
 *
 * Two flags, deliberately:
 *   FF_MANAGER_EFS_WRITES_ENABLED  the master switch. Off ⇒ nothing is ever sent.
 *   MANAGER_EFS_LIVE_ACTIONS       a comma-separated allowlist of action keys. Empty ⇒ none live,
 *                                  even with the master switch on.
 *
 * So arming is: turn the master on, then add one key. A single boolean would arm ~30 untested
 * money-moving calls at once.
 */
export function writePosture(): WritePosture {
  const enabled = env.FF_MANAGER_EFS_WRITES_ENABLED === true;
  const live = (env.MANAGER_EFS_LIVE_ACTIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { mode: enabled ? 'armed' : 'disabled', liveActions: enabled ? live : [] };
}

export function isActionLive(action: EfsAction, posture: WritePosture = writePosture()): boolean {
  return posture.mode === 'armed' && posture.liveActions.includes(action.key);
}

export interface ActionPreview {
  key: string;
  label: string;
  effect: string;
  riskClass: EfsAction['riskClass'];
  checks: readonly string[];
  /** The exact body that WOULD be sent, after validation. */
  wouldSend: unknown;
  /** Vendor path that WOULD be called. */
  wouldCall: string;
  executed: false;
  reason: 'writes_disabled' | 'action_not_live';
}

/**
 * Validate an action and return what would happen, WITHOUT calling servercrm.
 *
 * This is the whole write surface today. It is genuinely useful before arming: it proves the
 * payload passes our schema, shows the operator the exact body and vendor path, and writes an
 * audit row — so the record of "what we would have sent" exists before anything is sent.
 */
export function previewAction(action: EfsAction, body: unknown, posture: WritePosture): ActionPreview {
  const parsed = action.schema.parse(body ?? {});
  return {
    key: action.key,
    label: action.label,
    effect: action.effect,
    riskClass: action.riskClass,
    checks: action.checks ?? [],
    wouldSend: parsed,
    wouldCall: `POST ${CONSOLE_BASE}/actions${action.path}`,
    executed: false,
    reason: posture.mode === 'disabled' ? 'writes_disabled' : 'action_not_live',
  };
}

/**
 * Execute an armed action. Not reachable while `FF_MANAGER_EFS_WRITES_ENABLED` is off — the route
 * calls `previewAction` instead. Present so the arming phase is a flag flip plus a UI surface
 * rather than a new code path written under time pressure.
 */
export async function executeAction(action: EfsAction, body: unknown): Promise<unknown> {
  const parsed = action.schema.parse(body ?? {});
  try {
    return await serverCrm.post(`${CONSOLE_BASE}/actions${action.path}`, parsed);
  } catch (err) {
    throw mapError(err, action.key);
  }
}

/** Thrown when a carrier is not one of ours. Exported so the route can map it once. */
export function carrierNotAClient(carrierId: string): NotFoundError {
  return new NotFoundError(
    `Carrier ${carrierId} is not an Octane client (no octane.dim_company row). The EFS Console only opens carriers we hold in the warehouse.`,
  );
}
