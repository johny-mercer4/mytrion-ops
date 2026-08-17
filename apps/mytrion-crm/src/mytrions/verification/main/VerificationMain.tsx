/**
 * Verification Mytrion — Main.
 *
 * The decisioning desk at a glance: what was decided this week, the four numbers that describe the
 * queue, what is holding it up, where the open cases sit, how long they have waited, what has been
 * signed off — and the way in to every other tab.
 *
 * ONE FETCH, SHARED. The whole page derives from `/verification/flow/cases`, under the same SWR key
 * the New applicants tab uses (`verification:flow:cases`), so opening Main warms that tab and the
 * two can never disagree about how many cases are open. Two secondary counters ride along for the
 * launcher cards — the Watch snapshot's `worsened` (aggregates only, one row of payload) and the
 * client roster, which is the roster the Existing clients tab needs anyway, so fetching it here
 * makes that tab open instantly instead of costing it a round trip.
 *
 * NO PLACEHEHOLDERS. Every figure is computed in `verificationOverview.ts` from real rows; where a
 * fact does not exist yet the panel renders its empty state, which is why a desk that has decided
 * nothing shows "No decisions yet" rather than a zero dressed up as a result.
 *
 * The hero, the "Workspaces" rule and the launcher cards are the shared `.ms-*` chrome every
 * Mytrion has — see `verificationMain.css` for why they are reused rather than restated.
 */
import { useCallback, useMemo, type CSSProperties } from 'react';
import { Badge, Icon, Skeleton, SkeletonRegion, type IconName } from '@/ds';
import { listDeskCases } from '@/api/verificationFlow';
import { listWatchScores } from '@/api/mytrionWatch';
import type { ModuleTab } from '../../_shared/ModuleShell';
import { useCachedLoad } from '../../_shared/swrCache';
import { useVerificationRoster } from '../verificationData';
import { AgingPanel, DecisionsPanel, NeedsTodayPanel, PipelinePanel } from './MainPanels';
import { buildOverview, TREND_DAYS } from './verificationOverview';
import './verificationMain.css';

/** The Watch snapshot moves once a week; the desk queue every few minutes. */
const STALE_WATCH = 10 * 60_000;

/** Tab id → the launcher glyph. Material Symbols, matching the tab's own lucide icon. */
const LAUNCHER_ICON: Record<string, IconName> = {
  applicants: 'assignment_turned_in',
  watch: 'vital_signs',
  clients: 'apartment',
  tickets: 'confirmation_number',
};

export interface VerificationMainProps {
  /** Switch tabs — ModuleShell's own `open`, re-checked against the caller's tab grants. */
  open: (tabId: string) => void;
  /** Every tab but Main, already filtered to what this user may see. */
  launchers: ModuleTab[];
  /** Open a specific case in the New applicants workspace. */
  onOpenCase: (caseId: string) => void;
}

