/**
 * Phase 2 working pane — compare intake, attached files and the broker snapshot, then mark each SOP check.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/ds';
import {
  getDeskBrokerSnapshot,
  type BrokerSnapshotMatch,
} from '@/api/verificationDeskWrites';
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import {
  identityChecksFor,
  type IdentityCheck,
  type IdentityMark,
} from './caseIdentity';

const MARKS: ReadonlyArray<{ id: IdentityMark; label: string }> = [
  { id: 'ok', label: 'OK' },
  { id: 'missing', label: 'Missing' },
  { id: 'inconsistent', label: 'Inconsistent' },
];

const FIELD_LABEL: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  dlLast4: 'Licence last 4',
  dlState: 'Licence state',
  ssnLast4: 'SSN last 4',
  residentialAddress: 'Residential address',
  phone: 'Phone',
  email: 'Email',
  bankingSource: 'Banking',
  companyName: 'Company',
  ein: 'EIN',
  businessAddress: 'Business address',
  mc: 'MC',
  dot: 'USDOT',
};

function text(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s === '' ? '—' : s;
}

function snapshotBits(match: BrokerSnapshotMatch | null): Array<{ k: string; v: string }> {
  if (!match) return [];
  return [
    { k: 'Matched on', v: match.matchedOn },
    { k: 'Owner name', v: text(match.ownerFullName) },
    { k: 'USDOT', v: text(match.dotNumber) },
    { k: 'Address', v: text(match.physicalAddress) },
    { k: 'Phone', v: text(match.phoneNumber) },
    { k: 'Email', v: text(match.email) },
    { k: 'Authority status', v: text(match.operatingStatus) },
    { k: 'Authority since', v: text(match.authorityAddedOn) },
  ];
}

export function IdentityPane({
  detail,
  caseId,
  marks,
  onMarks,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  marks: Record<string, IdentityMark>;
  onMarks: (next: Record<string, IdentityMark>) => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const checks = useMemo(() => identityChecksFor(c.applicantType), [c.applicantType]);
  const [snapshot, setSnapshot] = useState<BrokerSnapshotMatch | null>(null);
  const [snapState, setSnapState] = useState<'loading' | 'ready' | 'none'>('loading');

  useEffect(() => {
    let live = true;
    setSnapState('loading');
    getDeskBrokerSnapshot(caseId)
      .then((res) => {
        if (!live) return;
        setSnapshot(res.match);
        setSnapState(res.match ? 'ready' : 'none');
      })
      .catch(() => {
        if (!live) return;
        setSnapshot(null);
        setSnapState('none');
      });
    return () => {
      live = false;
    };
  }, [caseId]);

  const received = detail.documents.filter((d) => d.status === 'received');
  const principals = detail.principals.map((p) => p.fullName).join(', ') || '—';

  const valueFor = (check: IdentityCheck): string => {
    if (check.id === 'principals') return principals;
    if (check.fields.length === 0) return 'Judgement against the file';
    return check.fields.map((f) => `${FIELD_LABEL[f] ?? f}: ${text(c[f])}`).join(' · ');
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Identity / business</h3>
        <span className="va-pane-note">Manual — compare intake, files and the broker snapshot</span>
      </div>

      <div className="va-id-compare">
        <section className="va-id-col">
          <h4 className="va-field-label">On the application</h4>
          <p className="va-pane-body">{c.applicantType === 'owner_operator' ? 'Owner-operator' : 'Carrier'}</p>
          <p className="va-pane-body">
            {[c.firstName, c.lastName].filter(Boolean).join(' ') || text(c.companyName)}
          </p>
          <p className="va-pane-body">{text(c.email)} · {text(c.phone)}</p>
        </section>
        <section className="va-id-col">
          <h4 className="va-field-label">Broker snapshot</h4>
          {snapState === 'loading' ? (
            <p className="va-pane-body">Looking up carrier records…</p>
          ) : snapState === 'none' ? (
            <p className="va-pane-body">No warehouse match — decide from the application and files.</p>
          ) : (
            snapshotBits(snapshot).map((row) => (
              <p className="va-pane-body" key={row.k}>
                {row.k}: {row.v}
              </p>
            ))
          )}
        </section>
        <section className="va-id-col">
          <h4 className="va-field-label">Files received</h4>
          {received.length === 0 ? (
            <p className="va-pane-body">None yet — attach from Documents.</p>
          ) : (
            received.map((d) => (
              <p className="va-pane-body" key={d.id}>
                {d.label ?? d.fileName ?? d.docType}
              </p>
            ))
          )}
        </section>
      </div>

      <div className="va-id-checks">
        {checks.map((check) => {
          const mark = marks[check.id];
          return (
            <div className="va-id-check" key={check.id} data-mark={mark ?? 'unset'}>
              <div className="va-id-check-copy">
                <span className="va-id-check-label">{check.label}</span>
                <span className="va-id-check-value">{valueFor(check)}</span>
              </div>
              <div className="va-id-check-marks" role="group" aria-label={check.label}>
                {MARKS.map((m) => (
                  <Button
                    key={m.id}
                    variant={mark === m.id ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={mark === m.id}
                    onClick={() => onMarks({ ...marks, [check.id]: m.id })}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
