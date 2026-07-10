/** Shared zod pieces for touchpoint param schemas (widget-parity coercions). */
import { z } from 'zod';

/** Ids arrive as strings or numbers from the UI — normalize to trimmed strings. */
export const idString = z
  .union([z.string().min(1).max(120), z.number()])
  .transform((v) => String(v).trim());

export const carrierId = idString;
export const cardNumber = z.string().min(4).max(30);

/**
 * Two DISTINCT range vocabularies exist in servercrm (verified against the reference):
 *  - dwhRange   → /api/agent/dwh/* (transactions, invoices, cards/last-used): _resolveRange
 *                 accepts day|week|month|quarter|half_year|year|all_time|custom, 400 otherwise.
 *  - salesRange → /api/salesMytrion/fetchInvoices: last_7|last_30|last_90|custom.
 * Using the wrong list is a 400 from the upstream, so keep them separate.
 */
export const dwhRange = z.enum([
  'day',
  'week',
  'month',
  'quarter',
  'half_year',
  'year',
  'all_time',
  'custom',
]);
export const salesRange = z.enum(['last_7', 'last_30', 'last_90', 'custom']);

/** yyyy-mm-dd (the widget's date inputs). */
export const ymdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');

export const limit = (max: number, def: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

export const shortText = (max: number) => z.string().min(1).max(max);
