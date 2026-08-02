/**
 * Verification field presentation — how one Zoho Deal's verification slice reads on screen.
 *
 * Split out of the tab so the card, the detail pane and any future surface agree on what
 * "Approved-Requested" or a CreditSafe grade of D looks like. Every tone here is derived from the
 * VALUE, never hard-coded per call site, so a new picklist option degrades to neutral instead of
 * silently rendering as "good".
 */
import type { ReactNode } from 'react';
import type { VerificationClient } from '@/api/verification';
import { Icon, type IconName } from './icons';

export type FactTone = 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

export const TONE_COLOR: Record<FactTone, string> = {
  ok: 'var(--ok-text)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  accent: 'var(--accent-text)',
  muted: 'var(--muted)',
};

/** `Credit_Decision` is free text in CRM; match on intent, not on an enum that does not exist. */
export function creditDecisionTone(value: string | null): FactTone {
  if (!value) return 'muted';
  const v = value.toLowerCase();
  if (v.startsWith('approved')) return 'ok';
  if (v.startsWith('declined') || v.includes('reject')) return 'danger';
  if (v.includes('pending') || v.includes('review')) return 'warn';
  return 'accent';
}

/** Shared shape for the three *_Verification picklists (Verified/Passed/Approved vs Failed). */
export function checkpointTone(value: string | null): FactTone {
  if (!value) return 'muted';
  const v = value.toLowerCase();
  if (/^(verified|passed|approved)$/.test(v)) return 'ok';
  if (/^(failed|not approved|declined)$/.test(v)) return 'danger';
  if (v.includes('pending')) return 'warn';
  return 'accent';
}

/** FICO-ish bands. Null (unscored) is muted, never "bad". */
export function creditScoreTone(score: number | null): FactTone {
  if (score == null) return 'muted';
  if (score >= 700) return 'ok';
  if (score >= 600) return 'warn';
  return 'danger';
}

export function riskTone(value: string | null): FactTone {
  if (!value) return 'muted';
  const v = value.toLowerCase();
  if (v === 'low') return 'ok';
  if (v === 'medium') return 'warn';
  if (v === 'high') return 'danger';
  return 'muted';
}

/** CreditSafe A–E. */
export function gradeTone(value: string | null): FactTone {
  if (!value) return 'muted';
  const v = value.trim().toUpperCase();
  if (v === 'A' || v === 'B') return 'ok';
  if (v === 'C') return 'warn';
  if (v === 'D' || v === 'E') return 'danger';
  return 'muted';
}

/**
 * `Application_Status` is the WEX-side status and drifts from the documented picklist (the live org
 * returns "Pending Setup", which is not in the metadata list), so match on substrings.
 */
export function applicationStatusTone(value: string | null): FactTone {
  if (!value) return 'muted';
  const v = value.toLowerCase();
  if (v.includes('closed') || v.includes('disqualified') || v.includes('fraud')) return 'danger';
  if (v.includes('decisioned') || v.includes('produced') || v.includes('complete')) return 'ok';
  if (v.includes('pending') || v.includes('incomplete') || v.includes('needed') || v.includes('required')) {
    return 'warn';
  }
  return 'accent';
}

/** Zoho `Stage`. Closed-lost is the only genuinely bad stage; live-on-cards is the good one. */
export function stageTone(stage: string): FactTone {
  const v = stage.toLowerCase();
  if (v.startsWith('closed lost')) return 'danger';
  if (/card swiped|card funded|cards activated|cards delivered|closed won/.test(v)) return 'ok';
  if (/approved/.test(v)) return 'ok';
  if (/processing|adjudication|review|validation|negotiation/.test(v)) return 'warn';
  return 'accent';
}

export const money = (n: number | null | undefined): string =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** A labelled value chip. Tone colours the value, never the whole chip, so a row stays readable. */
export function FactChip({
  label,
  value,
  tone = 'muted',
  icon,
  title,
}: {
  label: string;
  value: ReactNode;
  tone?: FactTone;
  icon?: IconName;
  title?: string;
}) {
  return (
    <span className={`ss-vf-chip is-${tone}`} title={title}>
      {icon ? <Icon name={icon} size={12} /> : null}
      <span className="ss-vf-chip-lbl">{label}</span>
      <span className="ss-vf-chip-val">{value}</span>
    </span>
  );
}

/** A tile in the detail grid. Renders nothing when there is no value — an empty grid of em dashes
 *  is noise, and Zoho leaves most verification fields null until the desk fills them. */
export function FactTile({
  label,
  value,
  tone = 'muted',
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: FactTone;
  hint?: string;
}) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="ss-vf-tile">
      <div className="ss-vf-tile-lbl">{label}</div>
      <div className="ss-vf-tile-val" style={{ color: TONE_COLOR[tone] }}>
        {value}
      </div>
      {hint ? <div className="ss-vf-tile-hint">{hint}</div> : null}
    </div>
  );
}

/** The three *_Verification picklists + the two booleans, as a single pass/fail rail. */
export function CheckpointRail({ client }: { client: VerificationClient }) {
  const checks: Array<{ label: string; value: string | null }> = [
    { label: 'Company', value: client.companyVerification },
    { label: 'Billing', value: client.billingVerification },
    { label: "Love's", value: client.lovesVerification },
    { label: 'Verified', value: client.verified ? 'Yes' : null },
    { label: 'Limits added', value: client.limitsAdded ? 'Yes' : null },
  ];
  const present = checks.filter((check) => check.value);
  if (!present.length) return null;
  return (
    <div className="ss-vf-rail" aria-label="Verification checkpoints">
      {present.map((check) => {
        const tone = check.value === 'Yes' ? 'ok' : checkpointTone(check.value);
        return (
          <span key={check.label} className={`ss-vf-check is-${tone}`}>
            <Icon name={tone === 'danger' ? 'close' : tone === 'warn' ? 'clock' : 'check'} size={12} strokeWidth={2.6} />
            {check.label}
            <em>{check.value}</em>
          </span>
        );
      })}
    </div>
  );
}
