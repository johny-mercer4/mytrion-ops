/**
 * Finance Mytrion client (/v1/finance/* + the finance.* touchpoints).
 */
import { callTouchpoint } from './touchpoints';
import type { TouchpointKey, TouchpointMap } from './touchpointTypes';

const FINANCE_DEPARTMENTS = ['finance'];
type FinanceTouchpointKey = Extract<TouchpointKey, `finance.${string}`>;

/** finance.* touchpoint call with the finance department view pinned. */
export function financeTouchpoint<K extends FinanceTouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: FINANCE_DEPARTMENTS });
}
