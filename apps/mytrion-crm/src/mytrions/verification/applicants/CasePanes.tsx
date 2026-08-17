/**
 * The working-pane bodies the design specifies: the editable application, the credit/banking
 * summary cards, the recorded-so-far facts, and the not-applicable state.
 *
 * The figures on the review cards are mapped to the columns that actually exist. The mock showed
 * "trade lines", "derogatory marks" and "oldest trade line"; `verification_credit_reviews` has
 * `open_accounts`, `collections` / `late_payments` and `history_months`. Those are different facts,
 * so they are labelled as what they are rather than dressed as what the mock drew — a credit desk
 * that mislabels a bureau figure is worse than one that shows a plainer word.
 */
import { useState } from 'react';
import { Badge, Button, Icon, Input, type BadgeIntent, type IconName } from '@/ds';
import type { VerificationDeskDetail, VerificationRailPhase } from '@/api/verificationFlow';
import { APPLICANT_LABEL, routeLabel, routeOf } from './applicantsModel';

/** One figure on a review card: what it is, the number, and the qualifier under it. */
function Figure({
  k,
  v,
  hint,
  tone,
}: {
  k: string;
  v: string;
  hint?: string;
  tone?: 'ok' | 'warn' | 'plain';
}) {
  return (
    <div className="va-fig">
      <span className="t-eyebrow">{k}</span>
      <span className="va-fig-v num" data-tone={tone ?? 'plain'}>
        {v}
      </span>
      {hint ? <span className="va-fig-hint">{hint}</span> : null}
    </div>
  );
}

function num(value: number | null | undefined): string {
  return value == null ? '—' : String(value);
}

function money(value: string | null | undefined): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

/** "Jun–Aug" from the review's own window, so a count is never shown without its period. */
function periodOf(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  return [from, to].filter(Boolean).join(' – ');
}

/**
 * The credit and banking headline, above the two forms.
 *
 * Read-only by design: this is the "what does the file already say" glance the reviewer wants
 * before opening a form, and every number below is one the desk itself recorded.
 */
