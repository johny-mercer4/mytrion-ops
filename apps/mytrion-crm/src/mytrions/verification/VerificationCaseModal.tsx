import { useRef, useState } from 'react';
import { Button } from '../../ds/Button/Button';
import { Dialog } from '../../ds/Dialog';
import {
  approveVerificationCaseStage,
  decideVerificationCase,
  refreshVerificationCase,
  runVerificationCaseStage,
  type VerificationCaseDetail,
  type VerificationCaseRow,
  type VerificationStageStatus,
} from '../../api/verificationCases';
import { invalidateSwrCache, writeSwrCache } from '../_shared/swrCache';
import { useVerificationCaseDetail } from './verificationData';
import { caseStatusLabel, caseStatusTone, humanizeToken, queueLabel } from './verificationCaseUi';

const STAGE_SK = 4;

function dash(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

function stageTone(status: VerificationStageStatus): string {
  if (status === 'approved') return 'is-good';
  if (status === 'failed') return 'is-bad';
  if (status === 'running' || status === 'ran' || status === 'ready') return 'is-info';
  if (status === 'skipped') return 'is-neutral';
  return '';
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
    ? `${dash(row.zohoStage)} · ${row.ownerName} · ${queueLabel(row.distributeType)}`
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
              <span className="vf-pill is-mute">{queueLabel(row.distributeType)}</span>
              <span className="vf-pill is-mute">
                {row.stagesDone}/{row.stagesTotal}
                {row.currentStage ? ` · ${humanizeToken(row.currentStage)}` : ''}
              </span>
              <span className={`vf-pill ${row.matchedSnapshotId ? 'is-on' : 'is-mute'}`}>
                {row.matchedSnapshotId ? dash(row.carrierOperatingStatus) || 'Matched' : 'Unmatched'}
              </span>
            </div>
          </section>

          <section className="vf-section">
            <h3 className="vf-section-title">Application</h3>
            <dl className="vf-fields">
              <div>
                <dt>DOT</dt>
                <dd>{dash(row.dot)}</dd>
              </div>
              <div>
                <dt>Applied</dt>
                <dd>{dash(row.applicationDate)}</dd>
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
              <ol className="vf-stages">
                {detail.catalog.map((stage) => {
                  const live = detail.stages.find((s) => s.stageId === stage.id);
                  const status = live?.status ?? 'pending';
                  return (
                    <li key={stage.id} className={`vf-stage ${stageTone(status)}`}>
                      <div>
                        <strong>
                          {stage.order}. {stage.label}
                        </strong>
                        <span>{humanizeToken(status)}</span>
                        {live?.error ? <em>{live.error}</em> : null}
                      </div>
                      <div className="vf-stage-btns">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void act(`run:${stage.id}`, () => runVerificationCaseStage(caseId, stage.id))
                          }
                        >
                          Run
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void act(`approve:${stage.id}`, () =>
                              approveVerificationCaseStage(caseId, stage.id),
                            )
                          }
                        >
                          Approve
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
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
