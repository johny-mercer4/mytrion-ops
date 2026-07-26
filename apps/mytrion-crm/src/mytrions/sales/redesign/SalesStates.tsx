import type { ReactNode } from 'react';
import { Icon } from './icons';

export type StateTone = 'muted' | 'danger' | 'ok';

const TONE_ICON: Record<StateTone, 'warn' | 'inbox' | 'check'> = {
  danger: 'warn',
  muted: 'inbox',
  ok: 'check',
};

/**
 * The module's ONE non-loading state block: empty, error, or success.
 *
 * It replaces a bare line of centred coloured text that appeared in ~35 places. For the audience this
 * module is built for — agents moving off Zoho and spreadsheets — "Could not reach the backend" in
 * small red text with nothing to click is a dead end. This gives every state a shape they recognise:
 * an icon, a readable line, and (for errors) something to press.
 *
 * The `tone`/`children` API is unchanged from the local version it replaces, so existing call sites
 * needed no edits.
 */
export function StateNote({
  tone,
  children,
  onRetry,
  retryLabel = 'Try again',
}: {
  tone: StateTone;
  children: ReactNode;
  /** Errors that can be re-attempted should pass this — a dead end with no action is the worst case. */
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className={`ss-state ss-state--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="ss-state-ico" aria-hidden="true">
        <Icon name={TONE_ICON[tone]} size={18} />
      </span>
      <div className="ss-state-msg">{children}</div>
      {onRetry ? (
        <button type="button" className="ss-state-btn" onClick={onRetry}>
          <Icon name="refresh" size={13} />
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
