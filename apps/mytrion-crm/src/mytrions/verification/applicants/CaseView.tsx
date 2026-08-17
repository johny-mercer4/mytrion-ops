/**
 * The applicant case — breadcrumb, identity, the ten-phase spine, and one phase at a time.
 *
 * SHAPE FROM THE DESIGN, BODIES FROM THE PRODUCT. The chrome here is the new design exactly: the
 * breadcrumb bar, the mono identity tile and fact strip, the locked banner, the horizontal spine
 * with its progress line, and the phase section split into a working pane and an aside. What the
 * design could not specify is the INSIDE of that working pane for the six phases that carry real
 * forms — screening verdicts, the credit and banking reviews, hard stops, the risk assessment and
 * the final decision are the desk's actual write surface, and the mock had two sample cases and
 * four generic pane variants. Those panes (`../flow/*`) keep their behaviour and are rendered into
 * the design's slot; the design's own variants cover intake, the recorded-so-far summary and the
 * not-applicable state.
 *
 * A RED case (intake incomplete) is readable but not decidable: every pane renders, the decision
 * bar does not. The desk must see what it is waiting on without being able to sign it off.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Icon, Skeleton, SkeletonRegion, type BadgeIntent, type IconName } from '@/ds';
import {
  decidePhase,
  getDeskCase,
  getPolicy,
  patchDeskIntake,
  requestDocuments,
  runScreening,
  saveBankingReview,
  saveCreditReview,
  saveRiskAssessment,
  setScreeningVerdict,
  submitFinalDecision,
  type VerificationDeskDetail,
  type VerificationPhaseOutcome,
  type VerificationRailPhase,
} from '@/api/verificationFlow';
import { useCachedLoad } from '../../_shared/swrCache';
import { HardStopsPane, ScreeningPane } from '../flow/PhasePanes';
import { BankingPane, CreditPane, DecisionPane, RiskPane } from '../flow/ReviewPanes';
import '../flow/verificationFlow.css';
import { CaseAside } from './CaseAside';
import { IntakePane, RecordedPane, ReviewSummary, SkippedPane } from './CasePanes';
import {
  APPLICANT_LABEL,
  caseInitials,
  caseName,
  PHASE_SHORT,
  PHASE_STATE_LABEL,
  routeLabel,
  routeOf,
  STATUS_LABEL,
} from './applicantsModel';
import './applicants.css';
import './applicantsCase.css';

/** Phase state → chip treatment. Each intent carries a glyph, so tone is never colour alone. */
const STATE_CHIP: Record<string, { intent: BadgeIntent; icon: IconName }> = {
  passed: { intent: 'success', icon: 'check_circle' },
  in_progress: { intent: 'info', icon: 'bolt' },
  not_started: { intent: 'neutral', icon: 'schedule' },
  pending_docs: { intent: 'warning', icon: 'cloud_upload' },
  manager_review: { intent: 'warning', icon: 'gavel' },
  failed: { intent: 'danger', icon: 'block' },
  skipped: { intent: 'neutral', icon: 'block' },
};

