/**
 * Phase 6, 9 and 10 panes — the forms that carry the money.
 *
 * Two rules the UI keeps visible rather than hiding:
 *   - Average weekly net cash flow is NOT an input. It is shown as a live preview of what the
 *     server will derive, so the analyst can see their own arithmetic before saving.
 *   - Fuel must be a component of recurring expenses. The form says so where fuel is entered,
 *     because the server refuses the save otherwise and a rejection with no explanation is worse
 *     than the rule itself.
 */
import { useState } from 'react';
import { s } from '../../sales/redesign/dc';
import { Field, SelectField } from '../../sales/redesign/applicationFields';
import { Figure, FigureRow } from './PhasePanes';
import type {
  VerificationDeskDetail,
  VerificationFinalDecision,
  VerificationRiskTier,
} from '@/api/verificationFlow';

const BTN_PRIMARY =
  'height:40px;padding:0 20px;border-radius:var(--radius-md);border:none;background:var(--accent);color:var(--on-accent);font-size:13px;font-weight:800;cursor:pointer';
const BTN_DISABLED =
  'height:40px;padding:0 20px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-size:13px;font-weight:800;cursor:not-allowed';

type Draft = Record<string, string>;

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function toBody(draft: Draft, keys: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    const value = draft[key];
    if (value === undefined || value.trim() === '') continue;
    body[key] = Number.isNaN(Number(value)) ? value : Number(value);
  }
  return body;
}

const CREDIT_NUMERIC = [
  'creditScore',
  'latePayments',
  'collections',
  'utilizationPct',
  'inquiries12m',
  'historyMonths',
  'openAccounts',
  'totalDebt',
  'revolvingAccounts',
  'autoLoans',
  'mortgages',
];

