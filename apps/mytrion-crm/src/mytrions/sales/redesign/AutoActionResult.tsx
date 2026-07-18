/**
 * Standardized Automations result chrome — success / error / empty.
 * Mirrors zoho-octane `showActionResult` + `.automation-empty` (status dialog language).
 */
import type { ReactNode } from 'react';
import { s } from './dc';
import { Icon, type IconName } from './icons';

export type AutoResultTone = 'success' | 'error' | 'empty';

export interface AutoResultDetail {
  label: string;
  value: string;
}

/** True when a status message is an empty outcome, not a write success. */
export function isEmptyResultMessage(message: string): boolean {
  const m = message.trim().toLowerCase();
  return (
    m.startsWith('no ')
    || m.includes('not found')
    || m.includes('not available')
    || m.includes('nothing to')
    || m.includes('on file for this')
  );
}

const TONE: Record<AutoResultTone, { icon: IconName; iconClass: string; btnClass: string; borderClass: string }> = {
  success: {
    icon: 'checkCircle',
    iconClass: 'ss-auto-result-icon ss-auto-result-icon--ok',
    btnClass: 'ss-auto-result-btn ss-auto-result-btn--ok',
    borderClass: 'ss-auto-result ss-auto-result--ok',
  },
  error: {
    icon: 'warn',
    iconClass: 'ss-auto-result-icon ss-auto-result-icon--err',
    btnClass: 'ss-auto-result-btn ss-auto-result-btn--err',
    borderClass: 'ss-auto-result ss-auto-result--err',
  },
  empty: {
    icon: 'inbox',
    iconClass: 'ss-auto-result-icon ss-auto-result-icon--empty',
    btnClass: 'ss-auto-result-btn ss-auto-result-btn--muted',
    borderClass: 'ss-auto-result ss-auto-result--empty',
  },
};

/** Compact empty block for picklists, invoice/txn panels, catalog search. */
export function AutoEmptyState({
  title,
  message,
  icon = 'inbox',
  compact = false,
}: {
  title: string;
  message?: string | undefined;
  icon?: IconName;
  compact?: boolean;
}) {
  return (
    <div
      className="ss-auto-empty"
      role="status"
      style={s(compact ? 'padding:18px 14px' : '')}
    >
      <div className="ss-auto-empty-icon" aria-hidden>
        <Icon name={icon} size={compact ? 22 : 28} strokeWidth={1.75} />
      </div>
      <div className="ss-auto-empty-title">{title}</div>
      {message ? <div className="ss-auto-empty-sub">{message}</div> : null}
    </div>
  );
}

/**
 * Full status result body inside the automation modal (done step).
 * Done dismisses; optional secondary = Try again / Run another.
 */
export function AutoStatusResult({
  tone,
  title,
  message,
  details,
  onDone,
  onSecondary,
  secondaryLabel,
  children,
}: {
  tone: AutoResultTone;
  title: string;
  message?: string | undefined;
  details?: AutoResultDetail[];
  onDone: () => void;
  onSecondary?: () => void;
  secondaryLabel?: string;
  children?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={t.borderClass} role="alertdialog" aria-live="assertive" aria-modal="false">
      <div className="ss-auto-result-head">
        <span className={t.iconClass} aria-hidden>
          <Icon name={t.icon} size={22} strokeWidth={2} />
        </span>
        <div className="ss-auto-result-title">{title}</div>
      </div>
      {message ? <div className="ss-auto-result-msg">{message}</div> : null}
      {details && details.length > 0 ? (
        <div className="ss-auto-result-details">
          {details.map((d) => (
            <div key={d.label} className="ss-auto-result-detrow">
              <span className="ss-auto-result-detlabel">{d.label}</span>
              <span className="ss-auto-result-detvalue">{d.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {children}
      <div className="ss-auto-result-actions">
        {onSecondary && secondaryLabel ? (
          <button type="button" onClick={onSecondary} className="ss-auto-result-btn-sec">
            {secondaryLabel}
          </button>
        ) : null}
        <button type="button" onClick={onDone} className={t.btnClass}>
          Done
        </button>
      </div>
    </div>
  );
}