function statusChipFor(statusCode: string, locked: boolean): { intent: BadgeIntent; icon: IconName } {
  if (locked) return { intent: 'danger', icon: 'lock' };
  if (statusCode.startsWith('declined')) return { intent: 'danger', icon: 'block' };
  if (statusCode === 'approved' || statusCode === 'deposit_prepaid') {
    return { intent: 'success', icon: 'check_circle' };
  }
  if (statusCode === 'manager_review' || statusCode === 'additional_verification') {
    return { intent: 'warning', icon: 'gavel' };
  }
  if (statusCode === 'pending_docs') return { intent: 'warning', icon: 'cloud_upload' };
  return { intent: 'info', icon: 'bolt' };
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function moneyOrNull(value: unknown): string | null {
  const raw = text(value);
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

export function CaseView({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<VerificationDeskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

  // Same cache key the queue warms, so the NSF threshold is already in hand on arrival.
  const loadPolicy = useCallback(() => getPolicy(), []);
  const policy = useCachedLoad('verification:flow:policy', loadPolicy, { staleMs: 60 * 60_000 });
  const nsfThreshold = policy.data?.nsfReviewThreshold ?? null;
  const wexCardCutoff = policy.data?.wexCardCutoff ?? null;

  const adopt = useCallback((next: VerificationDeskDetail) => {
    setDetail(next);
    // Follow the case forward when it advances, but never yank the reviewer off a pane they chose.
    setActiveCode((current) => current ?? next.case.phaseCode);
    setError(null);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    getDeskCase(caseId)
      .then((d) => live && adopt(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load the case.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [caseId, adopt]);

  const run = useCallback(
    async (fn: () => Promise<VerificationDeskDetail>): Promise<void> => {
      setBusy(true);
      try {
        adopt(await fn());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That action could not be completed.');
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const active: VerificationRailPhase | null = useMemo(() => {
    if (!detail) return null;
    return detail.rail.find((p) => p.code === activeCode) ?? detail.rail[0] ?? null;
  }, [detail, activeCode]);

  if (loading) {
    return (
      <SkeletonRegion busy label="Loading the application" className="va-case">
        <Skeleton variant="rect" height="112px" radius="panel" />
        <Skeleton variant="rect" height="104px" radius="panel" />
        <Skeleton variant="rect" height="420px" radius="panel" />
      </SkeletonRegion>
    );
  }

  if (!detail || !active) {
    return (
      <div className="va-case">
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-title">Could not open this application</span>
          <p className="va-banner-body">{error ?? 'The case could not be found.'}</p>
        </div>
        <Button variant="secondary" icon="chevron_left" onClick={onBack}>
          All applicants
        </Button>
      </div>
    );
  }

  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const locked = !c.verificationProcess;
  const closed = Boolean(c.closedAt);
  const canAct = !locked && !closed && !busy;
  const name = caseName(c);
  const missing = c.intakeMissing?.length ?? 0;
  const statusText = STATUS_LABEL[c.statusCode] ?? c.statusCode;
  const chip = statusChipFor(c.statusCode, locked);
  const state = active.status;
  const stateChip = STATE_CHIP[state] ?? STATE_CHIP.not_started!;

  const passed = detail.rail.filter((p) => p.status === 'passed').length;
  const notApplicable = detail.rail.filter((p) => !p.applies || p.status === 'skipped').length;
  const remaining = detail.rail.length - passed - notApplicable;

  const facts: Array<{ k: string; v: string | null }> = [
    { k: 'EIN', v: text(c.ein) },
    { k: 'MC', v: text(c.mc) },
    { k: 'USDOT', v: text(c.dot) },
    { k: 'Trucks', v: c.trucksCount == null ? null : String(c.trucksCount) },
    { k: 'Cards requested', v: c.fuelCardsRequested == null ? null : String(c.fuelCardsRequested) },
    { k: 'Requested limit', v: moneyOrNull(c.requestedLimit) },
  ];

  const onDecide = (outcome: VerificationPhaseOutcome, note?: string): void => {
    void run(() => decidePhase(caseId, active.code, { outcome, ...(note ? { note } : {}) }));
  };

  return (
    <div className="va-case">
      <section className="va-case-head" data-locked={locked}>
        <div className="va-crumbs">
          <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
            All applicants
          </Button>
          <span className="va-crumb">New applicants</span>
          <Icon name="chevron_right" size="sm" className="va-crumb-sep" />
          <span className="va-crumb-current">{name}</span>
          <span className="va-crumbs-gap" />
          <span className="va-case-id num">CASE {c.id}</span>
        </div>

        <div className="va-case-identity">
          <div className="va-case-who">
            <span className="va-case-mono" data-locked={locked} aria-hidden="true">
              {caseInitials(c)}
            </span>
            <div className="va-case-titles">
              <div className="va-case-title-row">
                <h1 className="va-case-name">{name}</h1>
                <Badge intent={chip.intent} icon={chip.icon}>
                  {statusText}
                </Badge>
              </div>
              <div className="va-case-facts">
                {facts.map((f) => (
                  <span className="va-fact" key={f.k}>
                    <span className="t-eyebrow">{f.k}</span>
                    <span className="va-fact-v num" data-empty={f.v == null}>
                      {f.v ?? 'Not recorded'}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="va-case-meta">
            <div className="va-case-meta-line">
              <span>
                Owner <strong>{c.ownerName}</strong>
              </span>
              <span className="va-meta-sep" aria-hidden="true" />
              <span>
                Opened{' '}
                <strong className="num">
                  {new Date(c.createdAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                  })}
                </strong>
              </span>
            </div>
            <div className="va-case-meta-line">
              <span>
                {APPLICANT_LABEL[c.applicantType ?? ''] ?? 'Type not set'} ·{' '}
                {routeLabel(routeOf(c, wexCardCutoff))}
              </span>
            </div>
          </div>
        </div>
      </section>

      {locked ? (
        <div className="va-banner" data-tone="danger" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="lock" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">
              {missing > 0
                ? `Waiting on Sales — ${missing} item${missing === 1 ? '' : 's'} outstanding`
                : 'Waiting on Sales — intake not started'}
            </span>
            <span className="va-banner-body">
              The application is not complete, so it cannot be signed off. You can still read and
              correct the details below — anything you fix here counts toward completing it.
            </span>
          </span>
        </div>
      ) : null}

      {closed ? (
        <div className="va-banner" data-tone="success" role="status">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="check_circle" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">Decided — {statusText}</span>
            <span className="va-banner-body">
              This case is closed. Its file stays readable as the evidence for the decision, and can
              no longer be edited.
            </span>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="va-banner" data-tone="danger" role="alert">
          <span className="va-banner-glyph" aria-hidden="true">
            <Icon name="error" size="sm" />
          </span>
          <span className="va-banner-text">
            <span className="va-banner-title">That action could not be completed</span>
            <span className="va-banner-body">{error}</span>
          </span>
        </div>
      ) : null}

      <PhaseSpine
        rail={detail.rail}
        activeCode={active.code}
        passed={passed}
        remaining={remaining}
        notApplicable={notApplicable}
        onPick={setActiveCode}
      />

      <section className="va-phase">
        <header className="va-phase-head">
          <div className="va-phase-titles">
            <span className="t-eyebrow va-phase-kicker">
              Phase <span className="num">{active.order}</span> of 10
            </span>
            <h2 className="va-phase-title">{active.label}</h2>
            <p className="va-phase-desc">{active.description}</p>
          </div>
          <Badge intent={stateChip.intent} icon={stateChip.icon}>
            {PHASE_STATE_LABEL[state]}
          </Badge>
        </header>

        <div className="va-phase-body">
          <div className="va-phase-main">
            {!active.applies ? (
              <SkippedPane phase={active} />
            ) : (
              <PhaseBody
                detail={detail}
                phase={active}
                caseId={caseId}
                busy={busy}
                canAct={canAct}
                nsfThreshold={nsfThreshold}
                wexCardCutoff={wexCardCutoff}
                onRun={run}
              />
            )}
          </div>

          <CaseAside
            detail={detail}
            caseId={caseId}
            phase={active}
            canAct={canAct}
            busy={busy}
            onRequestDocs={(items, note) =>
              void run(() =>
                requestDocuments(caseId, { phaseCode: active.code, items, ...(note ? { note } : {}) }),
              )
            }
          />
        </div>

        <footer className="va-decide">
          <span className="va-decide-note" data-tone={locked || closed ? 'muted' : 'plain'}>
            <Icon name={locked || closed ? 'lock' : 'shield'} size="sm" />
            {locked
              ? 'Decisions are locked while intake is incomplete. Correct what you can above; Sales owns the rest.'
              : closed
                ? 'This case is decided. Its phase history stays readable and cannot be changed.'
                : `Signing off ${PHASE_SHORT[active.code] ?? 'this phase'} advances the case to phase ${Math.min(10, active.order + 1)}. Every action is written to the audit trail.`}
          </span>
          <div className="va-decide-actions">
            <Button
              variant="primary"
              icon="check"
              loading={busy}
              disabled={!canAct || !active.applies}
              onClick={() => onDecide('pass')}
            >
              Pass phase
            </Button>
            <Button
              variant="secondary"
              icon="gavel"
              loading={busy}
              disabled={!canAct}
              onClick={() => onDecide('manager_review')}
            >
              Send to manager
            </Button>
            <Button
              variant="danger"
              icon="block"
              loading={busy}
              disabled={!canAct}
              onClick={() => onDecide('decline')}
            >
              Decline
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

/**
 * The ten-phase spine.
 *
 * A horizontal `<ol>` of buttons over one progress line. The line is drawn to the LAST PASSED
 * phase, not to the active one — the reviewer can look back at a signed-off phase without the
 * progress bar claiming the case moved backwards.
 */
function PhaseSpine({
  rail,
  activeCode,
  passed,
  remaining,
  notApplicable,
  onPick,
}: {
  rail: readonly VerificationRailPhase[];
  activeCode: string;
  passed: number;
  remaining: number;
  notApplicable: number;
  onPick: (code: string) => void;
}) {
  const lastPassed = rail.reduce((acc, p, i) => (p.status === 'passed' ? i : acc), -1);
  const pct = rail.length <= 1 ? 0 : Math.max(0, (lastPassed / (rail.length - 1)) * 100);

  return (
    <section className="va-spine" aria-label="Underwriting phases">
      <div className="va-spine-head">
        <span className="t-eyebrow">Underwriting phases</span>
        <span className="va-spine-counts">
          <span>
            <strong className="num" data-tone="ok">
              {passed}
            </strong>{' '}
            passed
          </span>
          <span>
            <strong className="num">{remaining}</strong> remaining
          </span>
          <span>
            <strong className="num" data-tone="off">
              {notApplicable}
            </strong>{' '}
            not applicable
          </span>
        </span>
      </div>

      <div className="va-spine-track">
        <span className="va-spine-line" aria-hidden="true">
          <span className="va-spine-fill" style={{ width: `${pct}%` }} />
        </span>
        <ol className="va-steps">
          {rail.map((p) => {
            const isActive = p.code === activeCode;
            const state = p.applies ? p.status : 'skipped';
            return (
              <li key={p.code}>
                <button
                  type="button"
                  className="va-step"
                  data-state={state}
                  data-active={isActive}
                  aria-current={isActive ? 'step' : undefined}
                  title={`${p.label} — ${PHASE_STATE_LABEL[state]}`}
                  onClick={() => onPick(p.code)}
                >
                  <span className="va-step-dot" aria-hidden="true">
                    {state === 'passed' ? (
                      <Icon name="check" size="sm" />
                    ) : (
                      <span className="num">{p.order}</span>
                    )}
                  </span>
                  <span className="va-step-text">
                    <span className="va-step-label">{PHASE_SHORT[p.code] ?? p.label}</span>
                    <span className="va-step-state">{PHASE_STATE_LABEL[state]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/**
 * The working pane for the active phase.
 *
 * Phases 3, 6, 7, 9 and 10 carry the desk's real write surface and keep their existing panes; 1 is
 * the design's editable application; everything else is the design's recorded-so-far summary with
 * the checklist in the aside beside it.
 */
function PhaseBody({
  detail,
  phase,
  caseId,
  busy,
  canAct,
  nsfThreshold,
  wexCardCutoff,
  onRun,
}: {
  detail: VerificationDeskDetail;
  phase: VerificationRailPhase;
  caseId: string;
  busy: boolean;
  canAct: boolean;
  nsfThreshold: number | null;
  wexCardCutoff: number | null;
  onRun: (fn: () => Promise<VerificationDeskDetail>) => Promise<void>;
}) {
  switch (phase.code) {
    case 'p1_intake':
      return (
        <IntakePane
          detail={detail}
          wexCardCutoff={wexCardCutoff}
          // Corrections stay open right up until the case is decided — see deskService.patchIntake.
          closed={Boolean(detail.case.closedAt)}
          busy={busy}
          onSave={(body) => onRun(() => patchDeskIntake(caseId, body))}
        />
      );
    case 'p3_screening':
      return (
        <ScreeningPane
          detail={detail}
          busy={busy || !canAct}
          onRun={() => void onRun(() => runScreening(caseId))}
          onVerdict={(hitId, verdict) => void onRun(() => setScreeningVerdict(caseId, hitId, { verdict }))}
        />
      );
    case 'p6_credit_banking':
      return (
        <div className="va-stack">
          <ReviewSummary detail={detail} nsfThreshold={nsfThreshold} />
          <CreditPane
            detail={detail}
            busy={busy}
            disabled={!canAct}
            onSave={(b) => void onRun(() => saveCreditReview(caseId, b))}
          />
          <BankingPane
            detail={detail}
            busy={busy}
            disabled={!canAct}
            onSave={(b) => void onRun(() => saveBankingReview(caseId, b))}
          />
        </div>
      );
    case 'p7_hard_stops':
      return <HardStopsPane detail={detail} />;
    case 'p9_risk_capacity':
      return (
        <RiskPane
          detail={detail}
          busy={busy}
          disabled={!canAct}
          onSave={(b) => void onRun(() => saveRiskAssessment(caseId, b))}
        />
      );
    case 'p10_decision':
      return (
        <DecisionPane
          detail={detail}
          busy={busy}
          disabled={!canAct}
          onDecide={(b) => void onRun(() => submitFinalDecision(caseId, b))}
        />
      );
    default:
      return <RecordedPane detail={detail} phase={phase} wexCardCutoff={wexCardCutoff} />;
  }
}
