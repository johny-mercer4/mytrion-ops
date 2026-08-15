/**
 * The case workspace — rail on the left, one phase pane on the right.
 *
 * A RED case (intake incomplete) is readable but not workable: the panes render, the decision
 * controls do not. The desk needs to see what it is waiting on without being able to act on it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../sales/redesign/icons';
import { s } from './style';
import './verificationFlow.css';
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
  patchApplication,
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
    // One loader, shaped like the workspace it becomes — rail beside pane, so the layout does not
    // jump when the data lands.
    return (
      <div aria-busy="true" style={s('display:grid;gap:18px')}>
        <span className="sr-only" role="status">
          Loading application
        </span>
        <div
          aria-hidden="true"
          className="vf-workspace"
          style={s('display:grid;gap:20px;grid-template-columns:minmax(220px,260px) 1fr;align-items:start')}
        >
          <div style={s('display:grid;gap:6px')}>
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="vf-sk" style={s('height:44px;border-radius:var(--radius-md)')} />
            ))}
          </div>
          <div style={s('display:grid;gap:14px')}>
            <span className="vf-sk" style={s('height:22px;width:44%;border-radius:var(--radius-sm)')} />
            <span className="vf-sk" style={s('height:13px;width:72%;border-radius:var(--radius-sm)')} />
            <span className="vf-sk" style={s('height:150px;border-radius:var(--radius-md)')} />
          </div>
        </div>
      </div>
    );
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
        <div className="vfx-banner" data-tone="bad" role="status">
          <span className="vfx-banner-title">
            <Icon name="lock" size={14} strokeWidth={2.2} />
            {(detail.case.intakeMissing?.length ?? 0) > 0
              ? `Waiting on Sales — ${detail.case.intakeMissing.length} item(s) outstanding`
              : 'Waiting on Sales — intake not started'}
          </span>
          <p className="vfx-banner-body">
            The application is not complete, so it cannot be signed off. You can still read and
            correct the details below — anything you fix here counts toward completing it.
          </p>
        </div>
      ) : null}

      {closed ? (
        <div className="vfx-banner" data-tone="ok" role="status">
          <span className="vfx-banner-title">Decided — {detail.case.statusLabel ?? 'closed'}</span>
          <p className="vfx-banner-body">This case is closed and can no longer be worked.</p>
        </div>
      ) : null}

      {error ? (
        <div className="vfx-banner" data-tone="bad" role="alert">
          <span className="vfx-banner-title">That action could not be completed</span>
          <p className="vfx-banner-body">{error}</p>
        </div>
      ) : null}

      <div className="vfx-workspace">
        <PhaseRail
          rail={detail.rail}
          activeCode={active.code}
          currentCode={detail.case.phaseCode}
          onSelect={setActiveCode}
        />
        <div className="vfx-pane">
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
                onSaved={() => void run(() => getDeskCase(caseId))}
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
  onSaved,
}: {
  detail: VerificationDeskDetail;
  phaseCode: string;
  busy: boolean;
  canAct: boolean;
  onRun: (fn: () => Promise<VerificationDeskDetail>) => Promise<void>;
  caseId: string;
  onSaved: () => void;
}) {
  // Sales-owned intake stays editable for the desk right up until the case is decided — a credit
  // agent on the phone is often the first to learn a detail was mistyped.
  const canEdit = !detail.case.closedAt;
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
      return (
        <ChecklistPane
          detail={detail}
          phaseCode={phaseCode}
          caseId={caseId}
          canEdit={canEdit}
          onSaved={onSaved}
        />
      );
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

function ChecklistPane({
  detail,
  phaseCode,
  caseId,
  canEdit,
  onSaved,
}: {
  detail: VerificationDeskDetail;
  phaseCode: string;
  caseId: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const items = CHECKLISTS[phaseCode] ?? [];
  return (
    <div style={s('display:grid;gap:16px')}>
      {phaseCode === 'p1_intake' ? (
        <ApplicationFacts detail={detail} caseId={caseId} canEdit={canEdit} onSaved={onSaved} />
      ) : null}
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

/**
 * Phase 1 — the application itself, EDITABLE.
 *
 * The desk used to get a read-only grid of em-dashes, which is a poor deal: the credit agent is on
 * the phone with the applicant and is the person most likely to learn that the EIN was mistyped.
 * They can correct any of it here, at any phase, and the server re-evaluates completeness on save —
 * so a fix made during underwriting can be what finally turns the application green.
 */
