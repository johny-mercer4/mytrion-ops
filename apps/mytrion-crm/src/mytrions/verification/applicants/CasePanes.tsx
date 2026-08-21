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
import { Badge, Icon, type BadgeIntent, type IconName } from '@/ds';
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
      {phase.status === 'passed' ? null : (
        <p className="va-pane-body">Nothing recorded yet. Work the checklist, then sign off.</p>
      )}
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
