/**
 * Credit-platform inbox kinds Mytrion enqueues for first-run (patch_payload / run_stage).
 * INSERT-only into kxd.sales_agent_updates via the writable pool. The CP consumer does not yet
 * handle these kinds — we still enqueue so the other agent can wire it. Whitelist is enforced here
 * so a bad payload never lands in the inbox.
 */
import { writeQuery, isWriteConfigured } from './creditPlatformWriteDb.js';

export const PAYLOAD_PATCH_KEYS = ['dot_number', 'mc_number', 'carrier_name', 'state'] as const;
export type PayloadPatchKey = (typeof PAYLOAD_PATCH_KEYS)[number];

export const FIRST_RUN_STAGE_IDS = ['stop_factor_pre', 'blacklist', 'fmcsa'] as const;
export type FirstRunStageId = (typeof FIRST_RUN_STAGE_IDS)[number];

const BLOCKED_PATCH_KEYS = [
  'applicant_profile',
  'ssn',
  'ssn_encrypted',
  'iin_encrypted',
  'status',
  'external_applicant_id',
] as const;

const BILLABLE_STAGE_IDS = ['isoftpull', 'creditsafe', 'plaid_bs'] as const;

export class InboxWhitelistError extends Error {
  readonly code = 'INBOX_WHITELIST_REJECTED';
  readonly rejected: readonly string[];

  constructor(message: string, rejected: readonly string[]) {
    super(message);
    this.name = 'InboxWhitelistError';
    this.rejected = rejected;
  }
}

export function stampMytrionAgent(userOrSystem: string): string {
  const raw = userOrSystem.trim() || 'system';
  return raw.startsWith('mytrion:') ? raw : `mytrion:${raw}`;
}

function asTrimmedRecord(changes: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) out[key] = text;
  }
  return out;
}

export function assertPayloadPatch(changes: Record<string, unknown>): Record<PayloadPatchKey, string> {
  const trimmed = asTrimmedRecord(changes);
  const keys = Object.keys(trimmed);
  const blocked = keys.filter((key) =>
    (BLOCKED_PATCH_KEYS as readonly string[]).includes(key),
  );
  if (blocked.length) {
    throw new InboxWhitelistError(
      `patch_payload rejects ${blocked.join(', ')} — never send applicant/ssn/status fields`,
      blocked,
    );
  }
  const unknown = keys.filter((key) => !(PAYLOAD_PATCH_KEYS as readonly string[]).includes(key));
  if (unknown.length) {
    throw new InboxWhitelistError(
      `patch_payload rejects ${unknown.join(', ')} — allowed: ${PAYLOAD_PATCH_KEYS.join(', ')}`,
      unknown,
    );
  }
  if (!keys.length) {
    throw new InboxWhitelistError('patch_payload requires at least one whitelisted field', []);
  }
  return trimmed as Record<PayloadPatchKey, string>;
}

export function assertRunStageId(stageId: string): FirstRunStageId {
  const id = stageId.trim();
  if ((BILLABLE_STAGE_IDS as readonly string[]).includes(id)) {
    throw new InboxWhitelistError(
      `run_stage rejects ${id} — billable stages stay on authenticated HTTP`,
      [id],
    );
  }
  if (!(FIRST_RUN_STAGE_IDS as readonly string[]).includes(id)) {
    throw new InboxWhitelistError(
      `run_stage rejects ${id} — allowed: ${FIRST_RUN_STAGE_IDS.join(', ')}`,
      [id],
    );
  }
  return id as FirstRunStageId;
}

export function pickPresentPatch(fields: {
  dotNumber?: string | null;
  mcNumber?: string | null;
  carrierName?: string | null;
  state?: string | null;
}): Partial<Record<PayloadPatchKey, string>> {
  const changes: Partial<Record<PayloadPatchKey, string>> = {};
  const dot = fields.dotNumber?.trim();
  const mc = fields.mcNumber?.trim();
  const name = fields.carrierName?.trim();
  const state = fields.state?.trim();
  if (dot) changes.dot_number = dot;
  if (mc) changes.mc_number = mc;
  if (name) changes.carrier_name = name;
  if (state) changes.state = state;
  return changes;
}

async function insertInboxRow(input: {
  requestId: string;
  agent: string;
  kind: 'patch_payload' | 'run_stage';
  changes: Record<string, string>;
}): Promise<{ id: number }> {
  if (!isWriteConfigured()) {
    throw new Error('[credit-platform-write] write-back disabled — set VERIFICATION_WRITE_ENABLED=1');
  }
  const rows = await writeQuery<{ id: number }>(
    `INSERT INTO kxd.sales_agent_updates (request_id, agent, changes, kind)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id`,
    [input.requestId, stampMytrionAgent(input.agent), JSON.stringify(input.changes), input.kind],
  );
  const id = rows[0]?.id;
  if (id == null) throw new Error('[credit-platform-write] inbox insert returned no id');
  return { id };
}

export async function insertPayloadPatch(input: {
  requestId: string;
  agent: string;
  changes: Record<string, unknown>;
}): Promise<{ id: number }> {
  const changes = assertPayloadPatch(input.changes);
  return insertInboxRow({
    requestId: input.requestId,
    agent: input.agent,
    kind: 'patch_payload',
    changes,
  });
}

export async function insertRunStage(input: {
  requestId: string;
  agent: string;
  stageId: string;
}): Promise<{ id: number }> {
  const stageId = assertRunStageId(input.stageId);
  return insertInboxRow({
    requestId: input.requestId,
    agent: input.agent,
    kind: 'run_stage',
    changes: { stage_id: stageId },
  });
}

export type InboxUpdateStatus = 'pending' | 'claimed' | 'applied' | 'error' | string;

export async function getInboxUpdate(id: number): Promise<{
  status: InboxUpdateStatus;
  error: string | null;
} | null> {
  const rows = await writeQuery<{ status: string | null; error: string | null }>(
    `SELECT status, error FROM kxd.sales_agent_updates WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return { status: row.status ?? 'pending', error: row.error ?? null };
}

export async function waitForInboxSettled(
  id: number,
  opts: {
    intervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<{ status: 'applied' | 'error' | 'timeout'; error?: string }> {
  const intervalMs = opts.intervalMs ?? 750;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const row = await getInboxUpdate(id);
    if (!row) return { status: 'error', error: `inbox row ${id} disappeared` };
    if (row.status === 'applied') return { status: 'applied' };
    if (row.status === 'error') return { status: 'error', error: row.error ?? 'inbox row error' };
    await sleep(intervalMs);
  }
  return { status: 'timeout', error: `inbox row ${id} not applied (timeout)` };
}