export function CreditPane({
  detail,
  busy,
  onSave,
}: {
  detail: VerificationDeskDetail;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const existing = detail.credit;
  const [draft, setDraft] = useState<Draft>(() => ({
    creditScore: existing?.creditScore == null ? '' : String(existing.creditScore),
    latePayments: existing?.latePayments == null ? '' : String(existing.latePayments),
    collections: existing?.collections == null ? '' : String(existing.collections),
    utilizationPct: existing?.utilizationPct ?? '',
    inquiries12m: existing?.inquiries12m == null ? '' : String(existing.inquiries12m),
    historyMonths: existing?.historyMonths == null ? '' : String(existing.historyMonths),
    openAccounts: existing?.openAccounts == null ? '' : String(existing.openAccounts),
    totalDebt: existing?.totalDebt ?? '',
    revolvingAccounts: existing?.revolvingAccounts == null ? '' : String(existing.revolvingAccounts),
    autoLoans: existing?.autoLoans == null ? '' : String(existing.autoLoans),
    mortgages: existing?.mortgages == null ? '' : String(existing.mortgages),
    repaymentBehavior: existing?.repaymentBehavior ?? '',
    recentTrend: existing?.recentTrend ?? 'stable',
    outcome: existing?.outcome ?? 'pass',
  }));
  const [noHit, setNoHit] = useState(existing?.bureauNoHit ?? false);
  const set = (k: string) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div style={s('display:grid;gap:16px')}>
      <label
        style={s(
          'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);cursor:pointer',
        )}
      >
        <input type="checkbox" checked={noHit} onChange={(e) => setNoHit(e.currentTarget.checked)} />
        <span style={s('display:grid;gap:2px')}>
          <span style={s('font-size:13px;font-weight:800;color:var(--text)')}>
            No information found in the credit bureau
          </span>
          <span style={s('font-size:12px;color:var(--muted)')}>
            A hard stop — rules out a standard unsecured line.
          </span>
        </span>
      </label>

      {!noHit ? (
        <div style={s('display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))')}>
          <Field label="Credit score" name="creditScore" value={draft.creditScore ?? ''} onChange={set('creditScore')} inputMode="numeric" />
          <Field label="Late payments" name="latePayments" value={draft.latePayments ?? ''} onChange={set('latePayments')} inputMode="numeric" />
          <Field label="Collections" name="collections" value={draft.collections ?? ''} onChange={set('collections')} inputMode="numeric" />
          <Field label="Utilisation %" name="utilizationPct" value={draft.utilizationPct ?? ''} onChange={set('utilizationPct')} inputMode="decimal" />
          <Field label="Inquiries (12m)" name="inquiries12m" value={draft.inquiries12m ?? ''} onChange={set('inquiries12m')} inputMode="numeric" />
          <Field label="History (months)" name="historyMonths" value={draft.historyMonths ?? ''} onChange={set('historyMonths')} inputMode="numeric" />
          <Field label="Open accounts" name="openAccounts" value={draft.openAccounts ?? ''} onChange={set('openAccounts')} inputMode="numeric" />
          <Field label="Total debt" name="totalDebt" value={draft.totalDebt ?? ''} onChange={set('totalDebt')} inputMode="decimal" />
          <Field label="Revolving accounts" name="revolvingAccounts" value={draft.revolvingAccounts ?? ''} onChange={set('revolvingAccounts')} inputMode="numeric" />
          <Field label="Auto loans" name="autoLoans" value={draft.autoLoans ?? ''} onChange={set('autoLoans')} inputMode="numeric" />
          <Field label="Mortgages" name="mortgages" value={draft.mortgages ?? ''} onChange={set('mortgages')} inputMode="numeric" />
          <SelectField
            label="Recent trend"
            name="recentTrend"
            value={draft.recentTrend ?? 'stable'}
            onChange={set('recentTrend')}
            options={[
              { value: 'improving', label: 'Improving' },
              { value: 'stable', label: 'Stable' },
              { value: 'deteriorating', label: 'Deteriorating' },
            ]}
          />
          <SelectField
            label="Credit profile result"
            name="outcome"
            value={draft.outcome ?? 'pass'}
            onChange={set('outcome')}
            options={[
              { value: 'pass', label: 'Strong / acceptable' },
              { value: 'borderline', label: 'Borderline / mixed' },
              { value: 'unacceptable', label: 'Unacceptable' },
            ]}
          />
        </div>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSave({
            ...toBody(draft, CREDIT_NUMERIC),
            repaymentBehavior: draft.repaymentBehavior || null,
            recentTrend: draft.recentTrend || null,
            outcome: draft.outcome || null,
            bureauNoHit: noHit,
          })
        }
        style={s(busy ? BTN_DISABLED : BTN_PRIMARY)}
      >
        {busy ? 'Saving…' : 'Save credit review'}
      </button>
    </div>
  );
}

const BANKING_NUMERIC = [
  'monthlyRevenue',
  'weeklyRevenue',
  'recurringWeeklyIncome',
  'recurringWeeklyExpenses',
  'avgDailyBalance',
  'endingBalance',
  'minimumBalance',
  'negativeBalanceDays',
  'nsfCount',
  'achReturnCount',
  'overdraftCount',
  'avgWeeklyFuelExpense',
  'existingDebtPayments',
  'oneTimeDeposits',
];

export function BankingPane({
  detail,
  busy,
  onSave,
}: {
  detail: VerificationDeskDetail;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const existing = detail.banking;
  const [draft, setDraft] = useState<Draft>(() => ({
    recurringWeeklyIncome: existing?.recurringWeeklyIncome ?? '',
    recurringWeeklyExpenses: existing?.recurringWeeklyExpenses ?? '',
    avgWeeklyFuelExpense: existing?.avgWeeklyFuelExpense ?? '',
    monthlyRevenue: existing?.monthlyRevenue ?? '',
    weeklyRevenue: existing?.weeklyRevenue ?? '',
    avgDailyBalance: existing?.avgDailyBalance ?? '',
    endingBalance: existing?.endingBalance ?? '',
    minimumBalance: existing?.minimumBalance ?? '',
    negativeBalanceDays: existing?.negativeBalanceDays == null ? '' : String(existing.negativeBalanceDays),
    nsfCount: existing?.nsfCount == null ? '' : String(existing.nsfCount),
    achReturnCount: existing?.achReturnCount == null ? '' : String(existing.achReturnCount),
    overdraftCount: existing?.overdraftCount == null ? '' : String(existing.overdraftCount),
    existingDebtPayments: existing?.existingDebtPayments ?? '',
    oneTimeDeposits: existing?.oneTimeDeposits ?? '',
    revenueTrend: existing?.revenueTrend ?? 'stable',
    cashFlowVolatility: existing?.cashFlowVolatility ?? 'low',
  }));
  const set = (k: string) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const income = num(draft.recurringWeeklyIncome);
  const expenses = num(draft.recurringWeeklyExpenses);
  const fuel = num(draft.avgWeeklyFuelExpense);
  // Live preview of what the SERVER will derive — shown, never sent.
  const netCashFlow = income !== null && expenses !== null ? income - expenses : null;
  const fuelOverstated = fuel !== null && expenses !== null && fuel > expenses;

  return (
    <div style={s('display:grid;gap:16px')}>
      <FigureRow>
        <Figure
          label="Avg weekly net cash flow"
          value={netCashFlow === null ? '—' : `$${netCashFlow.toFixed(2)}`}
          tone={netCashFlow === null ? 'plain' : netCashFlow > 0 ? 'ok' : 'bad'}
          hint="Derived on save — income minus expenses"
        />
        <Figure
          label="Adjusted weekly capacity"
          value={netCashFlow === null || fuel === null ? '—' : `$${(netCashFlow + fuel).toFixed(2)}`}
          hint="Net cash flow plus fuel added back"
        />
      </FigureRow>

      <div style={s('display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))')}>
        <Field label="Recurring weekly income" name="recurringWeeklyIncome" value={draft.recurringWeeklyIncome ?? ''} onChange={set('recurringWeeklyIncome')} inputMode="decimal" />
        <Field label="Recurring weekly expenses" name="recurringWeeklyExpenses" value={draft.recurringWeeklyExpenses ?? ''} onChange={set('recurringWeeklyExpenses')} inputMode="decimal" />
        <Field
          label="Avg weekly fuel expense"
          name="avgWeeklyFuelExpense"
          value={draft.avgWeeklyFuelExpense ?? ''}
          onChange={set('avgWeeklyFuelExpense')}
          inputMode="decimal"
          missing={fuelOverstated}
          hint="Must already be part of recurring weekly expenses — it is added back for capacity."
        />
        <Field label="Monthly revenue" name="monthlyRevenue" value={draft.monthlyRevenue ?? ''} onChange={set('monthlyRevenue')} inputMode="decimal" />
        <Field label="Weekly revenue" name="weeklyRevenue" value={draft.weeklyRevenue ?? ''} onChange={set('weeklyRevenue')} inputMode="decimal" />
        <Field label="Avg daily balance" name="avgDailyBalance" value={draft.avgDailyBalance ?? ''} onChange={set('avgDailyBalance')} inputMode="decimal" />
        <Field label="Ending balance" name="endingBalance" value={draft.endingBalance ?? ''} onChange={set('endingBalance')} inputMode="decimal" />
        <Field label="Minimum balance" name="minimumBalance" value={draft.minimumBalance ?? ''} onChange={set('minimumBalance')} inputMode="decimal" />
        <Field label="Negative balance days" name="negativeBalanceDays" value={draft.negativeBalanceDays ?? ''} onChange={set('negativeBalanceDays')} inputMode="numeric" />
        <Field label="NSF events" name="nsfCount" value={draft.nsfCount ?? ''} onChange={set('nsfCount')} inputMode="numeric" />
        <Field label="Returned ACH" name="achReturnCount" value={draft.achReturnCount ?? ''} onChange={set('achReturnCount')} inputMode="numeric" />
        <Field label="Overdrafts" name="overdraftCount" value={draft.overdraftCount ?? ''} onChange={set('overdraftCount')} inputMode="numeric" />
        <Field label="Existing debt payments" name="existingDebtPayments" value={draft.existingDebtPayments ?? ''} onChange={set('existingDebtPayments')} inputMode="decimal" />
        <Field label="One-time deposits" name="oneTimeDeposits" value={draft.oneTimeDeposits ?? ''} onChange={set('oneTimeDeposits')} inputMode="decimal" />
        <SelectField
          label="Revenue trend"
          name="revenueTrend"
          value={draft.revenueTrend ?? 'stable'}
          onChange={set('revenueTrend')}
          options={[
            { value: 'improving', label: 'Improving' },
            { value: 'stable', label: 'Stable' },
            { value: 'deteriorating', label: 'Deteriorating' },
          ]}
        />
        <SelectField
          label="Cash-flow volatility"
          name="cashFlowVolatility"
          value={draft.cashFlowVolatility ?? 'low'}
          onChange={set('cashFlowVolatility')}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'high', label: 'High' },
          ]}
        />
      </div>

      {fuelOverstated ? (
        <p role="alert" style={s('margin:0;font-size:12px;font-weight:700;color:var(--danger);line-height:1.5')}>
          Fuel is larger than total recurring expenses, so it was recorded outside them. Adding it back
          would credit capacity that was never subtracted — the save will be refused.
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || fuelOverstated}
        onClick={() =>
          onSave({
            ...toBody(draft, BANKING_NUMERIC),
            revenueTrend: draft.revenueTrend || null,
            cashFlowVolatility: draft.cashFlowVolatility || null,
          })
        }
        style={s(busy || fuelOverstated ? BTN_DISABLED : BTN_PRIMARY)}
      >
        {busy ? 'Saving…' : 'Save banking review'}
      </button>
    </div>
  );
}

