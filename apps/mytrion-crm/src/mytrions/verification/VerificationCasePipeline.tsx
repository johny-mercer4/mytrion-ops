import { Button } from '../../ds/Button/Button';
import {
  approveVerificationCaseStage,
  getVerificationCase,
  resetVerificationCaseStage,
  runVerificationCaseStage,
  runVerificationIsoftpullAll,
  startVerificationFirstRun,
  type VerificationCaseDetail,
  type VerificationCaseStageRow,
} from '../../api/verificationCases';
import { ISOFTPULL_BUREAUS } from './verificationCaseDesk';
import {
  billableRunGate,
  groupStageCatalog,
  humanizeToken,
  stageDisplay,
  stageGroup,
} from './verificationCaseUi';

export function VerificationCasePipeline({
  caseId,
  detail,
  busy,
  onAct,
}: {
  caseId: string;
  detail: VerificationCaseDetail;
  busy: string | null;
  onAct: (label: string, fn: () => Promise<VerificationCaseDetail>) => Promise<void>;
}) {
  const groups = groupStageCatalog(detail.catalog);
  const readinessAvailable = Boolean(detail.readiness);
  const firstRunBusy = detail.case.firstRunStatus === 'in_flight' || busy === 'first-run';

  return (
    <>
      {groups.map((group) => (
        <section
          key={group.id}
          className={`vf-stage-group is-${group.id}${group.id === 'auto' && firstRunBusy ? ' is-live' : ''}`}
        >
          <div className="vf-stage-group-head">
            <div>
              <h4 className="vf-stage-group-title">{group.title}</h4>
              <p className="vf-stage-group-hint">{group.hint}</p>
            </div>
            {group.id === 'auto' ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={Boolean(busy) || !detail.case.requestId || firstRunBusy}
                loading={busy === 'first-run'}
                onClick={() =>
                  void onAct('first-run', async () => {
                    await startVerificationFirstRun(caseId);
                    return getVerificationCase(caseId);
                  })
                }
              >
                Start first run
              </Button>
            ) : null}
          </div>
          <ol className="vf-stages">
            {group.stages.map((stage) => {
              const live = detail.stages.find((row) => row.stageId === stage.id);
              return (
                <StageRow
                  key={stage.id}
                  caseId={caseId}
                  stage={stage}
                  live={live}
                  busy={busy}
                  readinessAvailable={readinessAvailable}
                  readiness={detail.readiness?.stages[stage.id] ?? null}
                  plaidMode={detail.case.plaidMode ?? null}
                  firstRunStatus={detail.case.firstRunStatus}
                  onAct={onAct}
                />
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}

function StageRow({
  caseId,
  stage,
  live,
  busy,
  readinessAvailable,
  readiness,
  plaidMode,
  firstRunStatus,
  onAct,
}: {
  caseId: string;
  stage: { id: string; label: string; order: number };
  live: VerificationCaseStageRow | undefined;
  busy: string | null;
  readinessAvailable: boolean;
  readiness: {
    ready: boolean;
    missing: string[];
    paid: boolean;
    alreadyPaid?: boolean;
    circuitOpen?: boolean;
  } | null;
  plaidMode: string | null;
  firstRunStatus: string | null | undefined;
  onAct: (label: string, fn: () => Promise<VerificationCaseDetail>) => Promise<void>;
}) {
  const status = live?.status ?? 'pending';
  const display = stageDisplay({ status, result: live?.result, error: live?.error });
  const gate = billableRunGate({
    stageId: stage.id,
    readiness,
    readinessAvailable,
    ...(plaidMode ? { plaidMode } : {}),
  });
  const runBlocked = Boolean(busy) || gate.blocked;
  const auto = stageGroup(stage.id) === 'auto';
  const { stepStatus } = live ? { stepStatus: String(live.result.step_status ?? '').trim() } : { stepStatus: '' };
  const runTitle = gate.reason ?? (auto ? 'HTTP Run claims the case. First run does not.' : undefined);
  const showAutoRun = !auto || firstRunStatus === 'completed' || firstRunStatus === 'error';

  return (
    <li className={`vf-stage ${display.tone}`}>
      <div>
        <strong>
          {stage.order}. {stage.label}
        </strong>
        <span>{display.label}</span>
        {stepStatus && display.label.toLowerCase() !== stepStatus.toLowerCase() ? (
          <span>Step {humanizeToken(stepStatus)}</span>
        ) : null}
        {display.note ? <em>{display.note}</em> : null}
        {gate.reason ? <em>{gate.reason}</em> : null}
        {auto && !gate.reason ? <em>Start first run above — it does not claim the case.</em> : null}
      </div>
      <div className="vf-stage-btns">
        {showAutoRun ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={runBlocked}
            aria-disabled={gate.blocked || undefined}
            title={runTitle}
            onClick={() => void onAct(`run:${stage.id}`, () => runVerificationCaseStage(caseId, stage.id))}
          >
            Run
          </Button>
        ) : null}
        {stage.id === 'isoftpull' ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={runBlocked}
              title={gate.reason ?? undefined}
              onClick={() => void onAct('isoftpull-all', () => runVerificationIsoftpullAll(caseId))}
            >
              Run all
            </Button>
            <details className="vf-bureaus">
              <summary>Bureaus</summary>
              {ISOFTPULL_BUREAUS.map((bureau) => (
                <Button
                  key={bureau.id}
                  variant="ghost"
                  size="sm"
                  disabled={runBlocked}
                  title={gate.reason ?? undefined}
                  onClick={() =>
                    void onAct(`run:${stage.id}:${bureau.id}`, () =>
                      runVerificationCaseStage(caseId, stage.id, { bureauProvider: bureau.id }),
                    )
                  }
                >
                  {bureau.label}
                </Button>
              ))}
            </details>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => void onAct(`approve:${stage.id}`, () => approveVerificationCaseStage(caseId, stage.id))}
        >
          Approve
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => void onAct(`reset:${stage.id}`, () => resetVerificationCaseStage(caseId, stage.id))}
        >
          Reset
        </Button>
      </div>
    </li>
  );
}