function ApplicationFacts({
  detail,
  caseId,
  canEdit,
  onSaved,
}: {
  detail: VerificationDeskDetail;
  caseId: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const c = detail.case;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const field = (k: string, fallback: unknown): string =>
    draft[k] ?? (fallback == null ? '' : String(fallback));
  const set = (k: string) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };

  const dirty = Object.keys(draft).length > 0;

  const FIELDS: Array<{ k: string; label: string; value: unknown; numeric?: boolean }> = [
    { k: 'companyName', label: 'Company', value: c.companyName },
    { k: 'firstName', label: 'First name', value: c.firstName },
    { k: 'lastName', label: 'Last name', value: c.lastName },
    { k: 'ein', label: 'EIN', value: (c as Record<string, unknown>).ein },
    { k: 'mc', label: 'MC number', value: (c as Record<string, unknown>).mc },
    { k: 'dot', label: 'USDOT', value: (c as Record<string, unknown>).dot },
    { k: 'email', label: 'Email', value: c.email },
    { k: 'phone', label: 'Phone', value: c.phone },
    { k: 'trucksCount', label: 'Trucks', value: c.trucksCount, numeric: true },
    { k: 'fuelCardsRequested', label: 'Cards requested', value: c.fuelCardsRequested, numeric: true },
    { k: 'requestedLimit', label: 'Requested limit', value: c.requestedLimit, numeric: true },
  ];

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) {
        const meta = FIELDS.find((f) => f.k === k);
        body[k] = v.trim() === '' ? null : meta?.numeric ? Number(v) : v;
      }
      await patchApplication(caseId, body);
      setDraft({});
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save those changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vfx-card">
      <h3 className="vfx-card-title">Application</h3>
      <div className="vfx-facts">
        {FIELDS.map((f) => {
          const id = `vfx-${f.k}`;
          const value = field(f.k, f.value);
          return (
            <div className="vfx-field" key={f.k}>
              <label className="vfx-label" htmlFor={id}>
                {f.label}
              </label>
              {canEdit ? (
                <input
                  id={id}
                  className="vfx-input"
                  value={value}
                  inputMode={f.numeric ? 'decimal' : 'text'}
                  placeholder="Not recorded"
                  onChange={(e) => set(f.k)(e.currentTarget.value)}
                />
              ) : (
                <p className="vfx-fact-v" data-empty={value === ''}>
                  {value === '' ? 'Not recorded' : value}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="vfx-facts">
        <div className="vfx-fact">
          <span className="vfx-fact-k">Principals</span>
          <p className="vfx-fact-v" data-empty={detail.principals.length === 0}>
            {detail.principals.length || 'None'}
          </p>
        </div>
        <div className="vfx-fact">
          <span className="vfx-fact-k">Documents</span>
          <p
            className="vfx-fact-v"
            data-empty={detail.documents.filter((d) => d.status === 'received').length === 0}
          >
            {detail.documents.filter((d) => d.status === 'received').length || 'None'}
          </p>
        </div>
      </div>

      {err ? (
        <div className="vfx-banner" data-tone="bad" role="alert">
          <p className="vfx-banner-body">{err}</p>
        </div>
      ) : null}

      {canEdit ? (
        <div className="vfx-actions">
          <button
            type="button"
            className="vfx-act"
            data-kind="primary"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : saved ? 'Saved' : 'Save corrections'}
          </button>
          {dirty ? (
            <button type="button" className="vfx-act" onClick={() => setDraft({})} disabled={busy}>
              Discard
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
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
      <span className="vfx-pill">{c.statusLabel ?? 'In review'}</span>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="vfx-act"
    >
      <Icon name="chevronLeft" size={15} strokeWidth={2.2} />
      All applicants
    </button>
  );
}
