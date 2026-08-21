/** Usage rollups share the KPI daily tables but never overwrite the external KPI calculation. */
export const MYTRION_USAGE_CALCULATION_VERSION = 2;

export const MYTRION_USAGE_METRIC_KEYS = [
  'online_visible_seconds',
  'online_active_seconds',
  'tab_open_clicks',
  'lead_open_clicks',
  'deal_open_clicks',
  'call_clicks',
  'edit_open_clicks',
  'edit_save_successes',
  'edit_save_failures',
  'view_open_clicks',
  'record_open_clicks',
  'searches_completed',
  'exports_completed',
  'last_telemetry_at_epoch_seconds',
] as const;

export type MytrionUsageMetricKey = (typeof MYTRION_USAGE_METRIC_KEYS)[number];
