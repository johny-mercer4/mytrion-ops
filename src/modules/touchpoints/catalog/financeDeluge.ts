/**
 * Finance Mytrion Deluge touchpoints — the EFS Smart-Balance functions the legacy
 * mytrion-finance widget called. Department-gated to 'finance'. These execute against
 * the ACTIVE Deluge env (production by default; ZOHO_FUNCTIONS_ENV=sandbox to switch).
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { limit } from './common.js';

export const financeDelugeTouchpoints: Touchpoint[] = [
  {
    kind: 'deluge',
    key: 'finance.balance_run',
    title: 'Trigger a fresh EFS parent balance run',
    riskClass: 'write',
    departments: ['finance'],
    functionNames: ['mytrionfinancebalancerun'],
    // The widget fires-and-forgets this and re-fetches the snapshot afterwards.
    unwrap: 'permissive',
    paramsSchema: z.object({}),
  },
  {
    kind: 'deluge',
    key: 'finance.parent_snapshot',
    title: 'Latest parent EFS balance snapshot (balance, mode, captured_at)',
    riskClass: 'read',
    departments: ['finance'],
    functionNames: ['mytrionfinanceparentsnapshot'],
    unwrap: 'status',
    paramsSchema: z.object({}),
  },
  {
    kind: 'deluge',
    key: 'finance.smart_events',
    title: 'Smart Balance events feed (paginated)',
    riskClass: 'read',
    departments: ['finance'],
    functionNames: ['mytrionfetchsmartevents'],
    // Response is {records, has_more, count} with no status wrapper.
    unwrap: 'permissive',
    paramsSchema: z.object({
      limit: limit(200, 25),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
];