/** Phase 9 — the tier picker refuses to offer a tier with no approved factor. */
export function RiskPane({
  detail,
  busy,
  onSave,
}: {
  detail: VerificationDeskDetail;
  busy: boolean;
  onSave: (body: { riskTier: VerificationRiskTier; analystRecommendation?: string }) => void;
}) {
  const [tier, setTier] = useState<VerificationRiskTier>(detail.risk?.riskTier ?? 'strong');
  const [note, setNote] = useState(detail.risk?.analystRecommendation ?? '');
  const priceable = detail.policy.tierPriceable;
  const risk = detail.risk;
  const blocked = !priceable[tier];

  return (
    <div style={s('display:grid;gap:16px')}>
      {risk?.recommendedLimit ? (
        <FigureRow>
          <Figure label="Adjusted weekly capacity" value={`$${risk.adjustedWeeklyCapacity ?? '—'}`} />
          <Figure label="Risk factor" value={risk.riskFactor ?? '—'} />
          <Figure label="Recommended limit" value={`$${risk.recommendedLimit}`} tone="ok" />
          <Figure label="Requested limit" value={risk.requestedLimit ? `$${risk.requestedLimit}` : '—'} />
        </FigureRow>
      ) : null}

      <div role="radiogroup" aria-label="Risk tier" style={s('display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))')}>
        {(['strong', 'moderate', 'weak'] as const).map((t) => {
          const ok = priceable[t];
          const active = tier === t;
          return (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTier(t)}
              style={s(
                `text-align:left;display:grid;gap:4px;padding:14px;border-radius:var(--radius-md);cursor:pointer;background:var(--surface);border:1px solid ${
                  active ? 'var(--accent)' : 'var(--border)'
                }${ok ? '' : ';opacity:.66'}`,
              )}
            >
              <span style={s('font-size:14px;font-weight:800;color:var(--text);text-transform:capitalize')}>
                {t}
              </span>
              <span style={s(`font-size:11px;font-weight:700;color:${ok ? 'var(--ok)' : 'var(--warn)'}`)}>
                {ok ? 'Factor set' : 'No approved factor'}
              </span>
            </button>
          );
        })}
      </div>

      {blocked ? (
        <p
          role="status"
          style={s(
            'margin:0;padding:12px 14px;border-radius:var(--radius-md);border:1px solid rgba(251,191,36,.34);background:rgba(251,191,36,.12);font-size:12px;color:var(--text);line-height:1.55',
          )}
        >
          No approved risk factor is set for the {tier} tier, so a limit cannot be recommended. An admin
          sets it in Verification policy — the calculator will not guess one.
        </p>
      ) : null}

      <div style={s('display:grid;gap:6px')}>
        <label htmlFor="analyst-note" style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)')}>
          Analyst recommendation
        </label>
        <textarea
          id="analyst-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          style={s(
            'width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;font-family:inherit;resize:vertical',
          )}
        />
      </div>

      <button
        type="button"
        disabled={busy || blocked}
        onClick={() => onSave({ riskTier: tier, ...(note.trim() ? { analystRecommendation: note.trim() } : {}) })}
        style={s(busy || blocked ? BTN_DISABLED : BTN_PRIMARY)}
      >
        {busy ? 'Computing…' : 'Assess risk & compute limit'}
      </button>
    </div>
  );
}

