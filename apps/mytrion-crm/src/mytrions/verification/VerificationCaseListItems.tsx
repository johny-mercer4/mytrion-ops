import type { VerificationCaseRow } from '../../api/verificationCases';
import { paymentTone } from './verificationCaseDesk';
import {
  caseStatusLabel,
  caseStatusTone,
  queueLabel,
  reviewOwnerLabel,
} from './verificationCaseUi';

export const CASE_COLUMNS = [
  'Company',
  'Status',
  'Owner',
  'Limit',
  'Payment',
  'Cycle',
  'Queue',
  'SLA',
  'DOT',
] as const;

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

export function CaseOfferChips({ row }: { row: VerificationCaseRow }) {
  return (
    <>
      {row.approvedLimit ? <span className="vf-pill is-info">{row.approvedLimit}</span> : null}
      {row.paymentType ? (
        <span className={`vf-pill ${paymentTone(row.paymentType)}`}>{row.paymentType}</span>
      ) : null}
      {row.billingCycle ? <span className="vf-pill is-mute">{row.billingCycle}</span> : null}
    </>
  );
}

export function CaseRow({
  row,
  onOpen,
}: {
  row: VerificationCaseRow;
  onOpen: (id: string) => void;
}) {
  const review = reviewOwnerLabel(row.cpOwnerUsername);
  return (
    <tr className={row.slaStale ? 'is-stale' : undefined}>
      <td>
        <button type="button" className="vf-link" onClick={() => onOpen(row.id)}>
          {dash(row.companyName)}
        </button>
      </td>
      <td>
        <span className={`vf-pill ${caseStatusTone(row.status)}`}>{caseStatusLabel(row.status)}</span>
      </td>
      <td>
        <span className={`vf-pill ${review.claimed ? 'is-on' : 'is-mute'}`}>{review.label}</span>
      </td>
      <td>{dash(row.approvedLimit)}</td>
      <td>
        {row.paymentType ? (
          <span className={`vf-pill ${paymentTone(row.paymentType)}`}>{row.paymentType}</span>
        ) : (
          '—'
        )}
      </td>
      <td>{dash(row.billingCycle)}</td>
      <td>
        <span className="vf-pill is-mute">{queueLabel(row.distributeType)}</span>
      </td>
      <td>
        <span className={`vf-pill ${row.slaStale ? 'is-warn' : 'is-mute'}`}>{row.slaLabel ?? '—'}</span>
      </td>
      <td>{dash(row.dot)}</td>
    </tr>
  );
}

export function CaseCard({
  row,
  onOpen,
}: {
  row: VerificationCaseRow;
  onOpen: (id: string) => void;
}) {
  const review = reviewOwnerLabel(row.cpOwnerUsername);
  return (
    <button
      type="button"
      className={`vf-case-card${row.slaStale ? ' is-stale' : ''}`}
      onClick={() => onOpen(row.id)}
    >
      <strong>{dash(row.companyName)}</strong>
      <span className="vf-card-chips">
        <span className={`vf-pill ${caseStatusTone(row.status)}`}>{caseStatusLabel(row.status)}</span>
        <span className={`vf-pill ${review.claimed ? 'is-on' : 'is-mute'}`}>{review.label}</span>
        <CaseOfferChips row={row} />
        <span className="vf-pill is-info">{queueLabel(row.distributeType)}</span>
        {row.slaLabel ? (
          <span className={`vf-pill ${row.slaStale ? 'is-warn' : 'is-mute'}`}>{row.slaLabel}</span>
        ) : null}
      </span>
      <span>
        {dash(row.dot)} · {dash(row.applicationDate)}
      </span>
    </button>
  );
}