export function ReviewSummary({
  detail,
  nsfThreshold,
}: {
  detail: VerificationDeskDetail;
  /**
   * The tenant's NSF review threshold. It lives on `verification_policy`, which the CASE detail
   * does not carry — `detail.policy` is only the three capacity factors — so the caller passes the
   * value it already has cached from `getPolicy()`. Null while that read is in flight; the hint is
   * then withheld rather than guessing the default.
   */
  nsfThreshold: number | null;
}) {
  const { credit, banking, routing } = detail;
  const trucks = detail.case.trucksCount;
  const bankFirst = routing.reviewOrder === 'banking_first';

  const creditBadge: { intent: BadgeIntent; icon: IconName; label: string } = !credit
    ? { intent: 'neutral', icon: 'schedule', label: 'Not recorded' }
    : credit.outcome === 'pass'
      ? { intent: 'success', icon: 'check_circle', label: 'Pass' }
      : credit.outcome === 'unacceptable'
        ? { intent: 'danger', icon: 'block', label: 'Unacceptable' }
        : credit.outcome === 'borderline'
          ? { intent: 'warning', icon: 'gavel', label: 'Borderline' }
          : { intent: 'info', icon: 'bolt', label: 'In progress' };

  // Banking has no `outcome` column — existence is the only honest signal, so it is the one used.
  const bankingBadge: { intent: BadgeIntent; icon: IconName; label: string } = banking
    ? { intent: 'info', icon: 'check', label: 'Recorded' }
    : { intent: 'neutral', icon: 'schedule', label: 'Not recorded' };

  /**
   * Null when NEITHER count was recorded — `?? 0` would render a green "0" against the review
   * threshold for a banking row nobody has filled in, which is the one figure on this card a
   * reviewer would sign Phase 6 off against. One recorded and one blank still sums.
   */
  const nsfTotal =
    banking == null || (banking.nsfCount == null && banking.achReturnCount == null)
      ? null
      : (banking.nsfCount ?? 0) + (banking.achReturnCount ?? 0);
  const period = banking ? periodOf(banking.periodStart, banking.periodEnd) : null;

  return (
    <div className="va-stack">
      <span className="va-order">
        <Badge intent="info" icon="handshake">
          {bankFirst
            ? `Banking first for this applicant${trucks == null ? '' : ` — ${trucks} trucks`}`
            : 'Credit first for this applicant'}
        </Badge>
      </span>

      <div className="va-review" data-tone={banking ? 'known' : 'unknown'}>
        <div className="va-review-head">
          <h3 className="va-review-title">
            <span className="va-review-glyph" data-tone="ok">
              <Icon name="account_balance" size="sm" />
            </span>
            Banking review
          </h3>
          <Badge intent={bankingBadge.intent} size="sm" icon={bankingBadge.icon}>
            {bankingBadge.label}
          </Badge>
        </div>
        <div className="va-figs">
          <Figure
            k="Average daily balance"
            v={money(banking?.avgDailyBalance)}
            {...(period ? { hint: period } : {})}
          />
          <Figure
            k="NSF + ACH returns"
            v={nsfTotal == null ? '—' : String(nsfTotal)}
            {...(nsfThreshold == null ? {} : { hint: `review threshold is ${nsfThreshold}` })}
            tone={
              nsfTotal == null || nsfThreshold == null
                ? 'plain'
                : nsfTotal >= nsfThreshold
                  ? 'warn'
                  : 'ok'
            }
          />
          <Figure
            k="Negative balance days"
            v={num(banking?.negativeBalanceDays)}
            {...(period ? { hint: `over ${period}` } : {})}
          />
          <Figure k="Monthly revenue" v={money(banking?.monthlyRevenue)} hint="from the statements" />
        </div>
      </div>

      <div className="va-review" data-tone={credit ? 'known' : 'unknown'}>
        <div className="va-review-head">
          <h3 className="va-review-title">
            <span className="va-review-glyph" data-tone="info">
              <Icon name="receipt_long" size="sm" />
            </span>
            Credit review
          </h3>
          <Badge intent={creditBadge.intent} size="sm" icon={creditBadge.icon}>
            {creditBadge.label}
          </Badge>
        </div>
        <div className="va-figs">
          <Figure
            k="Bureau score"
            v={credit?.bureauNoHit ? 'No record' : num(credit?.creditScore)}
            hint={credit?.bureauNoHit ? 'hard stop — nothing on file' : 'business credit bureau'}
            tone={credit?.bureauNoHit ? 'warn' : 'plain'}
          />
          <Figure k="Open accounts" v={num(credit?.openAccounts)} hint="all trade types" />
          <Figure
            k="Collections"
            v={num(credit?.collections)}
            hint={`${num(credit?.latePayments)} late payments`}
            tone={credit != null && (credit.collections ?? 0) > 0 ? 'warn' : 'plain'}
          />
          <Figure
            k="Credit history"
            v={credit?.historyMonths == null ? '—' : `${credit.historyMonths}m`}
            hint="length of file"
          />
        </div>
      </div>
    </div>
  );
}

/** The eleven intake columns the desk may correct, in the order the application asks for them. */
const INTAKE_FIELDS: ReadonlyArray<{ k: string; label: string; numeric?: boolean }> = [
  { k: 'companyName', label: 'Company' },
  { k: 'firstName', label: 'First name' },
  { k: 'lastName', label: 'Last name' },
  { k: 'ein', label: 'EIN' },
  { k: 'mc', label: 'MC number' },
  { k: 'dot', label: 'USDOT' },
  { k: 'email', label: 'Email' },
  { k: 'phone', label: 'Phone' },
  { k: 'trucksCount', label: 'Trucks', numeric: true },
  { k: 'fuelCardsRequested', label: 'Cards requested', numeric: true },
  { k: 'requestedLimit', label: 'Requested limit', numeric: true },
];

