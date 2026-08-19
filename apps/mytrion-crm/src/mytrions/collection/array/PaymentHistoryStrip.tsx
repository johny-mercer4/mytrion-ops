/**
 * 24 months of Metro 2 payment history, as a strip.
 *
 * Newest on the LEFT, matching the profile string's own order — reversing it to read
 * chronologically would put position 1 at the far end and make the field disagree with every
 * other system that prints it.
 *
 * Absence is drawn as a gap, never as a status. `B` and `D` mean the bureau has no history for
 * that month; colouring them like "current" would turn a carrier nobody has reported on into one
 * that looks reliable, which is the exact opposite of what a collections desk needs to know.
 */
import { parsePaymentHistory, summarisePaymentHistory } from './paymentHistory';

export function PaymentHistoryStrip({
  profile,
  reportPeriod,
  /** List mode: the most recent 12 months, no heading, no legend, no codes — a scan, not a read. */
  compact = false,
}: {
  profile: string | null;
  reportPeriod: string | null;
  compact?: boolean;
}) {
  const months = parsePaymentHistory(profile, reportPeriod);

  if (compact) {
    if (months.length === 0) return <span className="cc-muted">—</span>;
    const recent = months.slice(0, 12);
    const { worst, reported } = summarisePaymentHistory(months);
    const read =
      reported === 0
        ? 'No payment history reported'
        : `Worst in ${months.length} months: ${worst?.label} (${worst?.month})`;
    return (
      <span className="ar-history-mini" title={read} role="img" aria-label={read}>
        {recent.map((m) => (
          <i key={m.index} data-tone={m.tone} />
        ))}
      </span>
    );
  }

  if (months.length === 0) {
    return (
      <div className="ar-history">
        <span className="t-eyebrow">Payment history</span>
        <p className="ar-history-empty">No payment history profile on this filing.</p>
      </div>
    );
  }

  const { reported, worst, clean } = summarisePaymentHistory(months);

  return (
    <div className="ar-history">
      <div className="ar-history-head">
        <span className="t-eyebrow">Payment history · {months.length} months, newest first</span>
        <span className="ar-history-read">
          {reported === 0 ? (
            'Nothing reported in this window'
          ) : clean ? (
            <>
              Current every reported month ·{' '}
              <span className="num">
                {reported} of {months.length}
              </span>{' '}
              reported
            </>
          ) : (
            <>
              Worst: <b>{worst?.label}</b> in {worst?.month} ·{' '}
              <span className="num">
                {reported} of {months.length}
              </span>{' '}
              reported
            </>
          )}
        </span>
      </div>

      <ol className="ar-history-strip">
        {months.map((m) => (
          <li key={m.index} data-tone={m.tone} title={`${m.month} — ${m.label}`}>
            <span className="co-sr">{`${m.month}: ${m.label}`}</span>
            <span aria-hidden="true">{m.code}</span>
          </li>
        ))}
      </ol>

      <div className="ar-history-legend">
        <span>
          <i data-tone="current" />
          Current
        </span>
        <span>
          <i data-tone="late" />
          30–89 days
        </span>
        <span>
          <i data-tone="severe" />
          90–179 days
        </span>
        <span>
          <i data-tone="derogatory" />
          180+ / derogatory
        </span>
        <span>
          <i data-tone="none" />
          Not reported
        </span>
      </div>
    </div>
  );
}
