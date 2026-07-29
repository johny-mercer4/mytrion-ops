import { callTouchpoint } from '@/api/touchpoints';
import type { WexApplicationResult } from '@/api/touchpointTypes';
import { Badge, s } from './dc';
import { Icon } from './icons';
import { useLoad } from './live';
import { badge } from './salesData';
import { str } from './autoLive';

const GUARDED_ACTIONS = new Set(['boca-boe-link', 'close-app', 'wex-tasks']);

export interface WexActionContext {
  allowed: boolean;
  reason: string | null;
  ownerName: string;
  status: string;
  statusGroup: string;
  stage: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Mirrors the backend gate for immediate feedback; the server remains authoritative. */
export function evaluateWexActionContext(res: WexApplicationResult): WexActionContext {
  const app = (res.application ?? {}) as Record<string, unknown>;
  const status = str(res.status).trim();
  const statusGroup = str(res.statusGroup).trim();
  const stage = str(app.stage ?? app.Application_Stage__c ?? app.Stage).trim();
  const ownerName = str(app.ownerName ?? app['Owner.Name']).trim();
  const normalizedStatus = normalize(status);
  const normalizedGroup = normalize(statusGroup);
  const normalizedStage = normalize(stage);
  const base = { ownerName, status, statusGroup, stage };

  if (res.found !== true) {
    return { allowed: false, reason: 'Application not found in WEX.', ...base };
  }
  if (normalizedStage.includes('expansion')) {
    return { allowed: false, reason: 'Expansion-stage applications cannot run this action.', ...base };
  }
  if (
    normalizedStatus.includes('cards produced')
    || normalizedStatus.includes('cards sent')
    || normalizedGroup.includes('cards sent')
  ) {
    return { allowed: false, reason: 'Cards have already been sent for this application.', ...base };
  }
  if (
    normalizedStatus.includes('closed')
    || normalizedStatus.includes('lost')
    || normalizedStatus.includes('disqualified')
    || normalizedGroup.includes('closed')
    || normalizedGroup.includes('lost')
  ) {
    return { allowed: false, reason: 'This application is already Closed/Lost.', ...base };
  }
  if (!normalizedStatus && !normalizedGroup) {
    return { allowed: false, reason: 'The current WEX status is unavailable.', ...base };
  }
  return { allowed: true, reason: null, ...base };
}

export function useWexActionContext(actionId: string | undefined, appId: string | undefined) {
  const required = GUARDED_ACTIONS.has(actionId ?? '');
  const normalizedAppId = appId?.trim() === '—' ? '' : appId?.trim() ?? '';
  const load = useLoad<WexActionContext | null>(
    async () => {
      if (!required || !normalizedAppId) return null;
      return evaluateWexActionContext(
        await callTouchpoint('wex.application', { appId: normalizedAppId }),
      );
    },
    [required, normalizedAppId],
  );
  return { required, ...load };
}

export function AutoWexEligibilityNotice({
  loading,
  error,
  context,
}: {
  loading: boolean;
  error: string | null;
  context: WexActionContext | null;
}) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" style={s('display:flex;align-items:center;gap:10px;padding:13px 15px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-size:13px')}>
        <Icon name="spinner" size={16} className="ss-spin" />
        Checking current WEX status…
      </div>
    );
  }

  const blocked = Boolean(error || !context?.allowed);
  const message = error
    ? `WEX status could not be verified: ${error}`
    : context?.reason ?? 'Current WEX status verified — this action is eligible.';
  const color = blocked ? 'var(--danger)' : 'var(--ok)';
  return (
    <div
      role={blocked ? 'alert' : 'status'}
      style={s(`padding:13px 15px;border-radius:var(--radius-md);background:color-mix(in srgb,${color} 10%,transparent);border:1px solid color-mix(in srgb,${color} 30%,transparent);color:var(--text2);font-size:13px;line-height:1.45`)}
    >
      <div style={s('display:flex;align-items:center;gap:9px')}>
        <Icon name={blocked ? 'ban' : 'checkCircle'} size={17} color={color} />
        <strong style={s(`color:${color}`)}>{blocked ? 'Action blocked' : 'WEX verified'}</strong>
      </div>
      <div style={s('margin-top:6px')}>{message}</div>
      {context && (
        <div style={s('display:flex;gap:6px;flex-wrap:wrap;margin-top:9px')}>
          {context.status && <Badge vm={badge(context.status, blocked ? 'var(--danger)' : 'var(--ok)')} />}
          {context.stage && <Badge vm={badge(`Stage: ${context.stage}`, 'var(--accent)')} />}
        </div>
      )}
    </div>
  );
}
