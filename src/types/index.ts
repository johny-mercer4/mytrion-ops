export * from './tenantContext.js';

/** A JSON-serializable value. */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