/**
 * Phase 1 — the application itself, EDITABLE.
 *
 * The credit agent on the phone with the applicant is the person most likely to learn the EIN was
 * mistyped, so they can correct any of it here at any phase. The server re-evaluates completeness
 * on save, which is what lets a fix made during underwriting be the thing that turns a red case
 * green — hence the hint under the button rather than a silent reload.
 */
export function IntakePane({
  detail,
  closed,
  busy,
  wexCardCutoff,
  onSave,
}: {
  detail: VerificationDeskDetail;
  /** The case is decided — its file is evidence now, and permanently read-only. */
  closed: boolean;
  /** A save is in flight. SEPARATE from `closed`: folding them together printed "Read-only — this
   * case is decided" over an open case for the length of every request. */
  busy: boolean;
  /** The tenant's WEX cutoff, so the route reads the same here as it does in the queue. */
  wexCardCutoff: number | null;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const locked = !c.verificationProcess;

  const valueOf = (key: string): string => {
    if (draft[key] !== undefined) return draft[key]!;
    const raw = c[key];
    return raw == null ? '' : String(raw);
  };

  const dirty = Object.keys(draft).length > 0;
  /**
   * WHAT IS MISSING IS THE SERVER'S ANSWER, NOT "the box is empty".
   *
   * `intake_missing` is the gate's own list, and the requirements differ by applicant type:
   * `evaluateIntakeCompleteness` never asks an owner-operator for a company name, EIN, MC or USDOT,
   * so flagging every blank field marked four columns red — with `aria-invalid` on them — on a case
   * the server calls complete. This is the same rule Sales' own intake form follows.
   */
  const missing = new Set(c.intakeMissing ?? []);

  const submit = async (): Promise<void> => {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      const meta = INTAKE_FIELDS.find((f) => f.k === k);
      const trimmed = v.trim();
      body[k] = trimmed === '' ? null : meta?.numeric ? Number(trimmed) : trimmed;
    }
    await onSave(body);
    setDraft({});
    setSaved(true);
  };

  const received = detail.documents.filter((d) => d.status === 'received').length;

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Application</h3>
        <span className="va-pane-note">
          {closed ? 'Read-only — this case is decided' : 'Editable — Sales-owned, correctable here'}
        </span>
      </div>

      {/* `ds/Input` carries no label of its own by design — the caller owns the `<label for>`. */}
      <div className="va-fields">
        {INTAKE_FIELDS.map((f) => {
          const value = valueOf(f.k);
          const id = `va-intake-${f.k}`;
          return (
            <div className="va-field" key={f.k}>
              <label className="va-field-label" htmlFor={id}>
                {f.label}
              </label>
              <Input
                id={id}
                value={value}
                placeholder="Not recorded"
                disabled={closed || busy}
                inputMode={f.numeric ? 'decimal' : 'text'}
                fullWidth
                invalid={missing.has(f.k)}
                {...(missing.has(f.k) ? { message: 'Missing' } : {})}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setDraft((d) => ({ ...d, [f.k]: next }));
                  setSaved(false);
                }}
              />
            </div>
          );
        })}
      </div>

      {/* The gate can be waiting on things this form does not hold — a licence scan, a principal,
          a bank connection. Naming the count keeps the pane from implying it shows everything. */}
      {missing.size > 0 && [...missing].some((k) => !INTAKE_FIELDS.some((f) => f.k === k)) ? (
        <p className="va-pane-body">
          {[...missing].filter((k) => !INTAKE_FIELDS.some((f) => f.k === k)).length} outstanding
          item(s) are not fields on this form — documents, principals or the bank connection. Sales
          collects those on the application.
        </p>
      ) : null}

      <div className="va-counts">
        <span className="va-count">
          <span className="t-eyebrow">Principals</span>
          <span className="va-count-v num" data-empty={detail.principals.length === 0}>
            {detail.principals.length || 'None'}
          </span>
        </span>
        <span className="va-count">
          <span className="t-eyebrow">Documents received</span>
          <span className="va-count-v num" data-empty={received === 0}>
            {received || 'None'}
          </span>
        </span>
        <span className="va-count">
          <span className="t-eyebrow">Applicant type</span>
          <span className="va-count-v" data-empty={c.applicantType == null}>
            {APPLICANT_LABEL[c.applicantType ?? ''] ?? 'Not set'}
          </span>
        </span>
        <span className="va-count">
          <span className="t-eyebrow">Underwriting route</span>
          <span className="va-count-v" data-empty={false}>
            {routeLabel(routeOf(c, wexCardCutoff))}
          </span>
        </span>
      </div>

      {closed ? null : (
        <div className="va-save">
          <Button
            variant="primary"
            icon="save"
            loading={busy}
            disabled={!dirty}
            onClick={() => void submit()}
          >
            {saved && !dirty ? 'Saved' : 'Save corrections'}
          </Button>
          {dirty ? (
            <Button variant="ghost" disabled={busy} onClick={() => setDraft({})}>
              Discard
            </Button>
          ) : null}
          <span className="va-save-hint">
            {locked
              ? 'Completeness is re-evaluated on save — a fix here can be what finally unlocks the case.'
              : 'Corrections are audited against your Zoho user.'}
          </span>
        </div>
      )}
    </div>
  );
}

