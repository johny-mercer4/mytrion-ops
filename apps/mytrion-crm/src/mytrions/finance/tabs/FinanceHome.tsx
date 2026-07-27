import { useState } from 'react';
import { Clock, Gauge, RefreshCw, Wallet } from 'lucide-react';
import { useLoad } from '../../_shared/useLoad';
import { getParentBalance, runBalanceRefresh } from '../../../api/finance';
import { dateTime, splitMoney } from '../financeFormat';

/**
 * Finance → Home. One number: the EFS parent account balance.
 *
 * Source is the `finance.parent_snapshot` Deluge touchpoint — a SNAPSHOT, not a live EFS read, so
 * the capture time is shown as prominently as the figure itself; a stale balance presented as
 * current is how someone over-sweeps. "Run refresh" fires `finance.balance_run` (which recaptures
 * on Zoho's side) and then re-reads the snapshot.
 *
 * Deliberately nothing else on this page. Everything the old Finance module showed here was mock
 * data, and an empty page beats a convincing fake.
 */

/** Smart-Balance posture → hue. Unknown modes fall back to the module accent. */
const MODE_TONE: Record<string, string> = {
  COMFORT: 'var(--fi-paid)',
  WATCH: 'var(--fi-pending)',
  TIGHT: 'var(--fi-debt)',
  CRITICAL: 'var(--fi-debt)',
};

export function FinanceHome() {
  const [running, setRunning] = useState(false);
  const load = useLoad(() => getParentBalance(), []);

  /**
   * Recapture, then re-read. `balance_run` is fire-and-forget on Zoho's side, so a failure there
   * must not block the re-read — a stale-but-shown balance beats an error screen.
   */
  const refreshNow = async (): Promise<void> => {
    setRunning(true);
    try {
      await runBalanceRefresh();
    } catch {
      /* the run is best-effort; the snapshot re-read below is what matters */
    } finally {
      setRunning(false);
      load.refresh();
    }
  };

  const busy = load.loading || load.refreshing || running;
  const b = load.data;
  const amount = b ? splitMoney(b.balance) : null;
  const tone = b?.mode ? (MODE_TONE[b.mode.toUpperCase()] ?? 'var(--accent)') : 'var(--accent)';

  return (
    <div className="fi-page">
      <header className="fi-head">
        <div>
          <div className="fi-kicker">Treasury</div>
          <h1 className="fi-title">Home</h1>
          <p className="fi-sub">
            The EFS parent account balance, as last captured by the Smart-Balance run.
          </p>
        </div>
        <div className="fi-head-actions">
          <button type="button" className="fi-btn" onClick={refreshNow} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'fi-spin' : ''} />
            {running ? 'Recapturing…' : 'Run refresh'}
          </button>
        </div>
      </header>

      {load.error ? <div className="fi-error">{load.error}</div> : null}

      {/* One loader only — the hero skeleton stands in for the whole figure. */}
      {load.loading && !b ? (
        <div className="fi-sk" style={{ height: 186 }} />
      ) : b ? (
        <section className="fi-balance">
          <div className="fi-balance-glow" />
          <div className="fi-balance-inner">
            <div>
              <div className="fi-stat-l">
                <Wallet size={12} />
                EFS parent balance
              </div>
              <div className="fi-balance-amount">
                {amount?.whole}
                <span className="fi-cents">{amount?.cents}</span>
              </div>
            </div>
            <div className="fi-balance-meta">
              {b.mode ? (
                <span className="fi-mode" style={{ ['--p' as string]: tone }}>
                  <Gauge size={12} />
                  {b.mode}
                </span>
              ) : null}
              <span className="fi-captured">
                <Clock size={11} style={{ verticalAlign: '-1px', marginRight: 5 }} />
                Captured {dateTime(b.capturedAt) || 'unknown'}
              </span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
