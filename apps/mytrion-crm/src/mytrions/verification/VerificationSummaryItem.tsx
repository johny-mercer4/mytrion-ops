import type { ReactNode } from 'react';

type SummaryTone = 'clear' | 'debt';

/**
 * One aggregate pill. First visit (no cached value) is a pill-sized shimmer — never "—", "0",
 * or a spinner. Refresh / remount keep the last number (caller passes pending=false when SWR
 * already has data).
 */
export function VerificationSummaryItem({
  pending,
  value,
  label,
  tone,
  pressed,
  onSelect,
}: {
  pending: boolean;
  value: number;
  label: string;
  tone?: SummaryTone;
  pressed?: boolean;
  onSelect?: () => void;
}) {
  if (pending) {
    return (
      <span className="vf-summary-item vf-sk vf-sk-chip" aria-hidden="true">
        <strong>{'\u2007\u2007'}</strong> {label}
      </span>
    );
  }
  const extra = tone === 'clear' ? ' is-clear' : tone === 'debt' ? ' is-debt' : '';
  const on = pressed ? ' is-on' : '';
  const className = `vf-summary-item${extra}${on}`;
  if (onSelect) {
    return (
      <button type="button" className={className} aria-pressed={Boolean(pressed)} onClick={onSelect}>
        <strong>{value.toLocaleString()}</strong> {label}
      </button>
    );
  }
  return (
    <span className={className}>
      <strong>{value.toLocaleString()}</strong> {label}
    </span>
  );
}

export function VerificationSummary({
  pending,
  status = 'Loading counts',
  children,
}: {
  pending: boolean;
  status?: string;
  children: ReactNode;
}) {
  return (
    <div className="vf-summary" aria-live="polite" aria-busy={pending || undefined}>
      {pending ? (
        <span className="sr-only" role="status">
          {status}
        </span>
      ) : null}
      {children}
    </div>
  );
}