/** Phases with no form of their own: what the file already says, and what to do about it. */
export function RecordedPane({
  detail,
  phase,
  wexCardCutoff,
}: {
  detail: VerificationDeskDetail;
  phase: VerificationRailPhase;
  wexCardCutoff: number | null;
}) {
  const c = detail.case;
  const facts: Array<{ k: string; v: string; empty: boolean }> = [
    {
      k: 'Applicant type',
      v: APPLICANT_LABEL[c.applicantType ?? ''] ?? 'Not set',
      empty: c.applicantType == null,
    },
    {
      k: 'Underwriting route',
      v: routeLabel(routeOf(c, wexCardCutoff)),
      empty: c.fuelCardsRequested == null,
    },
    { k: 'Trucks', v: c.trucksCount == null ? '—' : String(c.trucksCount), empty: c.trucksCount == null },
    {
      k: 'Cards requested',
      v: c.fuelCardsRequested == null ? '—' : String(c.fuelCardsRequested),
      empty: c.fuelCardsRequested == null,
    },
  ];

  return (
    <div className="va-stack">
      <h3 className="t-eyebrow va-pane-kicker">Recorded so far</h3>
      <div className="va-recorded">
        {facts.map((f) => (
          <div className="va-count" key={f.k}>
            <span className="t-eyebrow">{f.k}</span>
            <span className="va-count-v num" data-empty={f.empty}>
              {f.v}
            </span>
          </div>
        ))}
      </div>
      {phase.note ? <p className="va-pane-body">{phase.note}</p> : null}
      <p className="va-pane-body">
        {phase.status === 'passed'
          ? 'This phase is signed off. Reopening it re-runs every phase after it, so the decision is never based on a check that was overwritten.'
          : 'Nothing has been recorded against this phase yet. Work it from the checklist beside this pane, then sign it off.'}
      </p>
    </div>
  );
}

/** A phase this applicant type does not have. Explicit, never a silent green tick. */
export function SkippedPane({ phase }: { phase: VerificationRailPhase }) {
  return (
    <div className="va-skipped">
      <span className="va-skipped-glyph" aria-hidden="true">
        <Icon name="block" size="sm" />
      </span>
      <span className="va-skipped-text">
        <span className="va-skipped-title">Not applicable to this applicant</span>
        <span className="va-pane-body">
          {phase.skipReason ?? 'This phase does not apply to this applicant type.'}
        </span>
      </span>
    </div>
  );
}
