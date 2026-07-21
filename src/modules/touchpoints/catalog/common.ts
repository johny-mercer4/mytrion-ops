/** Shared zod pieces for touchpoint param schemas (widget-parity coercions). */
import { z } from 'zod';

/** The sales-panel department tag — `departments` is required on every entry (fail closed). */
export const SALES = ['sales'] as const;

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

/**
 * Bounded passthrough filter map for read-only LIST endpoints whose upstream owns the
 * filter vocabulary (the finance widget forwards panel filters verbatim; servercrm
 * validates them). Keys must be identifier-shaped, values are scalars, and the map is
 * size-capped — enough to keep the query surface sane without re-enumerating every
 * panel's filters here.
 */
export const looseFilters = (maxKeys = 20) =>
  z
    .record(z.union([z.string().max(300), z.number(), z.boolean()]))
    .default({})
    .superRefine((v, ctx) => {
      const keys = Object.keys(v);
      if (keys.length > maxKeys) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${maxKeys} filters` });
      }
      for (const k of keys) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,60}$/.test(k)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid filter name '${k}'` });
        }
      }
    });
