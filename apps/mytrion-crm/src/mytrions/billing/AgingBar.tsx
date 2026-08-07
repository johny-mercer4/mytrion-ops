/**
 * A proportional aging bar with a legend (TZ §9's AR aging: 0–7 / 8–14 / 15–30 / 30+).
 *
 * The worst bucket is distinguished by TEXTURE as well as colour — a diagonal hatch on 30+ — rather than
 * by inventing a fifth hue. Two reasons: the palette only has one danger colour, and a texture
 * difference survives colour-blindness, which a red/darker-red pair does not.
 *
 * Zero-amount buckets are dropped from the bar (a 0%-wide segment renders as a hairline artifact) but
 * KEPT in the legend, so "nothing is 30+ days overdue" is stated rather than inferred from an absence.
 */
import type { LedgerAgingBucket } from '../../api/ledgerTypes';
import { fmtMoney } from './ledgerModel';

const TONE_VAR: Record<LedgerAgingBucket['tone'], string> = {
  good: 'var(--success-text)',
  warn: 'var(--warning-text)',
  danger: 'var(--danger-text)',
  muted: 'var(--text-muted)',
};

export function AgingBar({
  buckets,
  total,
  label,
  compact = false,
}: {
  buckets: readonly LedgerAgingBucket[];
  total: number;
  label?: string;
  compact?: boolean;
}) {
  const sum = buckets.reduce((n, b) => n + Math.abs(b.amount), 0);
  const shown = buckets.filter((b) => Math.abs(b.amount) > 0.005);

  return (
    <div className={`lg-aging${compact ? ' lg-aging--compact' : ''}`}>
      {label ? (
        <div className="lg-aging-label">
          <span>{label}</span>
          <span className="lg-aging-total">{fmtMoney(total)}</span>
        </div>
      ) : null}

      <div
        className="lg-aging-bar"
        role="img"
        aria-label={
          shown.length
            ? shown.map((b) => `${b.label}: ${fmtMoney(b.amount)}`).join(', ')
            : 'Nothing outstanding'
        }
      >
        {sum <= 0 ? (
          <div className="lg-aging-seg lg-aging-seg--empty" style={{ width: '100%' }} />
        ) : (
          shown.map((b) => (
            <div
              key={b.key}
              className={`lg-aging-seg${b.key === 'd30_plus' ? ' lg-aging-seg--hatch' : ''}`}
              style={{
                width: `${(Math.abs(b.amount) / sum) * 100}%`,
                background: TONE_VAR[b.tone],
              }}
              title={`${b.label} — ${fmtMoney(b.amount)}`}
            />
          ))
        )}
      </div>

      {!compact ? (
        <div className="lg-aging-legend">
          {buckets.map((b) => (
            <span key={b.key} className={Math.abs(b.amount) > 0.005 ? undefined : 'lg-aging-legend--zero'}>
              <span
                className={`lg-aging-dot${b.key === 'd30_plus' ? ' lg-aging-dot--hatch' : ''}`}
                style={{ background: TONE_VAR[b.tone] }}
              />
              {b.label} · {fmtMoney(b.amount)}
              {b.invoices ? <span className="lg-aging-count"> ({b.invoices})</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
