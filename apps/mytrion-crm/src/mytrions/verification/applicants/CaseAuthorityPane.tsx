/**
 * Phase 4 working pane — compare MC/DOT and any warehouse snapshot, then mark authority by hand.
 */
import { useEffect, useState } from 'react';
import { Button, Icon, Input } from '@/ds';
import {
  getDeskBrokerSnapshot,
  type BrokerSnapshotMatch,
} from '@/api/verificationDeskWrites';
import type { VerificationApplicantType, VerificationDeskDetail } from '@/api/verificationFlow';
import {
  AUTHORITY_CHECKS,
  type AuthorityMark,
  type AuthorityMarks,
  type StructureMark,
} from './caseAuthority';

const CHECK_MARKS: ReadonlyArray<{ id: AuthorityMark; label: string }> = [
  { id: 'ok', label: 'OK' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'missing', label: 'Missing' },
  { id: 'unresolved', label: 'Unresolved' },
];

const STRUCTURE_MARKS: ReadonlyArray<{ id: StructureMark; label: string }> = [
  { id: 'na', label: 'N/A' },
  { id: 'needed', label: 'Needed' },
  { id: 'ok', label: 'Attached / OK' },
];

function text(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s === '' ? '—' : s;
}

export function AuthorityPane({
  detail,
  caseId,
  marks,
  onMarks,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  marks: AuthorityMarks;
  onMarks: (next: AuthorityMarks) => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const [snapshot, setSnapshot] = useState<BrokerSnapshotMatch | null>(null);
  const [snapState, setSnapState] = useState<'loading' | 'ready' | 'none'>('loading');
  const received = detail.documents.filter((d) => d.status === 'received');

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

  const setCheck = (id: string, mark: AuthorityMark): void => {
    onMarks({ ...marks, checks: { ...marks.checks, [id]: mark } });
  };

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Authority & operating status</h3>
        <span className="va-pane-note">Manual — compare the application, files and any warehouse snapshot</span>
      </div>

      <div className="va-id-compare">
        <section className="va-id-col">
          <h4 className="va-field-label">On the application</h4>
          <p className="va-pane-body">{text(c.companyName)}</p>
          <p className="va-pane-body">MC: {text(c.mc)}</p>
          <p className="va-pane-body">USDOT: {text(c.dot)}</p>
        </section>
        <section className="va-id-col">
          <h4 className="va-field-label">Broker snapshot</h4>
          {snapState === 'loading' ? (
            <p className="va-pane-body">Looking up carrier records…</p>
          ) : snapState === 'none' ? (
            <p className="va-pane-body">No warehouse match — decide from the application and files.</p>
          ) : (
            <>
              <p className="va-pane-body">USDOT: {text(snapshot?.dotNumber)}</p>
              <p className="va-pane-body">Authority status: {text(snapshot?.operatingStatus)}</p>
              <p className="va-pane-body">Authority since: {text(snapshot?.authorityAddedOn)}</p>
            </>
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
        {AUTHORITY_CHECKS.map((check) => {
          const mark = marks.checks[check.id];
          return (
            <div className="va-id-check" key={check.id} data-mark={mark ?? 'unset'}>
              <div className="va-id-check-copy">
                <span className="va-id-check-label">{check.label}</span>
              </div>
              <div className="va-id-check-marks" role="group" aria-label={check.label}>
                {CHECK_MARKS.map((m) => (
                  <Button
                    key={m.id}
                    variant={mark === m.id ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={mark === m.id}
                    onClick={() => setCheck(check.id, m.id)}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="va-id-check" data-mark={marks.relatedCompany ?? 'unset'}>
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Related-company structure</span>
            <span className="va-id-check-value">Corporate Guarantee if a related company is in the picture</span>
          </div>
          <div className="va-id-check-marks" role="group" aria-label="Related-company structure">
            {STRUCTURE_MARKS.map((m) => (
              <Button
                key={m.id}
                variant={marks.relatedCompany === m.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={marks.relatedCompany === m.id}
                onClick={() => onMarks({ ...marks, relatedCompany: m.id })}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="va-id-check" data-mark={marks.thirdParty ?? 'unset'}>
          <div className="va-id-check-copy">
            <span className="va-id-check-label">Third-party carrier</span>
            <span className="va-id-check-value">Lease agreement and unit information if they are not the authority holder</span>
          </div>
          <div className="va-id-check-marks" role="group" aria-label="Third-party carrier">
            {STRUCTURE_MARKS.map((m) => (
              <Button
                key={m.id}
                variant={marks.thirdParty === m.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={marks.thirdParty === m.id}
                onClick={() => onMarks({ ...marks, thirdParty: m.id })}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS = [
  { value: 'owner_operator', label: 'Owner-Operator / Individual' },
  { value: 'carrier', label: 'Carrier (Company)' },
] as const;

function typeValue(raw: string): VerificationApplicantType {
  return raw === 'owner_operator' ? 'owner_operator' : 'carrier';
}

/**
 * Phase 4 when the rail says N/A — still let the desk correct the fields that decide applicability.
 * Type + MC/USDOT only; attachments stay on the aside.
 */
export function AuthorityFallbackPane({
  detail,
  closed,
  busy,
  skipReason,
  onSave,
}: {
  detail: VerificationDeskDetail;
  closed: boolean;
  busy: boolean;
  skipReason: string | null;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const [applicantType, setApplicantType] = useState(
    typeValue(String(c.applicantType ?? 'owner_operator')),
  );
  const [mc, setMc] = useState(c.mc == null ? '' : String(c.mc));
  const [dot, setDot] = useState(c.dot == null ? '' : String(c.dot));

  const disabled = closed || busy;

  return (
    <div className="va-skipped" data-fill>
      <div className="va-skipped-lead">
        <span className="va-skipped-glyph" aria-hidden="true">
          <Icon name="block" size="sm" />
        </span>
        <span className="va-skipped-text">
          <span className="va-skipped-title">Not applicable to this applicant</span>
          <span className="va-pane-body">
            {skipReason ?? 'This phase does not apply to this applicant type.'}
          </span>
        </span>
      </div>
      <p className="va-pane-body">
        If they hold MC/DOT authority after all, correct the type and numbers. Saving does not touch
        the rest of the application or the files.
      </p>
      <div className="va-fields">
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p4-type">
            Applicant type
          </label>
          <select
            id="va-p4-type"
            aria-label="Applicant type"
            className="va-type-select"
            value={applicantType}
            disabled={disabled}
            onChange={(e) => setApplicantType(typeValue(e.currentTarget.value))}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p4-mc">
            MC number
          </label>
          <Input
            id="va-p4-mc"
            value={mc}
            placeholder="Not recorded"
            disabled={disabled}
            fullWidth
            onChange={(e) => setMc(e.currentTarget.value)}
          />
        </div>
        <div className="va-field">
          <label className="va-field-label" htmlFor="va-p4-dot">
            USDOT
          </label>
          <Input
            id="va-p4-dot"
            value={dot}
            placeholder="Not recorded"
            disabled={disabled}
            fullWidth
            onChange={(e) => setDot(e.currentTarget.value)}
          />
        </div>
      </div>
      {closed ? null : (
        <div className="va-save">
          <Button
            variant="primary"
            icon="save"
            loading={busy}
            disabled={disabled}
            onClick={() =>
              void onSave({
                applicantType,
                mc: mc.trim() === '' ? null : mc.trim(),
                dot: dot.trim() === '' ? null : dot.trim(),
              })
            }
          >
            Save corrections
          </Button>
        </div>
      )}
    </div>
  );
}
