/**
 * The case workspace — rail on the left, one phase pane on the right.
 *
 * A RED case (intake incomplete) is readable but not workable: the panes render, the decision
 * controls do not. The desk needs to see what it is waiting on without being able to act on it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../sales/redesign/icons';
import { s } from './style';
import { PhaseRail, SkippedPane } from './PhaseRail';
import { DecisionBar, HardStopsPane, PaneShell, ScreeningPane } from './PhasePanes';
import { BankingPane, CreditPane, DecisionPane, RiskPane } from './ReviewPanes';
import {
  decidePhase,
  getDeskCase,
  runScreening,
  saveBankingReview,
  saveCreditReview,
  saveRiskAssessment,
  setScreeningVerdict,
  submitFinalDecision,
  type VerificationDeskDetail,
  type VerificationPhaseOutcome,
} from '@/api/verificationFlow';

export function CaseWorkspace({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<VerificationDeskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);

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

  const run = async (fn: () => Promise<VerificationDeskDetail>): Promise<void> => {
    setBusy(true);
    try {
      adopt(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={s('padding:40px;text-align:center;color:var(--text-muted);font-size:14px')}>Loading case…</div>;
  }
  if (!detail) {
    return (
      <div style={s('padding:24px;display:grid;gap:12px;justify-items:start')}>
        <p style={s('margin:0;color:var(--danger);font-size:14px')}>{error ?? 'Case not found.'}</p>
        <BackButton onClick={onBack} />
      </div>
    );
  }

  const active = detail.rail.find((p) => p.code === activeCode) ?? detail.rail[0];
  if (!active) return null;

  const gateOpen = detail.case.verificationProcess;
  const closed = Boolean(detail.case.closedAt);
  const canAct = gateOpen && !closed && !busy;

  const onDecide = (outcome: VerificationPhaseOutcome, note?: string): void => {
    void run(() => decidePhase(caseId, active.code, { outcome, ...(note ? { note } : {}) }));
  };

  return (
    <div style={s('display:grid;gap:18px')}>
      <div style={s('display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between')}>
        <BackButton onClick={onBack} />
        <CaseHeading detail={detail} />
      </div>

      {!gateOpen ? (
        <div
          role="status"
          style={s(
            'display:grid;gap:5px;padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--intent-danger-bd);background:var(--intent-danger-bg)',
          )}
        >
          <span style={s('display:flex;align-items:center;gap:9px;font-size:13px;font-weight:800;color:var(--danger)')}>
            <Icon name="lock" size={15} strokeWidth={2.2} />
            Waiting on Sales — {detail.case.intakeMissing?.length ?? 0} item(s) outstanding
          </span>
          <span style={s('font-size:12px;color:var(--text-secondary);line-height:1.5')}>
            The application is not complete, so it cannot be underwritten yet. You can read everything
            here, but no phase can be signed off.
          </span>
        </div>
      ) : null}

      {closed ? (
        <div
          role="status"
          style={s(
            'padding:12px 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface-alt);font-size:13px;color:var(--text-secondary)',
          )}
        >
          Decided — {detail.case.statusLabel ?? detail.case.statusCode}. This case is closed.
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={s('margin:0;padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--intent-danger-bd);background:var(--intent-danger-bg);font-size:13px;color:var(--text-primary)')}>
          {error}
        </p>
      ) : null}

      <div className="vf-workspace" style={s('display:grid;gap:20px;grid-template-columns:minmax(220px,260px) 1fr;align-items:start')}>
        <PhaseRail
          rail={detail.rail}
          activeCode={active.code}
          currentCode={detail.case.phaseCode}
          onSelect={setActiveCode}
        />
        <div style={s('min-width:0')}>
          {!active.applies ? (
            <SkippedPane phase={active} />
          ) : (
            <PaneShell
              phase={active}
              footer={
                canAct && active.code !== 'p10_decision' ? (
                  <DecisionBar onDecide={onDecide} busy={busy} />
                ) : null
              }
            >
              <PaneBody
                detail={detail}
                phaseCode={active.code}
                busy={busy}
                canAct={canAct}
                onRun={run}
                caseId={caseId}
              />
            </PaneShell>
          )}
        </div>
      </div>
    </div>
  );
}

function PaneBody({
  detail,
  phaseCode,
  busy,
  canAct,
  onRun,
  caseId,
}: {
  detail: VerificationDeskDetail;
  phaseCode: string;
  busy: boolean;
  canAct: boolean;
  onRun: (fn: () => Promise<VerificationDeskDetail>) => Promise<void>;
  caseId: string;
}) {
  switch (phaseCode) {
    case 'p3_screening':
      return (
        <ScreeningPane
          detail={detail}
          busy={busy || !canAct}
          onRun={() => void onRun(() => runScreening(caseId))}
          onVerdict={(hitId, verdict) => void onRun(() => setScreeningVerdict(caseId, hitId, { verdict }))}
        />
      );
    case 'p5_routing':
      return <RoutingPane detail={detail} />;
    case 'p6_credit_banking':
      return (
        <div style={s('display:grid;gap:24px')}>
          <ReviewOrderNote detail={detail} />
          <CreditPane detail={detail} busy={busy || !canAct} onSave={(b) => void onRun(() => saveCreditReview(caseId, b))} />
          <BankingPane detail={detail} busy={busy || !canAct} onSave={(b) => void onRun(() => saveBankingReview(caseId, b))} />
        </div>
      );
    case 'p7_hard_stops':
      return <HardStopsPane detail={detail} />;
    case 'p9_risk_capacity':
      return <RiskPane detail={detail} busy={busy || !canAct} onSave={(b) => void onRun(() => saveRiskAssessment(caseId, b))} />;
    case 'p10_decision':
      return (
        <DecisionPane
          detail={detail}
          busy={busy || !canAct}
          onDecide={(b) => void onRun(() => submitFinalDecision(caseId, b))}
        />
      );
    default:
      return <ChecklistPane detail={detail} phaseCode={phaseCode} />;
  }
}

/** Phases 1, 2, 4 and 8 are judgement calls against the application — a checklist, then a decision. */
const CHECKLISTS: Record<string, string[]> = {
  p1_intake: [
    'Application complete for the applicant type',
    'Fuel cards requested vs Octane / WEX route',
    'Documents attached or Plaid connected',
  ],
  p2_identity: [
    'Name, address and contact consistent across application and ID',
    'Bank account ownership matches the applicant',
    'Company name, EIN and principals consistent (carrier)',
    'Authority status and business / authority age',
  ],
  p4_authority: [
    'MC status active',
    'USDOT status active',
    'Operating authority and insurance current',
    'Related-company structure — Corporate Guarantee needed?',
    'Third-party carrier — signed Lease Agreement and unit info?',
  ],
  p8_highway: [
    'Safety score and alerts',
    'Fleet / truck count vs cards requested',
    'Logbook connection and connected trucks',
    'Insurance status and compliance',
    'MC/DOT operating history and authority age',
    'Reported activity consistent with Highway data',
  ],
};

