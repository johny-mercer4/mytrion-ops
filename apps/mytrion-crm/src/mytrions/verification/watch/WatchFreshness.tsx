/**
 * How old the numbers on screen are, and the one control that changes that.
 *
 * The desk's first question about any score is how fresh it is — it used to be a muted footnote in
 * the header. Scoring runs daily now, so "updated 4 hours ago" is the difference between reading
 * this morning's book and yesterday's.
 *
 * Refresh ENQUEUES the job rather than running it inline: a full run takes about a minute against
 * the warehouse, and an awaited request would hit the proxy timeout and report failure while the run
 * carried on. The queue is a singleton, so two agents pressing this collapse into one run.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fmtDuration, fmtSince } from './watchFormat';
import { runWatchScoring, type WatchRun } from '@/api/mytrionWatch';

/** Long enough for a ~77s run plus queue latency; past this we stop and say so. */
const POLL_LIMIT_MS = 4 * 60_000;
const POLL_EVERY_MS = 6_000;

export function WatchFreshness({
  lastRun,
  onRefreshed,
}: {
  lastRun: WatchRun | null;
  onRefreshed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  /** The run we were looking at when Refresh was pressed — completion means a NEWER one exists. */
  const startedFrom = useRef<string | null>(null);

  // A run that finishes while we are polling ends the busy state; nothing else does.
  useEffect(() => {
    if (!busy) return;
    const began = Date.now();
    const id = setInterval(() => {
      if (Date.now() - began > POLL_LIMIT_MS) {
        setBusy(false);
        setTimedOut(true);
        clearInterval(id);
        return;
      }
      onRefreshed();
    }, POLL_EVERY_MS);
    return () => clearInterval(id);
  }, [busy, onRefreshed]);

  useEffect(() => {
    if (!busy) return;
    const finished = lastRun?.finishedAt ?? null;
    if (finished && finished !== startedFrom.current) setBusy(false);
  }, [busy, lastRun?.finishedAt]);

  async function refresh(): Promise<void> {
    if (busy) return;
    setError(null);
    setTimedOut(false);
    startedFrom.current = lastRun?.finishedAt ?? null;
    setBusy(true);
    try {
      await runWatchScoring();
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not start a re-score.');
    }
  }

  const finishedAt = lastRun?.finishedAt ?? null;

  return (
    <div className="mw-fresh">
      <span className="mw-fresh-main">
        <span className="mw-fresh-label">Last updated</span>
        <span className="mw-fresh-value">{busy ? 'scoring now…' : fmtSince(finishedAt)}</span>
      </span>

      <span className="mw-fresh-detail">
        {busy
          ? 'A full run takes about a minute. This page updates itself when it lands.'
          : lastRun?.finishedAt
            ? `${lastRun.scoredCount ?? 0} carriers in ${fmtDuration(lastRun.durationMs)} · scores every morning`
            : 'No run has completed yet.'}
      </span>

      <button
        type="button"
        className="mw-refresh"
        onClick={() => void refresh()}
        disabled={busy}
        aria-label="Re-score every carrier now"
      >
        {busy ? (
          <Loader2 size={14} className="mw-refresh-spin" aria-hidden />
        ) : (
          <RefreshCw size={14} aria-hidden />
        )}
        {busy ? 'Scoring…' : 'Refresh scoring'}
      </button>

      {error ? (
        <p className="mw-fresh-error" role="alert">
          {error}
        </p>
      ) : timedOut ? (
        <p className="mw-fresh-error" role="status">
          Still running after four minutes. It will finish on its own — reopen this tab shortly.
        </p>
      ) : null}
    </div>
  );
}
