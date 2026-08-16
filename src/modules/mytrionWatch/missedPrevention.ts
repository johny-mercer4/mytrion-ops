/**
 * What it cost to not act — carriers Watch flagged, that later went bad anyway.
 *
 * This replaced a portfolio chart. The chart answered "is the book drifting", which is a question
 * for someone who already thinks in distributions; this answers "who did we lose, how much, and how
 * long did we have" — which is the question anyone can act on.
 *
 * It needs no new scoring. Watch already stores a score per carrier per date, and the warehouse
 * already records who became a bad debtor and when, so the evidence is a join of two things we have.
 * The join happens HERE, in TypeScript, because the two live in different databases: our snapshots
 * are in the app Postgres and the outcome is in the read-only DWH.
 *
 * WHAT COUNTS AS A MISSED PREVENTION: Watch put the carrier in `high` or `elevated` on some date,
 * and the warehouse first flagged them bad STRICTLY LATER. A carrier already bad when we scored them
 * proves nothing — that is hindsight, not warning — so those are dropped.
 */
import { dwh } from '../../integrations/dwh.js';
import { mytrionWatchRepo } from '../../repos/mytrionWatchRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

export interface MissedPrevention {
  carrierId: string;
  companyName: string | null;
  agentName: string | null;
  /** The worst score Watch ever gave them, and the band and date that went with it. */
  score: number;
  band: string;
  flaggedOn: string;
  creditLimit: number | null;
  /** The day the warehouse first called them a bad debtor. */
  wentBadOn: string;
  /** Days between the warning and the outcome. Always > 0 by construction. */
  warningDays: number;
  /** Bad debt outstanding on that carrier. */
  amount: number;
}

export interface MissedPreventionReport {
  items: MissedPrevention[];
  carrierCount: number;
  totalAmount: number;
  medianWarningDays: number | null;
  /** Earliest outcome the warehouse can evidence — everything before this is invisible to us. */
  evidenceFrom: string | null;
}

/** Bad-debt outcomes: when each carrier was first flagged, and what is outstanding. */
const OUTCOME_SQL = `
  select carrier_id::text          as "carrierId",
         min(snapshot_date)::text  as "firstBad",
         max(residual_amount)::float8 as "amount"
  from octane.mart_bad_debt_history
  where is_bad_debt = true
  group by carrier_id
`;

const HORIZON_SQL = `select min(snapshot_date)::text as "from" from octane.mart_bad_debt_history`;

const DAY = 86_400_000;

export async function missedPreventions(
  ctx: TenantContext,
  limit = 100,
): Promise<MissedPreventionReport> {
  const [flagged, outcomes, horizon] = await Promise.all([
    mytrionWatchRepo.worstFlagPerCarrier(ctx),
    dwh.query<{ carrierId: string; firstBad: string; amount: number }>(OUTCOME_SQL),
    dwh.query<{ from: string | null }>(HORIZON_SQL),
  ]);

  const outcomeBy = new Map(outcomes.map((o) => [o.carrierId, o]));
  const items: MissedPrevention[] = [];

  for (const f of flagged) {
    const outcome = outcomeBy.get(f.carrierId);
    if (!outcome) continue;
    const warningDays = Math.round((Date.parse(outcome.firstBad) - Date.parse(f.flaggedOn)) / DAY);
    // Warned AFTER the fact is not a warning.
    if (!Number.isFinite(warningDays) || warningDays <= 0) continue;
    items.push({
      carrierId: f.carrierId,
      companyName: f.companyName,
      agentName: f.agentName,
      score: f.score,
      band: f.band,
      flaggedOn: f.flaggedOn,
      creditLimit: f.creditLimit,
      wentBadOn: outcome.firstBad,
      warningDays,
      amount: outcome.amount,
    });
  }

  items.sort((a, b) => b.amount - a.amount);
  const leads = items.map((i) => i.warningDays).sort((a, b) => a - b);

  return {
    items: items.slice(0, limit),
    carrierCount: items.length,
    totalAmount: items.reduce((sum, i) => sum + i.amount, 0),
    medianWarningDays: leads.length ? (leads[Math.floor(leads.length / 2)] ?? null) : null,
    evidenceFrom: horizon[0]?.from ?? null,
  };
}
