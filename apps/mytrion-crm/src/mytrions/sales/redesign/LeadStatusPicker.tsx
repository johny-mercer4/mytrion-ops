/**
 * Shared Lead status picker — a colored, icon-tagged radio grid used by BOTH the post-call wizard
 * and the Lead modal's manual editor. `options` is the blueprint-allowed set (see `allowedStatuses`),
 * so the two surfaces present exactly the same flow. Per-status color + icon come from `statusMeta`.
 */
import { s } from './dc';
import { Icon } from './icons';
import { statusMeta } from './leadStatusFlow';

export function LeadStatusPicker({
  options,
  value,
  onChange,
  ariaLabel = 'Lead status',
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div style={s('display:grid;grid-template-columns:repeat(2,1fr);gap:8px')} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = value === o.value;
        const { color, icon } = statusMeta(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={s(
              `display:flex;align-items:center;gap:9px;text-align:left;padding:10px 12px;border-radius:var(--radius-md);` +
                `border:1px solid ${active ? color : 'var(--border)'};` +
                `background:${active ? `color-mix(in srgb, ${color} 13%, var(--alt))` : 'var(--alt)'};` +
                `color:${active ? color : 'var(--text)'};font-size:12.5px;font-weight:700;cursor:pointer;transition:all .14s`,
            )}
          >
            <span style={s(`display:flex;flex-shrink:0;color:${color}`)}>
              <Icon name={icon} size={15} />
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
