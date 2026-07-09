/** Shared zod pieces for touchpoint param schemas (widget-parity coercions). */
import { z } from 'zod';

/** Ids arrive as strings or numbers from the UI — normalize to trimmed strings. */
export const idString = z
  .union([z.string().min(1).max(120), z.number()])
  .transform((v) => String(v).trim());

export const carrierId = idString;
export const cardNumber = z.string().min(4).max(30);

/** Date range keyword used by servercrm reporting endpoints. */
export const rangeKeyword = z.enum(['last_7', 'last_30', 'last_90', 'all_time', 'custom']);

/** yyyy-mm-dd (the widget's date inputs). */
export const ymdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd');

export const limit = (max: number, def: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

export const shortText = (max: number) => z.string().min(1).max(max);
