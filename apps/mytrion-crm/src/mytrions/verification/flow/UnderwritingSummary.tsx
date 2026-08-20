/**
 * The SOP's "Underwriting summary in Mytrion".
 *
 * Split from `ReviewPanes` for the 600-line cap. Shown where the final decision is made, because
 * that is the one moment someone needs all sixteen facts at once — and the summary was already
 * being assembled and stored on the risk assessment with no surface to read it on.
 */
import { s } from './style';
import type { VerificationDeskDetail, VerificationRailPhase } from '@/api/verificationFlow';

/**
 * The SOP's "Underwriting summary in Mytrion", shown where the final decision is made.
 *
 * The summary was already assembled and stored on the risk assessment; without a surface it was
 * data nobody could read. Rendered from `detail`, not from the stored blob, so it stays true even
 * if the analyst revises a review after the assessment ran.
 */
export function UnderwritingSummary({ detail }: { detail: VerificationDeskDetail }) {
  const { case: c, credit, banking, risk, screening, indicators, documents, rail } = detail;
  const exceptions = rail.filter(
    (p) => p.status === 'manager_review' || p.outcome === 'additional_verification',
  );
  const received = documents.filter((d) => d.status === 'received');

  const rows: Array<[string, string]> = [
    ['Applicant type', String(c.applicantType ?? '—')],
    ['Route', detail.routing.underwritingRoute === 'wex' ? 'WEX' : 'Octane internal'],
    [
      'Blacklist / duplicate',
      screening.summary.clear
        ? 'Clear'
        : `${screening.hits.length} match(es), ${screening.summary.unresolved} unresolved`,
    ],
    ['Credit', credit ? `${credit.creditScore ?? '—'} · ${credit.outcome ?? 'not recorded'}` : 'Not reviewed'],
    ['Weekly income', banking?.recurringWeeklyIncome ? `$${banking.recurringWeeklyIncome}` : '—'],
    ['Weekly expenses', banking?.recurringWeeklyExpenses ? `$${banking.recurringWeeklyExpenses}` : '—'],
    ['Net cash flow', banking?.avgWeeklyNetCashFlow ? `$${banking.avgWeeklyNetCashFlow}` : '—'],
    ['Weekly fuel', banking?.avgWeeklyFuelExpense ? `$${banking.avgWeeklyFuelExpense}` : '—'],
    ['Average daily balance', banking?.avgDailyBalance ? `$${banking.avgDailyBalance}` : '—'],
    ['Adjusted capacity', risk?.adjustedWeeklyCapacity ? `$${risk.adjustedWeeklyCapacity}` : '—'],
    ['Risk tier', risk?.riskTier ?? '—'],
    ['Risk factor', risk?.riskFactor ?? '—'],
    ['Requested limit', c.requestedLimit ? `$${c.requestedLimit}` : '—'],
    ['Recommended limit', risk?.recommendedLimit ? `$${risk.recommendedLimit}` : '—'],
  ];

  return (
    <details
      style={s(
        'border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
      )}
    >
      <summary
        style={s(
          'min-height:44px;display:flex;align-items:center;padding:0 16px;cursor:pointer;font-size:13px;font-weight:800;color:var(--text-primary)',
        )}
      >
        Underwriting summary
      </summary>
      <div style={s('display:grid;gap:16px;padding:0 16px 16px')}>
        <dl style={s('margin:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr))')}>
          {rows.map(([label, value]) => (
            <div key={label} style={s('display:grid;gap:2px')}>
              <dt style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)')}>
                {label}
              </dt>
              <dd style={s('margin:0;font-size:13px;font-weight:700;color:var(--text-primary)')}>{value}</dd>
            </div>
          ))}
        </dl>

        <SummaryList title="Highway findings" items={highwayItems(rail)} />
        <SummaryList
          title="Analyst recommendation"
          items={risk?.analystRecommendation ? [risk.analystRecommendation] : []}
        />
        <SummaryList title="Key risks" items={risk?.keyRisks?.length ? risk.keyRisks : indicators} />
        <SummaryList
          title="Supporting documents"
          items={received.map((d) => d.fileName ?? d.docType)}
        />
        <SummaryList
          title="Management exceptions"
          items={exceptions.map((p) => `${p.label} — ${p.outcome ?? p.status}${p.note ? `: ${p.note}` : ''}`)}
        />
      </div>
    </details>
  );
}

/**
 * The Highway line, off the FINDINGS rather than the note.
 *
 * It used to read `phase.note`, which Phase 8 does not write — so a case with a complete Highway
 * review reported "Reviewed, no note recorded." and the SOP's "Highway findings" line was empty on
 * every case. `saveHighwayReview` puts the review on the phase's `findings` blob; this reads it.
 *
 * The verdict leads because it is the reviewer's ruling; the figures follow because that is what the
 * ruling was made from. Only figures that were actually recorded appear — a summary that printed
 * "Safety rating: —" for every unfilled box would bury the ones that matter.
 */
function highwayItems(rail: readonly VerificationRailPhase[]): string[] {
  const phase = rail.find((p) => p.code === 'p8_highway');
  if (!phase) return [];
  if (!phase.applies) return ['Not applicable — non-carrier applicant.'];

  const f = phase.findings;
  if (Object.keys(f).length === 0) return [];

  const items: string[] = [];
  const verdict = f.verdict;
  if (verdict === 'consistent') items.push('Consistent with the application.');
  if (verdict === 'discrepancy') items.push('Discrepancy against the application.');

  const say = (label: string, value: unknown, suffix = ''): void => {
    if (value === null || value === undefined || value === '') return;
    items.push(`${label}: ${String(value)}${suffix}`);
  };
  say('Safety rating', f.safetyRating);
  say('CSA percentile', f.safetyCsaPercentile);
  say('Bluewire score', f.bluewireScore);
  say('Power units observed', f.observedPowerUnits);
  say('Power units reported', f.reportedPowerUnits);
  say('Connected trucks', f.connectedTrucks);
  say('Insurance limit', f.insuranceLimit);
  say('Authority age', f.authorityAgeMonths, ' mo');
  say('Operating status', f.operatingStatus);
  if (typeof f.note === 'string' && f.note.trim() !== '') items.push(f.note);
  return items;
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={s('display:grid;gap:5px')}>
      <span style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted)')}>
        {title}
      </span>
      {items.length === 0 ? (
        <span style={s('font-size:12px;color:var(--text-muted)')}>None recorded.</span>
      ) : (
        <ul style={s('margin:0;padding-left:18px;display:grid;gap:3px')}>
          {items.map((item, i) => (
            <li key={`${title}-${i}`} style={s('font-size:12px;color:var(--text-secondary);line-height:1.5')}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
