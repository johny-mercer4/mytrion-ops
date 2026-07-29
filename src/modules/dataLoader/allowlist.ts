/**
 * Tier-1 Data Loader surface.
 *
 * Keep this list in exact lockstep with scripts/nocodb-role.sql and the trigger attachments in
 * migration 0069. A test compares all three so a table can never become writable without a journal.
 */
export const DATA_LOADER_TABLES = [
  'client_news',
  'client_news_reads',
  'scope_risk_items',
  'mytrion_calls',
] as const;

export type DataLoaderTable = (typeof DATA_LOADER_TABLES)[number];

export function isDataLoaderTable(value: string): value is DataLoaderTable {
  return (DATA_LOADER_TABLES as readonly string[]).includes(value);
}

