import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  AnalyticsDashboard,
  analyticsParamsToQuery,
  parseAnalyticsParams,
  type AnalyticsDimension,
} from '@/components/analytics';

/**
 * Analyst Overview — param-driven analytics dashboard.
 *
 * Data + layout come from URL query params (and stay in sync when tabs change):
 *   /m/analyst?dimension=transactions&sections=kpis,trend&fresh=1
 *
 * Other pages can embed the same component with a `params` prop instead of the URL.
 */
export function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseAnalyticsParams(searchParams);

  const onDimensionChange = useCallback(
    (dimension: AnalyticsDimension) => {
      const next = analyticsParamsToQuery({ ...params, dimension });
      setSearchParams(next, { replace: true });
    },
    [params, setSearchParams],
  );

  return (
    <AnalyticsDashboard
      params={params}
      dimension={params.dimension ?? 'pipeline'}
      onDimensionChange={onDimensionChange}
    />
  );
}