function ChecklistPane({ detail, phaseCode }: { detail: VerificationDeskDetail; phaseCode: string }) {
  const items = CHECKLISTS[phaseCode] ?? [];
  return (
    <div style={s('display:grid;gap:16px')}>
      {phaseCode === 'p1_intake' ? <ApplicationFacts detail={detail} /> : null}
      {items.length > 0 ? (
        <div style={s('display:grid;gap:8px;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
          <h3 style={s('margin:0;font-size:13px;font-weight:800;color:var(--text-primary)')}>What to check</h3>
          <ul style={s('margin:0;padding-left:18px;display:grid;gap:5px')}>
            {items.map((item) => (
              <li key={item} style={s('font-size:13px;color:var(--text-secondary);line-height:1.55')}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ApplicationFacts({ detail }: { detail: VerificationDeskDetail }) {
  const c = detail.case;
  const facts: Array<[string, string]> = [
    ['Applicant type', String(c.applicantType ?? '—')],
    ['Trucks', c.trucksCount == null ? '—' : String(c.trucksCount)],
    ['Cards requested', c.fuelCardsRequested == null ? '—' : String(c.fuelCardsRequested)],
    ['Requested limit', c.requestedLimit ? `$${c.requestedLimit}` : '—'],
    ['EIN', String((c.ein as string) ?? '—')],
    ['MC', String((c.mc as string) ?? '—')],
    ['USDOT', String((c.dot as string) ?? '—')],
    ['Principals', String(detail.principals.length)],
    ['Documents', String(detail.documents.filter((d) => d.status === 'received').length)],
  ];
  return (
    <dl style={s('margin:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(150px,100%),1fr));padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
      {facts.map(([label, value]) => (
        <div key={label} style={s('display:grid;gap:3px')}>
          <dt style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)')}>
            {label}
          </dt>
          <dd style={s('margin:0;font-size:14px;font-weight:700;color:var(--text-primary)')}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RoutingPane({ detail }: { detail: VerificationDeskDetail }) {
  const { routing } = detail;
  const bankFirst = routing.reviewOrder === 'banking_first';
  return (
    <div style={s('display:grid;gap:14px')}>
      <div style={s('display:grid;gap:6px;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
        <span style={s('font-size:13px;font-weight:800;color:var(--text-primary)')}>
          {bankFirst ? 'Banking review first, then credit' : 'Credit review first, then banking'}
        </span>
        <span style={s('font-size:12px;color:var(--text-muted);line-height:1.55')}>
          {bankFirst
            ? `A carrier with ${routing.bankFirstTruckMin}+ trucks is reviewed banking-first.`
            : `Owner-operators and carriers under ${routing.bankFirstTruckMin} trucks are reviewed credit-first.`}
        </span>
      </div>
      <div style={s('display:grid;gap:6px;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}>
        <span style={s('font-size:13px;font-weight:800;color:var(--text-primary)')}>
          {routing.underwritingRoute === 'wex' ? 'WEX underwriting route' : 'Octane internal underwriting'}
        </span>
        <span style={s('font-size:12px;color:var(--text-muted);line-height:1.55')}>
          {routing.underwritingRoute === 'wex'
            ? `Over ${routing.wexCardCutoff} fuel cards requested.`
            : `Up to ${routing.wexCardCutoff} fuel cards requested.`}
        </span>
      </div>
      <p style={s('margin:0;font-size:12px;color:var(--text-muted);line-height:1.55')}>
        Both reviews must be completed before the final risk assessment unless the applicant is declined
        earlier.
      </p>
    </div>
  );
}

function ReviewOrderNote({ detail }: { detail: VerificationDeskDetail }) {
  return (
    <p style={s('margin:0;font-size:12px;font-weight:700;color:var(--accent)')}>
      {detail.routing.reviewOrder === 'banking_first'
        ? 'Banking first for this applicant.'
        : 'Credit first for this applicant.'}
    </p>
  );
}

function CaseHeading({ detail }: { detail: VerificationDeskDetail }) {
  const c = detail.case;
  const name = c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Application';
  return (
    <div style={s('display:grid;gap:2px;text-align:right')}>
      <span style={s('font-size:16px;font-weight:800;color:var(--text-primary)')}>{name}</span>
      <span style={s('font-size:12px;color:var(--text-muted)')}>{c.statusLabel ?? c.statusCode}</span>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={s(
        'display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);font-size:13px;font-weight:700;cursor:pointer',
      )}
    >
      <Icon name="chevronLeft" size={15} strokeWidth={2.2} />
      All applicants
    </button>
  );
}
