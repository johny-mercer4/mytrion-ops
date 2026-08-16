/**
 * What not acting cost — carriers Watch flagged that became bad debtors anyway.
 *
 * This replaced a band-mix chart and an exposure line. Those answered "is the portfolio drifting",
 * which is a distribution question for someone who already thinks in distributions. This answers the
 * question anyone on the desk can act on: who did we lose, how much, and how long did we have.
 *
 * Deliberately a LIST, not a dashboard. Every row is one real carrier with one real amount and one
 * real number of days — nothing is aggregated into a shape you have to interpret.
 */
import { useCallback } from 'react';
import { AlertTriangle, CalendarClock, Wallet } from 'lucide-react';
import { useCachedLoad } from '../../_shared/swrCache';
import { BAND_LABEL, fmtDate, fmtMoney, fmtScore } from './watchFormat';
import { getMissedPreventions } from '@/api/mytrionWatch';
import './watchDetail.css';

export function WatchMissed() {
  const load = useCallback(() => getMissedPreventions(), []);
  const { data, loading, error } = useCachedLoad('verification:watch:missed', load);
  const items = data?.items ?? [];

  if (loading && !data) return <p className="mw-inv-lede">Checking what happened to the carriers we flagged…</p>;

  if (error) {
    return (
      <div className="mw-banner" role="alert">
        <span className="mw-banner-title">Could not load this list</span>
        <p className="mw-banner-body">{String(error)}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mw-empty">
        <span className="mw-empty-title">Nothing to show yet</span>
        <span>
          No carrier that Mytrion Watch flagged has since become a bad debtor. That is the outcome
          this list exists to prevent.
        </span>
      </div>
    );
  }

  return (
    <div className="mw-missed">
      <section className="mw-pane" data-span="full">
        <h3 className="mw-pane-title">What not acting cost</h3>
        <div className="mw-missed-head">
          <span className="mw-missed-figure">{fmtMoney(data?.totalAmount ?? 0)}</span>
          <p className="mw-missed-lede">
            went bad on <b>{data?.carrierCount ?? 0} carriers</b> that Mytrion Watch had already put
            in <b>High risk</b> or <b>Elevated</b>. The score fell first; the debt came later. Acting
            on that warning — holding the limit, asking for a deposit, or moving them to prepay —
            is the whole of what this desk can do about it.
          </p>
        </div>
        <div className="mw-missed-facts">
          <span className="mw-missed-fact">
            <CalendarClock size={18} aria-hidden />
            <b>{data?.medianWarningDays ?? '—'} days</b> of warning, typically, before the debt was
            called bad
          </span>
          {data?.evidenceFrom ? (
            <span className="mw-missed-fact">
              <AlertTriangle size={18} aria-hidden />
              Outcomes are only recorded from <b>{fmtDate(data.evidenceFrom)}</b> — anything that
              went bad earlier cannot be counted here
            </span>
          ) : null}
        </div>
      </section>

      <ul className="mw-missed-list">
        {items.map((m) => (
          <li key={m.carrierId} className="mw-missed-row" data-band={m.band}>
            <span className="mw-missed-amount">
              <Wallet size={16} aria-hidden />
              {fmtMoney(m.amount)}
            </span>
            <span className="mw-missed-who">
              <span className="mw-missed-name">{m.companyName ?? `Carrier ${m.carrierId}`}</span>
              <span className="mw-missed-sub">
                Carrier {m.carrierId}
                {m.agentName ? ` · ${m.agentName}` : ''}
              </span>
            </span>
            <span className="mw-missed-story">
              <span className="mw-missed-step">
                <b>{fmtScore(m.score)}</b> · {BAND_LABEL[m.band]} on {fmtDate(m.flaggedOn)}
              </span>
              <span className="mw-missed-arrow" aria-hidden>
                →
              </span>
              <span className="mw-missed-step">
                bad debt {fmtDate(m.wentBadOn)}
              </span>
            </span>
            <span className="mw-missed-lead">
              <b>{m.warningDays}</b>
              <span>days of warning</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
