import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
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

const FIELD_SK = 6;
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

function queueLabel(distributeType: 'personal' | 'shared'): string {
  return distributeType === 'shared' ? 'Shared' : 'Personal';
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
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = load.data;
  const row = detail?.case;
  const firstLoad = load.loading && !detail;
  const banner = actionError ?? load.error;

  const act = async (label: string, fn: () => Promise<VerificationCaseDetail>): Promise<void> => {
    setBusy(label);
    setActionError(null);
    try {
      const next = await fn();
      writeSwrCache(`verification:case:${caseId}`, next);
      invalidateSwrCache('verification:cases');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const header = row ?? preview ?? null;
  const title = header?.companyName?.trim() || 'Verification case';
  const subtitle = header
    ? `${header.zohoStage ?? 'Deal'} · ${header.ownerName} · ${queueLabel(header.distributeType)}`
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
            <button
              type="button"
              className="ms-btn"
              disabled={Boolean(busy)}
              aria-busy={busy === 'refresh' || undefined}
              onClick={() => void act('refresh', () => refreshVerificationCase(caseId))}
            >
              <RefreshCw size={14} className={busy === 'refresh' ? 'vf-spin' : undefined} />
              Refresh
            </button>
            <button
              type="button"
              className="ms-btn"
              disabled={Boolean(busy)}
              onClick={() => void act('review', () => decideVerificationCase(caseId, 'REVIEW'))}
            >
              Hold
            </button>
            <button
              type="button"
              className="ms-btn is-danger"
              disabled={Boolean(busy)}
              onClick={() => void act('reject', () => decideVerificationCase(caseId, 'REJECTED'))}
            >
              Reject
            </button>
            <button
              type="button"
              className="ms-btn is-primary"
              disabled={Boolean(busy)}
              onClick={() => void act('approve', () => decideVerificationCase(caseId, 'APPROVED'))}
            >
              Approve
            </button>
          </div>
        ) : null
      }
    >
      {banner && detail ? (
        <p className="vf-banner-error" role="alert">
          {banner}
        </p>
      ) : null}

      {firstLoad ? (
        <div className="vf-modal-body" aria-busy="true">
          <span className="sr-only" role="status">
            Loading case
          </span>
          <div className="vf-fields" aria-hidden="true">
            {Array.from({ length: FIELD_SK }, (_, i) => (
              <div key={i} className="vf-sk vf-sk-field" />
            ))}
          </div>
          <ol className="vf-stages" aria-hidden="true">
            {Array.from({ length: STAGE_SK }, (_, i) => (
              <li key={i} className="vf-sk vf-sk-stage" />
            ))}
          </ol>
        </div>
      ) : null}

      {row && detail ? (
        <>
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
            <div>
              <dt>Carrier match</dt>
              <dd>
                {row.matchedSnapshotId
                  ? `${row.matchedVia ?? 'matched'} · ${dash(row.carrierOperatingStatus)}`
                  : 'Not found'}
              </dd>
            </div>
            <div>
              <dt>Pipeline</dt>
              <dd>
                {row.stagesDone}/{row.stagesTotal}
                {row.currentStage ? ` · ${row.currentStage.replaceAll('_', ' ')}` : ''}
              </dd>
            </div>
          </dl>

          <p className="vf-cached">
            {load.revalidating
              ? 'Refreshing stages from the credit-platform database…'
              : 'Stages refresh from the credit-platform database.'}
          </p>
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
                    <span>{status.replaceAll('_', ' ')}</span>
                    {live?.error ? <em>{live.error}</em> : null}
                  </div>
                  <div className="vf-stage-btns">
                    <button
                      type="button"
                      className="ms-btn"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act(`run:${stage.id}`, () => runVerificationCaseStage(caseId, stage.id))
                      }
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      className="ms-btn"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void act(`approve:${stage.id}`, () =>
                          approveVerificationCaseStage(caseId, stage.id),
                        )
                      }
                    >
                      Approve
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : !firstLoad && !detail ? (
        <div className="vf-empty" role="alert">
          <div className="vf-empty-title">Couldn’t open this case</div>
          <p>{load.error ?? 'The local row is still available after a retry if the credit-platform sync is down.'}</p>
          <button type="button" className="vf-btn" onClick={load.reload}>
            Try again
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}
