/**
 * The two list projections must select the same columns.
 *
 * `VERIFICATION_FLOW_LIST_COLUMNS` (Drizzle) is what the desk and Sales list queries project;
 * `VERIFICATION_FLOW_LIST_COLUMN_SQL` is the hand-written twin the one-round-trip queue bundle
 * uses. `verificationFlowRepo` has claimed since it was written that this file keeps them in step —
 * it did not exist, and adding the Deal owner to one and not the other is exactly the drift it
 * describes: the bundle would return rows with no `zoho_owner_name` and the queue would render
 * every case as unassigned.
 */
import { describe, expect, it } from 'vitest';
import {
  VERIFICATION_FLOW_LIST_COLUMNS,
  VERIFICATION_FLOW_LIST_COLUMN_SQL,
} from '../../src/repos/verificationFlowRepo.js';

/** `zohoOwnerId` → `zoho_owner_id`. The columns are all plain snake_case of their TS key. */
function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

describe('verification flow list projection', () => {
  it('selects the same columns in both spellings', () => {
    const drizzle = Object.keys(VERIFICATION_FLOW_LIST_COLUMNS).map(snake).sort();
    // `sql.raw` keeps its text in one StringChunk's `value` array, not in a joinable string.
    const text = (VERIFICATION_FLOW_LIST_COLUMN_SQL.queryChunks as Array<{ value?: string[] }>)
      .flatMap((chunk) => chunk.value ?? [])
      .join('');
    const raw = text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(raw).toEqual(drizzle);
  });

  /**
   * Both owners, deliberately. The desk shows the Sales agent (`zoho_owner_*`, the Deal's owner) and
   * scopes the Sales list by the assignee (`owner_*`), so dropping either breaks one of the two desks.
   */
  it('carries the Deal owner as well as the assignee', () => {
    for (const key of ['ownerName', 'ownerZohoUserId', 'zohoOwnerName', 'zohoOwnerId'] as const) {
      expect(VERIFICATION_FLOW_LIST_COLUMNS, key).toHaveProperty(key);
    }
  });
});
