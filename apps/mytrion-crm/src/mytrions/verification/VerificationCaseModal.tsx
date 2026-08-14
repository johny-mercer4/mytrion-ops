import { useRef, useState } from 'react';
import { Button } from '../../ds/Button/Button';
import { Dialog } from '../../ds/Dialog';
import {
  decideVerificationCase,
  refreshVerificationCase,
  type VerificationCaseDetail,
  type VerificationCaseRow,
} from '../../api/verificationCases';
import { invalidateSwrCache, writeSwrCache } from '../_shared/swrCache';
import { useVerificationCaseDetail } from './verificationData';
import { VerificationCaseDocuments } from './VerificationCaseDocuments';
import { VerificationCasePipeline } from './VerificationCasePipeline';
import { VerificationCaseQueueBar } from './VerificationCaseQueueBar';
import { paymentTone } from './verificationCaseDesk';
import {
  caseStatusLabel,
  caseStatusTone,
  firstRunLabel,
  humanizeToken,
  queueLabel,
  reviewOwnerLabel,
} from './verificationCaseUi';

const STAGE_SK = 4;

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

export function VerificationCaseModal({
  caseId,
  preview,
  onClose,
}: {
  caseId: string;
  preview?: VerificationCaseRow | null;
  onClose: () => void;
}) {
  const load = useVerificationCaseDetail(caseId);
  const lastDetail = useRef<VerificationCaseDetail | null>(null);
  if (load.data && load.data.case.id === caseId) lastDetail.current = load.data;
  const cached = lastDetail.current?.case.id === caseId ? lastDetail.current : null;
  const detail = load.data ?? cached;
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const row = detail?.case ?? preview ?? null;
  const stagesPending = load.loading && !detail;
  const banner = actionError ?? (detail ? load.error : null);
  const review = reviewOwnerLabel(row?.cpOwnerUsername);

  const act = async (label: string, fn: () => Promise<VerificationCaseDetail>): Promise<void> => {
    setBusy(label);
    setActionError(null);
    try {
      const next = await fn();
      writeSwrCache(`verification:case:${caseId}`, next);
      lastDetail.current = next;
      invalidateSwrCache('verification:cases');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const title = row?.companyName?.trim() || 'Verification case';
  const subtitle = row
    ? `${dash(row.zohoStage)} · ${review.label} · ${queueLabel(row.distributeType)}`
    : undefined;

  return (
    <Dialog
      open
      onClose={() => onClose()}
      title={title}
      subtitle={subtitle}
      size="lg"
      mobile="sheet"
      closeLabel="Close case"
      data-mytrion="verification"
      footer={
        row ? (
          <div className="vf-case-actions">
            <Button
              variant="secondary"
              disabled={Boolean(busy)}
              loading={busy === 'refresh'}
              onClick={() => void act('refresh', () => refreshVerificationCase(caseId))}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() => void act('review', () => decideVerificationCase(caseId, 'REVIEW'))}
            >
              Hold
            </Button>
            <Button
              variant="danger"
              disabled={Boolean(busy)}
              onClick={() => void act('reject', () => decideVerificationCase(caseId, 'REJECTED'))}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              disabled={Boolean(busy)}
              onClick={() => void act('approve', () => decideVerificationCase(caseId, 'APPROVED'))}
            >
              Approve
            </Button>
          </div>
        ) : null
      }
    >
      {banner ? (
        <p className="vf-banner-error" role="alert">
          {banner}
        </p>
      ) : null}

      {row ? (
        <div className="vf-modal-body">
          <section className="vf-section">
            <h3 className="vf-section-title">Status</h3>
            <div className="vf-card-chips">
              <span className={`vf-pill ${caseStatusTone(row.status)}`}>{caseStatusLabel(row.status)}</span>
              <span className="vf-pill is-info">{dash(row.zohoStage)}</span>
              <span className={`vf-pill ${review.claimed ? 'is-on' : 'is-mute'}`}>{review.label}</span>
              <span className="vf-pill is-mute">{row.ownerName}</span>
              <span className="vf-pill is-mute">{queueLabel(row.distributeType)}</span>
              <span className="vf-pill is-mute">
                {row.stagesDone}/{row.stagesTotal}
                {row.currentStage ? ` · ${humanizeToken(row.currentStage)}` : ''}
              </span>
              <span className={`vf-pill ${row.matchedSnapshotId ? 'is-on' : 'is-mute'}`}>
                {row.matchedSnapshotId ? dash(row.carrierOperatingStatus) || 'Matched' : 'Unmatched'}
              </span>
              <span
                className={`vf-pill ${
                  row.firstRunStatus === 'error' ? 'is-bad' : row.firstRunStatus === 'completed' ? 'is-on' : 'is-info'
                }`}
              >
                {firstRunLabel(row.firstRunStatus)}
              </span>
              {row.slaLabel ? (
                <span className={`vf-pill ${row.slaStale ? 'is-warn' : 'is-mute'}`}>{row.slaLabel}</span>
              ) : null}
            </div>
            {row.firstRunError ? <p className="vf-stage-note">{row.firstRunError}</p> : null}
          </section>

          <VerificationCaseQueueBar caseId={caseId} row={row} busy={busy} onAct={act} />

          <section className="vf-section">
            <h3 className="vf-section-title">Application</h3>
            <dl className="vf-fields">
              <div>
                <dt>DOT</dt>
                <dd>{dash(row.dot)}</dd>
              </div>
              <div>
                <dt>Zoho id</dt>
                <dd>{dash(row.zohoApplicationId || row.zohoDealId)}</dd>
              </div>
              <div>
                <dt>Applied</dt>
                <dd>{dash(row.applicationDate)}</dd>
              </div>
              <div>
                <dt>Limit</dt>
                <dd>{dash(row.approvedLimit)}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>
                  {row.paymentType ? (
                    <span className={`vf-pill ${paymentTone(row.paymentType)}`}>{row.paymentType}</span>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>Cycle</dt>
                <dd>{dash(row.billingCycle)}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{dash(row.phone)}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{dash(row.email)}</dd>
              </div>
            </dl>
          </section>

          <section className="vf-section">
            <h3 className="vf-section-title">Pipeline</h3>
            {load.revalidating ? <p className="vf-cached">Updating stages…</p> : null}
            {detail ? (
              <VerificationCasePipeline caseId={caseId} detail={detail} busy={busy} onAct={act} />
            ) : stagesPending ? (
              <ol className="vf-stages" aria-busy="true">
                <span className="sr-only" role="status">
                  Loading stages
                </span>
                {Array.from({ length: STAGE_SK }, (_, i) => (
                  <li key={i} className="vf-sk vf-sk-stage" aria-hidden="true" />
                ))}
              </ol>
            ) : (
              <div className="vf-empty" role="alert">
                <div className="vf-empty-title">Couldn’t load stages</div>
                <p>{load.error ?? 'The case header is still here. Retry to load pipeline steps.'}</p>
                <Button variant="secondary" onClick={load.reload}>
                  Try again
                </Button>
              </div>
            )}
          </section>
          <VerificationCaseDocuments
            caseId={caseId}
            detail={detail}
            busy={busy}
            pending={stagesPending}
            onAct={act}
          />
        </div>
      ) : stagesPending ? (
        <div className="vf-modal-body" aria-busy="true">
          <span className="sr-only" role="status">
            Loading case
          </span>
          <ol className="vf-stages" aria-hidden="true">
            {Array.from({ length: STAGE_SK }, (_, i) => (
              <li key={i} className="vf-sk vf-sk-stage" />
            ))}
          </ol>
        </div>
      ) : (
        <div className="vf-empty" role="alert">
          <div className="vf-empty-title">Couldn’t open this case</div>
          <p>{load.error ?? 'Retry if the queue is still catching up.'}</p>
          <Button variant="secondary" onClick={load.reload}>
            Try again
          </Button>
        </div>
      )}
    </Dialog>
  );
}
