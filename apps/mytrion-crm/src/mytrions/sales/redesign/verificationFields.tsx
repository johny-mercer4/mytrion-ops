/**
 * Verification field presentation — how one Zoho Deal's verification slice reads on screen.
 *
 * Split out of the tab so the card, the detail pane and any future surface agree on what
 * "Approved-Requested" or a CreditSafe grade of D looks like. Every tone here is derived from the
 * VALUE, never hard-coded per call site, so a new picklist option degrades to neutral instead of
 * silently rendering as "good".
 *
 * Card vs detail contract: Deal Pipeline = `dealStage`, WEX = raw `applicationStatus`, headline
 * Credit Decision = raw Zoho `Credit_Decision` (empty → "Not decided yet"). The credit-platform
 * snapshot is a separate "Verification desk" line — it must never overwrite Credit Decision.
 */
import { useState, type ReactNode } from 'react';
import { copyToClipboard } from '@/mytrions/admin/carrierUserUtil';
import type { PipelineDecision, PipelineSnapshot, VerificationClient } from '@/api/verification';
import { Icon, type IconName } from './icons';

export type FactTone = 'ok' | 'warn' | 'danger' | 'accent' | 'muted';

export const TONE_COLOR: Record<FactTone, string> = {
  ok: 'var(--ok-text)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  accent: 'var(--accent-text)',
  muted: 'var(--muted)',
};

export type CreditDecisionKind =
  | 'approved'
  | 'declined_prepay'
  | 'declined'
  | 'pending'
  | 'other'
  | 'empty';

/** `Credit_Decision` is free text in CRM; match on intent, not on an enum that does not exist. */
export function creditDecisionKind(value: string | null | undefined): CreditDecisionKind {
  if (!value) return 'empty';
  const v = value.toLowerCase();
  if (v.startsWith('approved')) return 'approved';
  const prepayPath = v.includes('prepay') || v.includes('secured');
  if (v.startsWith('declined') || v.includes('reject')) {
    return prepayPath ? 'declined_prepay' : 'declined';
  }
  if (prepayPath) return 'declined_prepay';
  if (v.includes('pending') || v.includes('review')) return 'pending';
  return 'other';
}

export function creditDecisionTone(value: string | null): FactTone {
  switch (creditDecisionKind(value)) {
    case 'approved':
      return 'ok';
    case 'declined_prepay':
    case 'pending':
      return 'warn';
    case 'declined':
      return 'danger';
    case 'other':
      return 'accent';
    default:
      return 'muted';
  }
}

export const VERIFICATION_STATE_VIS: Record<
  NonNullable<VerificationClient['verificationState']>,
  { label: string; tone: FactTone; icon: IconName }
