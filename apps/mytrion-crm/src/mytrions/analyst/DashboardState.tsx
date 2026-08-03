import { CalendarX, TriangleAlert } from 'lucide-react';

import { MytrionPageLoader } from '../_shared/MytrionPageLoader';

/**
 * The loading / error / empty surface for a category dashboard.
 *
 * Deliberately NOT `_shared/ComingSoon`, which this used to reuse. ComingSoon hardcodes a
 * "Coming soon" badge and exists to say "this tab is not built yet" — rendering it while a built
 * dashboard was merely fetching (or had simply found no rows in the window) told the user the Sales
 * dashboard did not exist. Three different situations were also collapsed into one panel:
 *
 *   loading — the warehouse has been asked and has not answered yet
 *   error   — the request failed; the user can retry
 *   empty   — the query succeeded and there is genuinely nothing in this window
 *
 * `loading` delegates to the shared `MytrionPageLoader` — the same pulsing-bars mark HR, Recruit and
 * the other Mytrions use — so a wait looks identical wherever it happens. It reads `--accent`, so it
 * picks up the analyst hue without being told. It also owns the ONLY loading indicator on the page:
 * the header Refresh button must not spin while this is mounted (see CategoryDashboard), because two
 * indicators for one wait reads as two operations.
 */
export type DashboardStateKind = 'loading' | 'error' | 'empty';

export interface DashboardStateProps {
  kind: DashboardStateKind;
  /** Shown under the title — the concrete reason, not a generic apology. */
  detail: string;
  /** Rendered as a Retry action on `error`. */
  onRetry?: () => void;
  retrying?: boolean;
}

const TITLES: Record<DashboardStateKind, string> = {
  loading: 'Loading analytics…',
  error: 'Analytics unavailable',
  empty: 'No activity in this range',
};

export function DashboardState({ kind, detail, onRetry, retrying }: DashboardStateProps) {
  if (kind === 'loading') {
    return <MytrionPageLoader label={TITLES.loading} detail={detail} />;
  }

  return (
    <div className="an-state" data-kind={kind}>
      <span className="an-state-glyph">
        {kind === 'error' ? <TriangleAlert size={26} /> : <CalendarX size={26} />}
      </span>
      <h2 className="an-state-title">{TITLES[kind]}</h2>
      <p className="an-state-body">{detail}</p>
      {kind === 'error' && onRetry ? (
        <button type="button" className="an-btn" onClick={onRetry} disabled={retrying}>
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      ) : null}
    </div>
  );
}
