import type { LoyaltyClientOverride } from '../../../api/loyalty';
import { s } from './dc';
import { Icon } from './icons';

export function ManagerLoyaltyBadge() {
  return (
    <div style={s('display:flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;color:var(--violet);margin-top:4px')}>
      <Icon name="gear" size={10} /> Manager loyalty controls
    </div>
  );
}

function updatedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Updated by Manager'
    : `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Read-only disclosure of the Manager-owned controls applied to this Sales client. */
export function LoyaltyOverrideNotice({ override }: { override: LoyaltyClientOverride | null }) {
  if (!override) return null;
  const rewardState =
    override.enabledRewardIds === null
      ? 'Tier-default rewards'
      : override.enabledRewardIds.length === 0
        ? 'All rewards disabled'
        : `${override.enabledRewardIds.length} custom rewards active`;

  return (
    <section
      role="status"
      style={s(
        'display:flex;gap:12px;padding:13px 14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--violet) 38%,var(--border2));background:color-mix(in srgb,var(--violet) 9%,var(--alt))',
      )}
    >
      <span style={s('width:32px;height:32px;flex:0 0 auto;display:grid;place-items:center;border-radius:10px;background:color-mix(in srgb,var(--violet) 16%,transparent);color:var(--violet)')}>
        <Icon name="gear" size={16} />
      </span>
      <div style={s('min-width:0;flex:1')}>
        <div style={s('display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px')}>
          <strong style={s('font-size:13px;color:var(--text)')}>Manager-controlled loyalty</strong>
          <span style={s('font-size:10.5px;color:var(--muted)')}>{updatedLabel(override.updatedAt)}</span>
        </div>
        <div style={s('font-size:12px;color:var(--text2);margin-top:3px')}>
          {rewardState} · {override.updatedBy}
        </div>
        {override.note ? (
          <p style={s('font-size:11.5px;line-height:1.45;color:var(--muted);margin:7px 0 0')}>
            {override.note}
          </p>
        ) : null}
      </div>
    </section>
  );
}
