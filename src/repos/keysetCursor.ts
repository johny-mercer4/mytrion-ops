/**
 * Opaque keyset cursors over a `(timestamp, id)` pair.
 *
 * Offset paging is wrong for any feed ordered by creation time: new rows arrive constantly, so page 2 of
 * an OFFSET query silently re-shows or skips rows the moment anything is written. The id is the
 * tiebreaker that makes the ordering total, which is what lets the page boundary be exact.
 *
 * Base64url-encoded rather than exposed as two query params so the pair travels as one value the client
 * cannot meaningfully hand-edit — and so the encoding can change without a client release. It is NOT a
 * security boundary: the decoded values are only ever used as a positional bound inside a query that is
 * already tenant- and reader-filtered.
 *
 * Shared because tickets, escalations and thread lists all page the same way.
 */

export interface KeysetCursor {
  /** ISO timestamp, bound as `::timestamptz`. */
  at: string;
  id: string;
}

export function encodeKeysetCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

/**
 * Decode, or null for anything malformed.
 *
 * A bad cursor must degrade to "start from the top" rather than throw: cursors get bookmarked, replayed
 * after a deploy and truncated by proxies, and a 400 on a stale bookmark is a dead end for the user.
 * `lastIndexOf` splits on the LAST separator so an id containing the delimiter cannot shift the parse.
 */
export function decodeKeysetCursor(cursor: string): KeysetCursor | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    const at = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (id.length === 0 || Number.isNaN(Date.parse(at))) return null;
    return { at, id };
  } catch {
    return null;
  }
}