const FINAL_OPTIONS: ReadonlyArray<{ id: VerificationFinalDecision; label: string; body: string }> = [
  { id: 'approve', label: 'Approve — standard LOC', body: 'Assign the approved credit limit.' },
  { id: 'deposit_prepaid', label: 'Deposit 1:1 / Prepaid', body: 'Legitimate, but not for unsecured credit.' },
  { id: 'manager_review', label: 'Manager review', body: 'Borderline or an exception is being considered.' },
  { id: 'pending_docs', label: 'Pending documents', body: 'Information is missing.' },
  { id: 'declined_customer', label: 'Declined by customer', body: 'The applicant revoked the application.' },
  { id: 'decline', label: 'Decline', body: 'Not approved.' },
  { id: 'decline_blacklist', label: 'Decline + blacklist', body: 'Confirmed fraud or blacklist match. Adds every identifier to the blacklist.' },
];

export function DecisionPane({
  detail,
  busy,
  onDecide,
}: {
  detail: VerificationDeskDetail;
  busy: boolean;
  onDecide: (body: { decision: VerificationFinalDecision; approvedLimit?: number; note?: string }) => void;
}) {
  const [decision, setDecision] = useState<VerificationFinalDecision>('approve');
  const [limit, setLimit] = useState(detail.risk?.recommendedLimit ?? '');
  const [note, setNote] = useState('');
  const [arming, setArming] = useState(false);

  const needsLimit = decision === 'approve';
  const limitValue = num(limit);
  const blocked = needsLimit && (limitValue === null || limitValue <= 0);
  const destructive = decision === 'decline' || decision === 'decline_blacklist';

  return (
    <div style={s('display:grid;gap:16px')}>
      {detail.risk?.recommendedLimit ? (
        <FigureRow>
          <Figure label="Recommended limit" value={`$${detail.risk.recommendedLimit}`} tone="ok" />
          <Figure label="Requested limit" value={detail.risk.requestedLimit ? `$${detail.risk.requestedLimit}` : '—'} />
          <Figure label="Risk tier" value={detail.risk.riskTier ?? '—'} />
        </FigureRow>
      ) : null}

      <div role="radiogroup" aria-label="Final decision" style={s('display:grid;gap:8px')}>
        {FINAL_OPTIONS.map((o) => {
          const active = decision === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setDecision(o.id);
                setArming(false);
              }}
              style={s(
                `text-align:left;display:grid;gap:3px;padding:12px 14px;border-radius:var(--radius-md);cursor:pointer;background:var(--surface);border:1px solid ${
                  active ? 'var(--accent)' : 'var(--border)'
                }`,
              )}
            >
              <span style={s('font-size:13px;font-weight:800;color:var(--text)')}>{o.label}</span>
              <span style={s('font-size:12px;color:var(--muted);line-height:1.45')}>{o.body}</span>
            </button>
          );
        })}
      </div>

      {needsLimit ? (
        <Field
          label="Approved credit limit"
          name="approvedLimit"
          value={limit}
          onChange={setLimit}
          inputMode="decimal"
          missing={blocked}
        />
      ) : null}

      <div style={s('display:grid;gap:6px')}>
        <label htmlFor="final-note" style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)')}>
          Reason / conditions
        </label>
        <textarea
          id="final-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          style={s(
            'width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;font-family:inherit;resize:vertical',
          )}
        />
      </div>

      <button
        type="button"
        disabled={busy || blocked}
        onClick={() => {
          if (destructive && !arming) {
            setArming(true);
            return;
          }
          setArming(false);
          onDecide({
            decision,
            ...(needsLimit && limitValue !== null ? { approvedLimit: limitValue } : {}),
            ...(note.trim() ? { note: note.trim() } : {}),
          });
        }}
        style={s(
          busy || blocked
            ? BTN_DISABLED
            : arming
              ? `${BTN_PRIMARY};background:var(--danger)`
              : BTN_PRIMARY,
        )}
      >
        {arming ? 'Click again to confirm' : busy ? 'Recording…' : 'Record final decision'}
      </button>
    </div>
  );
}
