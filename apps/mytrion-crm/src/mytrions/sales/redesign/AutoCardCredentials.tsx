import { callTouchpoint } from '@/api/touchpoints';
import type { CardEfsInfoResult } from '@/api/touchpointTypes';
import { Badge, s } from './dc';
import { Icon, type IconName } from './icons';
import { useLoad } from './live';
import { cardStatusBadge } from './AutoPicklist';
import { AUTO_PENDING_PILL } from './autoControls';

const CREDENTIAL_ACTIONS = new Set(['card-activation', 'card-deactivation', 'unit-driver']);

export interface CardCredentials {
  status: string;
  unitNumber: string;
  driverId: string;
  driverName: string;
}

export function mapCardCredentials(result: CardEfsInfoResult): CardCredentials {
  return {
    status: String(result.status ?? '').trim(),
    unitNumber: String(result.unit_number ?? '').trim(),
    driverId: String(result.driver_id ?? '').trim(),
    driverName: String(result.driver_name ?? '').trim(),
  };
}

export function useCardCredentials(
  actionId: string | undefined,
  carrierId: string | undefined,
  cardNumber: string | undefined,
) {
  const required = CREDENTIAL_ACTIONS.has(actionId ?? '');
  const normalizedCarrier = carrierId?.trim() ?? '';
  const normalizedCard = cardNumber?.trim() ?? '';
  const load = useLoad<CardCredentials | null>(
    async () => {
      if (!required || !normalizedCarrier || !normalizedCard) return null;
      const result = await callTouchpoint('dwh.card_efs', {
        carrierId: normalizedCarrier,
        cardNumber: normalizedCard,
      });
      if (result.efs_error) {
        throw new Error(`EFS could not verify this card: ${result.efs_error}`);
      }
      return mapCardCredentials(result);
    },
    [required, normalizedCarrier, normalizedCard],
  );
  return { required, ...load };
}

function Credential({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <div style={s('min-width:0;padding:10px 11px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border2)')}>
      <div style={s('display:flex;align-items:center;gap:6px;color:var(--muted);font-size:var(--ss-text-badge);font-weight:800;text-transform:uppercase;letter-spacing:.06em')}>
        <Icon name={icon} size={13} />
        {label}
      </div>
      <div title={value || 'Not set'} style={s('margin-top:5px;color:var(--text);font-size:var(--ss-text-xs);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
        {value || 'Not set'}
      </div>
    </div>
  );
}

export function AutoCardCredentialsPanel({
  loading,
  error,
  credentials,
}: {
  loading: boolean;
  error: string | null;
  credentials: CardCredentials | null;
}) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" style={s(AUTO_PENDING_PILL)}>
        <Icon name="spinner" size={16} className="ss-spin" />
        Reading current card credentials directly from EFS…
      </div>
    );
  }
  if (error || !credentials) {
    return (
      <div role="alert" style={s('display:flex;align-items:flex-start;gap:9px;padding:14px 15px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--danger) 10%,transparent);border:1px solid color-mix(in srgb,var(--danger) 30%,transparent);color:var(--danger);font-size:var(--ss-text-xs);line-height:1.45')}>
        <Icon name="alert" size={17} />
        <span>{error || 'Current EFS card credentials are unavailable. The action is disabled.'}</span>
      </div>
    );
  }
  return (
    <section aria-label="Current EFS card credentials" style={s('padding:14px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 6%,var(--alt));border:1px solid color-mix(in srgb,var(--accent) 24%,var(--border))')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px')}>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          <Icon name="card" size={17} color="var(--accent)" />
          <strong style={s('font-size:var(--ss-text-xs);color:var(--text)')}>Current EFS credentials</strong>
        </div>
        <Badge vm={cardStatusBadge(credentials.status)} />
      </div>
      <div style={s('display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px')}>
        <Credential icon="user" label="Driver Name" value={credentials.driverName} />
        <Credential icon="key" label="Driver ID" value={credentials.driverId} />
        <Credential icon="fuel" label="Unit Number" value={credentials.unitNumber} />
      </div>
    </section>
  );
}
