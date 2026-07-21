/**
 * Touchpoint catalog — every legacy-widget Deluge function and servercrm endpoint as one
 * declarative entry. Uniqueness is asserted at module load; the dispatcher is the only
 * execution path.
 */
import type { Touchpoint } from '../types.js';
import { billingDelugeTouchpoints } from './billingDeluge.js';
import { browserAutoTouchpoints } from './browserAuto.js';
import { carrierDelugeTouchpoints } from './carrierDeluge.js';
import { csDelugeTouchpoints } from './csDeluge.js';
import { financeDelugeTouchpoints } from './financeDeluge.js';
import { moneyCodeTouchpoints } from './moneyCode.js';
import { retentionTouchpoints } from './retention.js';
import { retentionCsTouchpoints } from './retentionCs.js';
import { salesDelugeTouchpoints } from './salesDeluge.js';
import { serverCrmAgentTouchpoints } from './serverCrmAgent.js';
import { serverCrmBillingTouchpoints } from './serverCrmBilling.js';
import { serverCrmFinanceTouchpoints } from './serverCrmFinance.js';
import { serverCrmMiscTouchpoints } from './serverCrmMisc.js';
import { ticketsDelugeTouchpoints } from './ticketsDeluge.js';
import { zapierTouchpoints } from './zapier.js';

const ALL: Touchpoint[] = [
  ...carrierDelugeTouchpoints,
  ...salesDelugeTouchpoints,
  ...ticketsDelugeTouchpoints,
  ...financeDelugeTouchpoints,
  ...csDelugeTouchpoints,
  ...billingDelugeTouchpoints,
  ...serverCrmAgentTouchpoints,
  ...serverCrmMiscTouchpoints,
  ...serverCrmFinanceTouchpoints,
  ...serverCrmBillingTouchpoints,
  ...browserAutoTouchpoints,
  ...zapierTouchpoints,
  ...retentionTouchpoints,
  ...retentionCsTouchpoints,
  ...moneyCodeTouchpoints,
];

const byKey = new Map<string, Touchpoint>();
for (const tp of ALL) {
  if (byKey.has(tp.key)) {
    throw new Error(`[touchpoints] duplicate key '${tp.key}' in catalog`);
  }
  byKey.set(tp.key, tp);
}

export function getTouchpoint(key: string): Touchpoint | undefined {
  return byKey.get(key);
}

export function listTouchpoints(): Touchpoint[] {
  return [...byKey.values()];
}