> = {
  queued: { label: 'Queued', tone: 'warn', icon: 'clock' },
  in_progress: { label: 'In progress', tone: 'warn', icon: 'clock' },
  approved: { label: 'Approved', tone: 'ok', icon: 'check' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close' },
};

export const CLASSIFICATION_VIS: Record<
  VerificationClient['classification'],
  { label: string; color: string }
> = {
  in_pipeline: { label: 'In Pipeline', color: 'var(--accent)' },
  active: { label: 'Active', color: 'var(--ok)' },
  closed: { label: 'Closed', color: 'var(--muted)' },
};

/** Desk outcome from credit_platform — a secondary line, never the Credit Decision headline. */
export function deskDecisionLabel(d: PipelineDecision): { text: string; tone: FactTone } {
  switch (d.outcome) {
    case 'loc':
      return { text: 'LOC Approved', tone: 'ok' };
    case 'prepaid':
      return { text: 'Prepaid', tone: 'accent' };
    case 'rejected':
      return /^\s*prepay/i.test(d.reason ?? '')
        ? { text: 'Prepay', tone: 'warn' }
        : { text: 'Not Accepted', tone: 'danger' };
    default:
      return { text: 'Undecided', tone: 'warn' };
  }
}

/**
 * Headline Credit Decision on the card and in the sheet. Always Zoho `Credit_Decision`.
 * Empty is a real state ("Not decided yet"), not the verification-desk "Undecided".
 */
export function zohoCreditDisplay(value: string | null | undefined): { text: string; tone: FactTone; empty: boolean } {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return { text: 'Not decided yet', tone: 'muted', empty: true };
  return { text: trimmed, tone: creditDecisionTone(trimmed), empty: false };
}

/**
 * Verification-desk labels from a live snapshot, or from roster state when the snapshot is not
 * loaded yet. Used only as the secondary "Verification desk" line / approved-result copy.
 */
export function platformCreditLabel(
  client: Pick<VerificationClient, 'verificationState' | 'cpPaymentType' | 'creditDecision'>,
  decision?: PipelineDecision | null,
): { text: string; tone: FactTone } {
  if (decision) return deskDecisionLabel(decision);
  const pay = (client.cpPaymentType ?? '').toLowerCase();
  const prepayPay = /prepay|prepaid/.test(pay);
  switch (client.verificationState) {
    case 'approved':
      return prepayPay ? { text: 'Prepaid', tone: 'accent' } : { text: 'LOC Approved', tone: 'ok' };
    case 'rejected': {
      const zohoPrepay = creditDecisionKind(client.creditDecision) === 'declined_prepay';
      return prepayPay || zohoPrepay
        ? { text: 'Prepay', tone: 'warn' }
        : { text: 'Not Accepted', tone: 'danger' };
    }
    default:
      return { text: 'Undecided', tone: 'warn' };
  }
}

/** Hide numbered compliance steps once the request is fully approved. */
export function pipelineIsApproved(
  snapshot: PipelineSnapshot | null | undefined,
  state: VerificationClient['verificationState'],
): boolean {
  if (state === 'approved') return true;
  if (!snapshot) return false;
  const outcome = snapshot.decision.outcome;
  if (outcome !== 'loc' && outcome !== 'prepaid') return false;
  const stages = snapshot.stages.filter((row) => row.used !== false);
  if (!stages.length) return true;
  return stages.every((row) => row.status === 'done' || row.status === 'skipped');
}

/**
 * When Zoho credit and the live verification state look like they disagree, say so — they are two
 * systems (CRM credit picklist vs desk request), not a mapping bug.
 */
export function creditVerificationNote(
  client: Pick<VerificationClient, 'creditDecision' | 'verificationState'>,
): string | null {
  const kind = creditDecisionKind(client.creditDecision);
  const state = client.verificationState;
  if (kind === 'declined_prepay' && (state === 'in_progress' || state === 'queued')) {
    return 'Credit is prepay/secured only. Verification is still working this application.';
  }
  if (kind === 'declined' && (state === 'in_progress' || state === 'queued')) {
    return 'Zoho credit is declined; the verification desk has not closed the request yet.';
  }
  if (kind === 'approved' && state === 'rejected') {
    return 'Zoho credit shows approved; the verification desk marked this request rejected.';
  }
  return null;
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

const WEX_STATUS_BUCKETS: Record<string, { label: string; tone: FactTone }> = {
  'saved complete': { label: 'New App', tone: 'accent' },
  'additional authentication required': { label: 'New App', tone: 'accent' },
  'pending decision': { label: 'Review', tone: 'muted' },
  'decisioned': { label: 'Review', tone: 'muted' },
  'pending setup data': { label: 'Approved – Confirm to Send', tone: 'warn' },
  'pending setup generic': { label: 'Approved – Confirm to Send', tone: 'warn' },
  'pending setup': { label: 'Approved – Confirm to Send', tone: 'warn' },
  'deposit counter offer sent': { label: 'Approved – Confirm to Send', tone: 'warn' },
  'bocdd needed': { label: 'Incomplete', tone: 'muted' },
  'saved incomplete': { label: 'Incomplete', tone: 'muted' },
  'app incomplete': { label: 'Incomplete', tone: 'muted' },
  'disqualified': { label: 'Closed', tone: 'danger' },
  'closed fraud': { label: 'Closed', tone: 'danger' },
  'closed lost': { label: 'Closed', tone: 'danger' },
  'cards produced': { label: 'Cards Requested', tone: 'ok' },
};

export function wexStatusBucket(value: string | null | undefined): { label: string; tone: FactTone } | null {
  if (!value) return null;
  const norm = value.trim().toLowerCase().replace(/[\s\-_/]+/g, ' ');
  const exact = WEX_STATUS_BUCKETS[norm];
  if (exact) return exact;
  if (norm.includes('incomplete') || norm.includes('bocdd') || norm.includes('needed')) return { label: 'Incomplete', tone: 'muted' };
  if (norm.includes('closed') || norm.includes('disqualified') || norm.includes('fraud') || norm.includes('lost')) return { label: 'Closed', tone: 'danger' };
  if (norm.includes('produced') || norm.includes('cards')) return { label: 'Cards Requested', tone: 'ok' };
  if (norm.includes('setup') || norm.includes('counter offer')) return { label: 'Approved – Confirm to Send', tone: 'warn' };
  if (norm.includes('decision')) return { label: 'Review', tone: 'muted' };
  if (norm.includes('saved') || norm.includes('authentication')) return { label: 'New App', tone: 'accent' };
  return { label: value, tone: 'muted' };
}

/** Raw WEX `Application_Status` for display; bucket is tone + optional shorthand, never a replacement. */
export function wexStatusDisplay(value: string | null | undefined): {
  raw: string;
  tone: FactTone;
  bucketLabel: string | null;
} | null {
  if (!value) return null;
  const bucket = wexStatusBucket(value);
  return {
    raw: value,
    tone: bucket?.tone ?? 'muted',
    bucketLabel: bucket && bucket.label !== value ? bucket.label : null,
  };
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
  testId,
}: {
  label: string;
  value: ReactNode;
  tone?: FactTone;
  icon?: IconName;
  title?: string;
  testId?: string;
}) {
  return (
    <span className={`ss-vf-chip is-${tone}`} title={title} data-testid={testId}>
      <span className="ss-vf-chip-lbl">
        {icon ? <Icon name={icon} size={12} /> : null}
        {label}
      </span>
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
  testId,
  kind,
}: {
  label: string;
  value: ReactNode;
  tone?: FactTone;
  hint?: string;
  testId?: string;
  kind?: 'id';
}) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div className="ss-vf-tile" data-testid={testId}>
      <div className="ss-vf-tile-lbl">{label}</div>
      <div className={`ss-vf-tile-val${kind === 'id' ? ' is-id' : ''}`} style={kind === 'id' ? undefined : { color: TONE_COLOR[tone] }}>
        {value}
      </div>
      {hint ? <div className="ss-vf-tile-hint">{hint}</div> : null}
    </div>
  );
}

