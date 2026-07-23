import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import type { AnalyticsBlock, AnalyticsDimension } from '@/mytrions/analyst/data';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { AnalyticsBreakdown } from './AnalyticsBreakdown';
import { AnalyticsDimensionTabs } from './AnalyticsDimensionTabs';
import { AnalyticsKpiGrid } from './AnalyticsKpiGrid';
import { AnalyticsLeaderboard } from './AnalyticsLeaderboard';
import { AnalyticsTrendChart } from './AnalyticsTrendChart';
import type { AnalyticsParams, AnalyticsSection } from './params';
import { useAnalyticsSnapshot, type AnalyticsLoaded } from './useAnalyticsSnapshot';

export type { AnalyticsSection };

const ALL_SECTIONS: AnalyticsSection[] = ['kpis', 'trend', 'breakdown', 'leaderboard'];

export interface AnalyticsDashboardProps extends AnalyticsParams {
  /**
   * Single bag of params (dimension / sections / fresh / …). Individual props still work and
   * override matching keys — useful when embedding from another page.
   */
  params?: AnalyticsParams;
  /**
   * Controlled dimension. When set, the parent owns the tab state (e.g. URL / page params).
   * Pair with `onDimensionChange`.
   */
  dimension?: AnalyticsDimension;
  /** Uncontrolled default when `dimension` is not passed. Default `pipeline`. */
  defaultDimension?: AnalyticsDimension;
  onDimensionChange?: (dim: AnalyticsDimension) => void;
  /** Skip fetching when false. Default true. */
  enabled?: boolean;
  /**
   * Render from a pre-loaded block instead of fetching. Useful when the parent already has
   * snapshot data (or wants to compose pieces without the hook).
   */
  block?: AnalyticsBlock;
  /** Optional source meta when passing `block` externally. */
  source?: AnalyticsLoaded['source'];
  computedAt?: string;
  className?: string;
}

function resolveProps(props: AnalyticsDashboardProps): {
  dimension?: AnalyticsDimension;
  defaultDimension: AnalyticsDimension;
  sections: AnalyticsSection[];
  dimensions?: AnalyticsDimension[];
  fresh?: boolean;
  pollMs?: number;
  title: string;
  showHeader: boolean;
  showTabs: boolean;
  showRefresh: boolean;
} {
  const p = props.params ?? {};
  return {
    ...(props.dimension !== undefined ? { dimension: props.dimension } : {}),
    defaultDimension: props.defaultDimension ?? props.dimension ?? p.dimension ?? 'pipeline',
    sections: props.sections ?? p.sections ?? ALL_SECTIONS,
    ...(props.dimensions !== undefined || p.dimensions !== undefined
      ? { dimensions: props.dimensions ?? p.dimensions }
      : {}),
    ...((props.fresh ?? p.fresh) !== undefined ? { fresh: props.fresh ?? p.fresh } : {}),
    ...((props.pollMs ?? p.pollMs) !== undefined ? { pollMs: props.pollMs ?? p.pollMs } : {}),
    title: props.title ?? p.title ?? 'Analytics',
    showHeader: props.showHeader ?? p.showHeader ?? true,
    showTabs: props.showTabs ?? p.showTabs ?? true,
    showRefresh: props.showRefresh ?? p.showRefresh ?? true,
  };
}

/**
 * Composable analytics dashboard — data is selected by params.
 *
 * Full page:
 *   <AnalyticsDashboard />
 *
 * Param-driven (other page or URL):
 *   <AnalyticsDashboard params={{ dimension: 'transactions', sections: ['kpis','trend'], fresh: true }} />
 *   /m/analyst?dimension=transactions&sections=kpis,trend&fresh=1
 *
 * Pieces only (parent owns data):
 *   <AnalyticsKpiGrid kpis={block.kpis} />
 */
export function AnalyticsDashboard(props: AnalyticsDashboardProps) {
  const {
    dimension: controlledDim,
    onDimensionChange,
    block: externalBlock,
    source: externalSource,
    computedAt: externalComputedAt,
    className,
  } = props;

  const resolved = resolveProps(props);
  const [internalDim, setInternalDim] = useState<AnalyticsDimension>(resolved.defaultDimension);
  const dim = controlledDim ?? internalDim;

  function setDim(next: AnalyticsDimension) {
    if (controlledDim === undefined) setInternalDim(next);
    onDimensionChange?.(next);
  }

  // Hook is always called (rules of hooks); when an external block is passed we ignore its result.
  const snap = useAnalyticsSnapshot({
    dimension: dim,
    ...(resolved.pollMs !== undefined ? { pollMs: resolved.pollMs } : {}),
    ...(resolved.fresh !== undefined ? { fresh: resolved.fresh } : {}),
    enabled: props.enabled !== false && externalBlock === undefined,
  });

  const current: AnalyticsLoaded =
    externalBlock !== undefined
      ? {
          block: externalBlock,
          source: externalSource ?? 'live',
          ...(externalComputedAt !== undefined ? { computedAt: externalComputedAt } : {}),
        }
      : snap.current;

  const block = current.block;
  const sections = resolved.sections ?? ALL_SECTIONS;
  const show = (s: AnalyticsSection) => sections.includes(s);

  const freshness =
    current.source === 'live'
      ? `live · updated ${current.computedAt ? new Date(current.computedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}`
      : 'sample data — backend offline';

  return (
    <div className={cn('flex flex-col gap-4 p-6', className)}>
      {resolved.showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-bold">{resolved.title ?? 'Analytics'}</h2>
            <p className="text-sm text-muted-foreground">
              {block.caption} ·{' '}
              <span className={current.source === 'live' ? 'text-good' : 'text-warn'}>{freshness}</span>
            </p>
          </div>
          {resolved.showRefresh && externalBlock === undefined ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void snap.refresh()}
              disabled={snap.refreshing}
            >
              <RefreshCw className={cn('size-3.5', snap.refreshing && 'animate-spin')} />
              Refresh
            </Button>
          ) : null}
        </div>
      ) : null}

      {resolved.showTabs ? (
        <AnalyticsDimensionTabs
          value={dim}
          onChange={setDim}
          {...(resolved.dimensions !== undefined ? { dimensions: resolved.dimensions } : {})}
        />
      ) : null}

      {show('kpis') ? <AnalyticsKpiGrid kpis={block.kpis} /> : null}

      {show('trend') || show('breakdown') ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {show('trend') ? <AnalyticsTrendChart label={block.trendLabel} trend={block.trend} /> : null}
          {show('breakdown') ? (
            <AnalyticsBreakdown label={block.breakdownLabel} breakdown={block.breakdown} />
          ) : null}
        </div>
      ) : null}

      {show('leaderboard') ? (
        <AnalyticsLeaderboard
          title={block.leaderboardLabel}
          cols={block.leaderboardCols}
          rows={block.leaderboard}
        />
      ) : null}
    </div>
  );
}
