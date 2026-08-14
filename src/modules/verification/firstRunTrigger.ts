/**
 * Mytrion owns WHEN first-run happens. Enqueues patch_payload then run_stage one stage at a time
 * (stop_factor_pre → blacklist → fmcsa). Human Run/Approve/Reset stay on HTTP — this path is
 * automation-only.
 */
import { logger } from '../../lib/logger.js';
import { errorMessage } from '../../lib/errors.js';
import { isWriteConfigured } from '../../integrations/creditPlatformWriteDb.js';
import {
  getInboxUpdate,
  insertPayloadPatch,
  insertRunStage,
  pickPresentPatch,
  waitForInboxSettled,
  type FirstRunStageId,
} from '../../integrations/creditPlatformInboxWrites.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { VerificationCase, VerificationFirstRunStep } from '../../db/schema/verification_cases.js';
import { verificationCaseRepo } from '../../repos/verificationCaseRepo.js';
import {
  decideFirstRunAction,
  type FirstRunPersisted,
  type InboxProbe,
} from './firstRunDecision.js';

export interface FirstRunResult {
  status: 'completed' | 'in_flight' | 'error' | 'skipped';
  step: VerificationFirstRunStep | null;
  inboxId: number | null;
  error: string | null;
  reason?: string;
}

export interface FirstRunPorts {
  insertPayloadPatch: typeof insertPayloadPatch;
  insertRunStage: typeof insertRunStage;
  getInboxUpdate: typeof getInboxUpdate;
  waitForInboxSettled: typeof waitForInboxSettled;
}

const defaultPorts: FirstRunPorts = {
  insertPayloadPatch,
  insertRunStage,
  getInboxUpdate,
  waitForInboxSettled,
};

function digits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export function firstRunPatchFromCase(row: VerificationCase): ReturnType<typeof pickPresentPatch> {
  return pickPresentPatch({
    dotNumber: row.carrierDot || row.dot,
    mcNumber: row.mc,
    carrierName: row.companyName,
    state: row.state,
  });
}

export function hasFirstRunIdentifiers(row: VerificationCase): boolean {
  return digits(row.carrierDot || row.dot).length >= 4 || digits(row.mc).length >= 4;
}

function persistedFromCase(row: VerificationCase): FirstRunPersisted {
  return {
    status: row.firstRunStatus ?? 'idle',
    step: row.firstRunStep ?? null,
    inboxId: row.firstRunInboxId ?? null,
    error: row.firstRunError ?? null,
  };
}

async function probeInbox(inboxId: number | null, ports: FirstRunPorts): Promise<{
  status: InboxProbe;
  error: string | null;
}> {
  if (inboxId == null) return { status: null, error: null };
  const row = await ports.getInboxUpdate(inboxId);
  if (!row) return { status: 'missing', error: `inbox row ${inboxId} disappeared` };
  if (row.status === 'applied') return { status: 'applied', error: null };
  if (row.status === 'error') return { status: 'error', error: row.error };
  return { status: 'pending', error: row.error };
}

async function enqueueStep(
  step: VerificationFirstRunStep,
  input: { requestId: string; agent: string; patch: Record<string, string> },
  ports: FirstRunPorts,
): Promise<{ id: number }> {
  if (step === 'patch') {
    return ports.insertPayloadPatch({
      requestId: input.requestId,
      agent: input.agent,
      changes: input.patch,
    });
  }
  return ports.insertRunStage({
    requestId: input.requestId,
    agent: input.agent,
    stageId: step as FirstRunStageId,
  });
}