export function VerificationMain({ open, launchers, onOpenCase }: VerificationMainProps) {
  const loadCases = useCallback(() => listDeskCases({ limit: 200 }), []);
  const cases = useCachedLoad('verification:flow:cases', loadCases);

  // Aggregates only — `limit: 1` still returns the whole snapshot's counters (mytrionWatchRepo
  // computes them over the scoring date, not the page), so this costs one row of payload.
  const loadWatch = useCallback(() => listWatchScores({ limit: 1 }), []);
  const watch = useCachedLoad('verification:watch:summary', loadWatch, { staleMs: STALE_WATCH });

  const roster = useVerificationRoster();

  // One clock for the whole page: ages, "this week" and the trend must agree, and a per-panel
  // `Date.now()` would let them drift across a render.
  const overview = useMemo(() => {
    if (!cases.data) return null;
    return buildOverview({
      rows: cases.data.items,
      aggregates: cases.data.aggregates,
      now: Date.now(),
    });
  }, [cases.data]);

  const refreshedAt = useMemo(
    () =>
      cases.cachedAt == null
        ? null
        : new Date(cases.cachedAt).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          }),
    [cases.cachedAt],
  );

  const launcherCount = (tab: ModuleTab): { value: string; label: string } | null => {
    if (tab.soon) return null;
    if (tab.id === 'applicants') {
      return overview ? { value: String(overview.openCount), label: 'open' } : null;
    }
    if (tab.id === 'watch') {
      return watch.data ? { value: String(watch.data.aggregates.worsened), label: 'worsened' } : null;
    }
    if (tab.id === 'clients') {
      return roster.data ? { value: String(roster.data.length), label: 'on file' } : null;
    }
    return null;
  };

  // First paint of the whole surface is ONE skeleton region with ONE announcement — no panel adds
  // a spinner on top of it (modern-web-guidance §5). A revalidation keeps the numbers on screen.
  const firstLoad = cases.loading && !cases.data;

  return (
    <SkeletonRegion busy={firstLoad} label="Loading the decisioning queue" className="vm-main">
      <div className="ms-hero">
        <div className="ms-hero-glow" />
        <div className="ms-hero-inner vm-hero-grid">
          <div>
            <div className="ms-kicker">Decisioning</div>
            <h1 className="ms-hero-title">
              Verification <span>Mytrion</span>
            </h1>
            <p className="ms-sub">
              Credit and compliance decisioning — new applicants through the ten underwriting
              phases, and re-verification for clients already on the books.
            </p>
            <div className="vm-refreshed">
              <Icon name="schedule" size="sm" />
              Queue refreshed <strong className="num">{refreshedAt ?? '—'}</strong>
            </div>
          </div>

          <div className="vm-hero-aside">
            <span className="t-eyebrow">Decided this week</span>
            {firstLoad ? (
              <Skeleton variant="rect" width="4ch" height="52px" radius="control" />
            ) : (
              <span className="vm-hero-figure num-lg">{overview?.decided.week ?? 0}</span>
            )}
            <span className="vm-hero-split">
              <span className="vm-hero-approved">
                <b className="num">{overview?.decided.approved ?? 0}</b> approved
              </span>
              <span className="vm-hero-rule" aria-hidden="true" />
              <span className="vm-hero-declined">
                <b className="num">{overview?.decided.declined ?? 0}</b> declined
              </span>
            </span>
            {overview && (overview.decided.week > 0 || overview.decided.previousWeek > 0) ? (
              <span className="vm-hero-delta">
                <DeltaBadge delta={overview.decided.delta} />
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {cases.error ? (
        <div className="vfx-banner" data-tone="bad" role="alert">
          <span className="vfx-banner-title">Could not load the desk</span>
          <p className="vfx-banner-body">{cases.error}</p>
        </div>
      ) : null}

      <section className="vm-kpis" aria-label="Queue at a glance">
        <Kpi
          label="Open applications"
          value={overview ? String(overview.openCount) : null}
          unit="cases"
          icon="assignment_turned_in"
          tone="var(--accent)"
          series={overview?.trend.open}
        />
        <Kpi
          label="Waiting on Sales"
          value={overview ? String(overview.awaitingSales) : null}
          unit="locked"
          icon="lock"
          tone="var(--danger)"
          valueColor="var(--danger)"
          series={overview?.trend.awaitingSales}
        />
        <Kpi
          label="Median time to decision"
          value={
            overview
              ? overview.medianDaysToDecision == null
                ? '—'
                : String(overview.medianDaysToDecision)
              : null
          }
          unit={overview?.medianDaysToDecision == null ? 'no decisions yet' : 'days'}
          icon="speed"
          tone="var(--success)"
          series={overview?.trend.medianDaysToDecision}
        />
        <Kpi
          label="Approved exposure"
          value={overview ? compactMoney(overview.approvedExposureWeek) : null}
          unit="this week"
          icon="attach_money"
          tone="var(--tone-amber)"
          series={overview?.trend.approvedExposure}
        />
      </section>

      {firstLoad ? (
        <PanelSkeletons />
      ) : overview ? (
        <>
          <section className="vm-cols">
            <NeedsTodayPanel
              rows={overview.needsToday}
              onOpenQueue={() => open('applicants')}
              onOpenCase={onOpenCase}
            />
            <PipelinePanel rows={overview.pipeline} openCount={overview.openCount} />
          </section>

          <section className="vm-cols vm-cols-even">
            <AgingPanel
              buckets={overview.aging}
              pastSla={overview.pastSla}
              openCount={overview.openCount}
            />
            <DecisionsPanel rows={overview.decisions} />
          </section>
        </>
      ) : null}

      <section className="ms-section">
        <div className="ms-section-head">
          <h2 className="ms-section-title">Workspaces</h2>
          <span className="ms-section-line" />
        </div>
        <div className="ms-jump-grid">
          {launchers.map((tab) => {
            const count = launcherCount(tab);
            return (
              <button
                key={tab.id}
                type="button"
                className="ms-jump"
                style={{ '--ms-tone': tab.tone } as CSSProperties}
                // A parked tab stays REACHABLE here, unlike the rail and unlike the imported
                // design's disabled card: behind it is a real ComingSoon panel that says what the
                // queue will read and why it is parked. Disabling the control would take the
                // explanation off the tab order along with the click (CONVENTIONS §5), and it is
                // the only place that explanation is published.
                onClick={() => open(tab.id)}
              >
                <span className="ms-jump-shimmer" />
                <div className="ms-jump-top">
                  <span className="ms-glyph">
                    <Icon name={LAUNCHER_ICON[tab.id] ?? 'description'} />
                  </span>
                  {count ? (
                    <span className="vm-jump-count">
                      <span className="vm-jump-figure num-lg">{count.value}</span>
                      <span className="t-eyebrow">{count.label}</span>
                    </span>
                  ) : null}
                </div>
                <span className="ms-jump-title">
                  {tab.label}
                  {tab.soon ? <span className="ms-soon">Soon</span> : null}
                </span>
                <span className="ms-jump-desc">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </section>
    </SkeletonRegion>
  );
}

/** Movement against the previous seven days. A fall is a fact, not a failure — hence `neutral`. */
function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <Badge intent="neutral" size="sm" icon="schedule">
        Level with last week
      </Badge>
    );
  }
  return (
    <Badge
      intent={delta > 0 ? 'success' : 'neutral'}
      size="sm"
      icon={delta > 0 ? 'trending_up' : 'trending_down'}
    >
      {delta > 0 ? `+${delta}` : delta} vs last week
    </Badge>
  );
}

function Kpi({
  label,
  value,
  unit,
  icon,
  tone,
  valueColor,
  series,
}: {
  label: string;
  /** Null while the first load is in flight — the tile keeps its box and shows a skeleton. */
  value: string | null;
  unit: string;
  icon: IconName;
  tone: string;
  // `| undefined` because tsconfig sets `exactOptionalPropertyTypes` — see the note in ds/Icon.
  valueColor?: string | undefined;
  series?: readonly number[] | undefined;
}) {
  const bars = series ?? Array.from({ length: TREND_DAYS }, () => 0);
  const max = Math.max(...bars, 0);

  return (
    <div
      className="vm-kpi"
      style={
        {
          '--vm-tone': tone,
          ...(valueColor ? { '--vm-value': valueColor } : {}),
        } as CSSProperties
      }
    >
      <div className="vm-kpi-head">
        <span className="t-eyebrow">{label}</span>
        <span className="vm-kpi-glyph">
          <Icon name={icon} size="sm" />
        </span>
      </div>
      <div className="vm-kpi-figure">
        {value == null ? (
          <Skeleton variant="rect" width="3ch" height="var(--text-2xl)" radius="control" />
        ) : (
          <span className="vm-kpi-value num-lg">{value}</span>
        )}
        <span className="vm-kpi-unit">{unit}</span>
      </div>
      {/* Decoration over the figure above it — the tile's value is the accessible one. */}
      <span className="vm-spark" aria-hidden="true">
        {bars.map((n, i) => (
          <i key={i} style={{ height: `${max === 0 ? 3 : Math.max(3, Math.round((n / max) * 20))}px` }} />
        ))}
      </span>
    </div>
  );
}

/**
 * Dollars at dashboard width: $412K, not $412,000. Exact amounts live on the case.
 *
 * `narrowSymbol` because the default under a non-US locale is "US$412K" — the desk is single-
 * currency and the country prefix is noise that also costs three characters of tile width.
 */
function compactMoney(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  });
}

/**
 * Mirrors BOTH panel rows so nothing shifts when the data lands.
 *
 * The heights are MEASURED, not chosen — 441px is the ten-row phase pipeline, 203px the ageing and
 * decisions row. The first cut rendered one 320px row for a page that has two, and the page grew
 * 346px under the reader the moment the data arrived.
 */
function PanelSkeletons() {
  return (
    <>
      <section className="vm-cols">
        <Skeleton variant="rect" height="441px" radius="panel" />
        <Skeleton variant="rect" height="441px" radius="panel" />
      </section>
      <section className="vm-cols vm-cols-even">
        <Skeleton variant="rect" height="203px" radius="panel" />
        <Skeleton variant="rect" height="203px" radius="panel" />
      </section>
    </>
  );
}
