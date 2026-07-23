/**
 * Reusable analytics dashboard kit.
 *
 * Full dashboard (analyst page — also reads URL params):
 *   import { AnalyticsDashboard } from '@/components/analytics';
 *   <AnalyticsDashboard />
 *
 * Param-driven embed on another page:
 *   <AnalyticsDashboard
 *     params={{ dimension: 'transactions', sections: ['kpis', 'trend'], fresh: true }}
 *   />
 *
 * Or compose pieces yourself with the hook / props:
 *   const { current } = useAnalyticsSnapshot({ dimension: 'billing', fresh: true });
 *   <AnalyticsKpiGrid kpis={current.block.kpis} />
 */
export { AnalyticsDashboard, type AnalyticsDashboardProps, type AnalyticsSection } from './AnalyticsDashboard';
export {
  parseAnalyticsParams,
  analyticsParamsToQuery,
  type AnalyticsParams,
} from './params';
export { AnalyticsKpiGrid, type AnalyticsKpiGridProps } from './AnalyticsKpiGrid';
export { AnalyticsTrendChart, type AnalyticsTrendChartProps } from './AnalyticsTrendChart';
export { AnalyticsBreakdown, type AnalyticsBreakdownProps } from './AnalyticsBreakdown';
export { AnalyticsLeaderboard, type AnalyticsLeaderboardProps } from './AnalyticsLeaderboard';
export { AnalyticsDimensionTabs, ANALYTICS_DIMENSIONS, type AnalyticsDimensionTabsProps } from './AnalyticsDimensionTabs';
export { DeltaPill, type DeltaPillProps } from './DeltaPill';
export {
  useAnalyticsSnapshot,
  type AnalyticsLoaded,
  type UseAnalyticsSnapshotOptions,
  type UseAnalyticsSnapshotResult,
} from './useAnalyticsSnapshot';
export { BAR_CLASS, TEXT_CLASS } from './tones';
// Re-export dimension type for callers that only import from this barrel.
export type { AnalyticsDimension } from '@/mytrions/analyst/data';