export async function driveFirstRun(input: {
  requestId: string;
  agent: string;
  patch: Record<string, string>;
  state: FirstRunPersisted;
  save: (next: FirstRunPersisted) => Promise<void>;
  wait: boolean;
  retry?: boolean;
  ports?: Partial<FirstRunPorts>;
}): Promise<FirstRunResult> {
  const ports = { ...defaultPorts, ...input.ports };
  let state = input.state;
  let guard = 0;

  while (guard++ < 8) {
    const probe = await probeInbox(state.inboxId, ports);
    const action = decideFirstRunAction({
      state,
      inboxStatus: probe.status,
      inboxError: probe.error,
      ...(input.retry && guard === 1 ? { retry: true } : {}),
    });

    if (action.type === 'noop') {
      return {
        status: action.reason === 'in_flight_pending' ? 'in_flight' : action.reason,
        step: state.step,
        inboxId: state.inboxId,
        error: state.error,
        reason: action.reason,
      };
    }

    if (action.type === 'record_error') {
      state = { ...state, status: 'error', error: action.error };
      await input.save(state);
      return { status: 'error', step: state.step, inboxId: state.inboxId, error: action.error };
    }

    if (action.type === 'complete') {
      state = { status: 'completed', step: 'fmcsa', inboxId: state.inboxId, error: null };
      await input.save(state);
      return { status: 'completed', step: 'fmcsa', inboxId: state.inboxId, error: null };
    }

    const queued = await enqueueStep(action.step, input, ports);
    state = {
      status: 'in_flight',
      step: action.step,
      inboxId: queued.id,
      error: null,
    };
    await input.save(state);

    if (!input.wait) {
      return { status: 'in_flight', step: state.step, inboxId: state.inboxId, error: null };
    }

    const settled = await ports.waitForInboxSettled(queued.id);
    if (settled.status === 'timeout') {
      return {
        status: 'in_flight',
        step: state.step,
        inboxId: state.inboxId,
        error: settled.error ?? null,
        reason: 'poll_timeout',
      };
    }
    if (settled.status === 'error') {
      state = { ...state, status: 'error', error: settled.error ?? 'inbox row error' };
      await input.save(state);
      return { status: 'error', step: state.step, inboxId: state.inboxId, error: state.error };
    }
    // applied — loop to decide the next enqueue (never enqueue the next stage in the same tick
    // as this insert; the next iteration sees applied and then enqueues).
  }

  return {
    status: 'error',
    step: state.step,
    inboxId: state.inboxId,
    error: 'first-run exceeded step guard',
  };
}

export async function maybeAdvanceFirstRun(
  ctx: TenantContext,
  caseId: string,
  opts: { wait?: boolean; retry?: boolean; agent?: string; ports?: Partial<FirstRunPorts> } = {},
): Promise<FirstRunResult> {
  if (!isWriteConfigured()) {
    return { status: 'skipped', step: null, inboxId: null, error: null, reason: 'write_disabled' };
  }
  const row = await verificationCaseRepo.findById(ctx, caseId);
  if (!row) {
    return { status: 'skipped', step: null, inboxId: null, error: null, reason: 'missing_case' };
  }
  if (!row.requestId?.trim()) {
    return { status: 'skipped', step: null, inboxId: null, error: null, reason: 'unbound_request' };
  }
  if (!hasFirstRunIdentifiers(row)) {
    return { status: 'skipped', step: null, inboxId: null, error: null, reason: 'missing_dot_mc' };
  }

  const patch = firstRunPatchFromCase(row);
  if (!Object.keys(patch).length) {
    return { status: 'skipped', step: null, inboxId: null, error: null, reason: 'empty_patch' };
  }

  const agent = opts.agent?.trim() || 'system';
  let state = persistedFromCase(row);
  if (state.status === 'idle' || (state.status === 'error' && opts.retry)) {
    const claimed = await verificationCaseRepo.claimFirstRun(ctx, caseId, {
      ...(opts.retry ? { retry: true } : {}),
    });
    if (!claimed) {
      const latest = await verificationCaseRepo.findById(ctx, caseId);
      if (!latest) {
        return { status: 'skipped', step: null, inboxId: null, error: null, reason: 'missing_case' };
      }
      if (latest.firstRunStatus === 'completed') {
        return {
          status: 'completed',
          step: latest.firstRunStep ?? 'fmcsa',
          inboxId: latest.firstRunInboxId ?? null,
          error: null,
          reason: 'completed',
        };
      }
      if (latest.firstRunStatus === 'in_flight' && latest.firstRunInboxId == null) {
        return {
          status: 'in_flight',
          step: latest.firstRunStep ?? null,
          inboxId: null,
          error: null,
          reason: 'in_flight_pending',
        };
      }
      state = persistedFromCase(latest);
    } else {
      state = persistedFromCase(claimed);
    }
  }

  try {
    return await driveFirstRun({
      requestId: row.requestId,
      agent,
      patch: patch as Record<string, string>,
      state,
      wait: Boolean(opts.wait),
      ...(opts.retry ? { retry: true } : {}),
      ...(opts.ports ? { ports: opts.ports } : {}),
      save: async (next) => {
        await verificationCaseRepo.update(ctx, caseId, {
          firstRunStatus: next.status,
          firstRunStep: next.step,
          firstRunInboxId: next.inboxId,
          firstRunError: next.error,
        });
      },
    });
  } catch (err) {
    const message = errorMessage(err);
    logger.warn({ err: message, caseId }, 'verification first-run failed');
    await verificationCaseRepo.update(ctx, caseId, {
      firstRunStatus: 'error',
      firstRunError: message,
    });
    return { status: 'error', step: row.firstRunStep ?? null, inboxId: row.firstRunInboxId ?? null, error: message };
  }
}