export function CopyValue({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const run = () => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button
      type="button"
      className={className}
      title="Click to copy"
      aria-label={`Copy ${text}`}
      onClick={(e) => { e.stopPropagation(); run(); }}
      style={{ cursor: 'pointer', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit' }}
    >
      {copied ? 'Copied' : children}
    </button>
  );
}

/** Deal Pipeline + WEX + Zoho Credit Decision — same fields, same labels, on the card and in the sheet. */
export function ApplicationStatusFacts({
  client,
  includeCredit = true,
}: {
  client: VerificationClient;
  includeCredit?: boolean;
}) {
  const wex = wexStatusDisplay(client.applicationStatus);
  const credit = zohoCreditDisplay(client.creditDecision);
  return (
    <div className="ss-vf-chips" data-testid="vf-status-facts">
      <FactChip
        label="Deal Pipeline"
        value={client.dealStage}
        tone={stageTone(client.dealStage)}
        testId="vf-deal-pipeline"
      />
      {wex ? (
        <FactChip
          label="WEX Status"
          value={wex.raw}
          tone={wex.tone}
          {...(wex.bucketLabel ? { title: `Sales shorthand: ${wex.bucketLabel}` } : {})}
          testId="vf-wex-status"
        />
      ) : null}
      {includeCredit ? (
        <FactChip
          label="Credit Decision"
          value={credit.text}
          tone={credit.tone}
          testId="vf-credit-decision"
        />
      ) : null}
    </div>
  );
}

export function VerificationStateLine({
  state,
}: {
  state: VerificationClient['verificationState'];
}) {
  const vis = state ? VERIFICATION_STATE_VIS[state] : null;
  return (
    <div
      className="ss-vf-cp-state"
      data-testid="vf-verification-state"
      style={{ color: vis ? TONE_COLOR[vis.tone] : 'var(--muted)' }}
    >
      <Icon name={vis?.icon ?? 'clock'} size={14} strokeWidth={2.6} />
      Verification: {vis ? vis.label : 'Not in verification'}
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
