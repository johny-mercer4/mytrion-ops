/**
 * Analytics data access.
 *
 * The Tailwind presentation components that used to live here (AnalyticsDashboard, KpiGrid,
 * TrendChart, Breakdown, Leaderboard, DimensionTabs, DeltaPill, tones, params) were deleted: they
 * were superseded by the Horizon-styled marks in `mytrions/analyst/charts.tsx`, and `tones.ts`
 * carried a real defect — it collapsed nine semantic tones onto ~six Tailwind classes, so `sky` and
 * `info` painted the same colour and two categories in a breakdown were indistinguishable.
 *
 * What remains is the snapshot hook, which is presentation-agnostic.
 */
export { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
export type {
  AnalyticsLoaded,
  UseAnalyticsSnapshotOptions,
  UseAnalyticsSnapshotResult,
} from './useAnalyticsSnapshot';
