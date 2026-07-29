import { serverCrmGet } from '../../integrations/serverCrm.js';
import { AppError } from '../../lib/errors.js';

export interface WexApplicationSnapshot {
  appId?: string | number;
  found?: boolean;
  status?: string | null;
  statusGroup?: string | null;
  application?: {
    stage?: string | null;
    [key: string]: unknown;
  } | null;
}

export interface WexApplicationEligibility {
  allowed: boolean;
  reason: string | null;
  status: string;
  statusGroup: string;
  stage: string;
}

function normalize(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

/**
 * WEX maps Closed/Lost, Closed/Fraud and Disqualified into the Closed group,
 * and Cards Produced into "Carrier ID out, Cards Sent". Check both the raw
 * status and mapped group so a mapping change cannot accidentally open a gate.
 */
export function evaluateWexApplicationEligibility(
  snapshot: WexApplicationSnapshot,
): WexApplicationEligibility {
  const status = typeof snapshot.status === 'string' ? snapshot.status.trim() : '';
  const statusGroup = typeof snapshot.statusGroup === 'string' ? snapshot.statusGroup.trim() : '';
  const stage = typeof snapshot.application?.stage === 'string'
    ? snapshot.application.stage.trim()
    : '';
  const normalizedStatus = normalize(status);
  const normalizedGroup = normalize(statusGroup);
  const normalizedStage = normalize(stage);
  const base = { status, statusGroup, stage };

  if (snapshot.found !== true) {
    return { allowed: false, reason: 'The application was not found in WEX.', ...base };
  }
  if (normalizedStage.includes('expansion')) {
    return {
      allowed: false,
      reason: 'This action is unavailable for Expansion-stage applications.',
      ...base,
    };
  }
  if (
    normalizedStatus.includes('cards produced')
    || normalizedStatus.includes('cards sent')
    || normalizedGroup.includes('cards sent')
    || normalizedGroup.includes('carrier id out cards sent')
  ) {
    return {
      allowed: false,
      reason: 'This action is unavailable because cards have already been sent.',
      ...base,
    };
  }
  if (
    normalizedStatus.includes('closed')
    || normalizedStatus.includes('lost')
    || normalizedStatus.includes('disqualified')
    || normalizedGroup.includes('closed')
    || normalizedGroup.includes('lost')
  ) {
    return {
      allowed: false,
      reason: 'This action is unavailable because the application is Closed/Lost.',
      ...base,
    };
  }
  if (!normalizedStatus && !normalizedGroup) {
    return {
      allowed: false,
      reason: 'The current WEX application status is unavailable.',
      ...base,
    };
  }
  return { allowed: true, reason: null, ...base };
}

/**
 * Fetches the live WEX Salesforce record through servercrm. This deliberately
 * does not call Zoho: WEX is the source of truth and the action must fail closed
 * if its current state cannot be verified.
 */
export async function assertWexApplicationActionAllowed(
  appId: string,
  actionLabel: string,
): Promise<WexApplicationEligibility> {
  let snapshot: WexApplicationSnapshot;
  try {
    snapshot = await serverCrmGet<WexApplicationSnapshot>(
      `/api/wex/application/${encodeURIComponent(appId)}`,
    );
  } catch {
    throw new AppError(
      `Could not verify the current WEX application status. ${actionLabel} was not started.`,
      {
        statusCode: 409,
        code: 'WEX_STATUS_UNVERIFIED',
        details: { appId },
        expose: true,
      },
    );
  }

  const eligibility = evaluateWexApplicationEligibility(snapshot);
  if (!eligibility.allowed) {
    throw new AppError(`${eligibility.reason} ${actionLabel} was not started.`, {
      statusCode: 409,
      code: 'WEX_APPLICATION_INELIGIBLE',
      details: { appId, ...eligibility },
      expose: true,
    });
  }
  return eligibility;
}
