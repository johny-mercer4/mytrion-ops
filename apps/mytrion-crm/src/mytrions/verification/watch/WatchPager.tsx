/**
 * Pager for the watchlist.
 *
 * The list is worst-first, so page 1 is where the work is — but every carrier has to be reachable,
 * and a capped list with a footnote made a partial view look like the whole book. Numbered pages
 * rather than next-only, because "check the bottom of the book" is a real task on a credit desk and
 * fifteen clicks to reach it is not a design.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Page numbers around `page`, with gaps marked null so the caller renders an ellipsis. */
export function pageWindow(page: number, pages: number, span = 1): Array<number | null> {
  if (pages <= 1) return [0];
  const keep = new Set<number>([0, pages - 1]);
  for (let i = page - span; i <= page + span; i += 1) {
    if (i >= 0 && i < pages) keep.add(i);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  let prev = -1;
  for (const n of sorted) {
    // An ellipsis standing in for ONE page is worse than the page: same width, one more click.
    if (prev >= 0 && n - prev === 2) out.push(prev + 1);
    else if (prev >= 0 && n - prev > 2) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

export function WatchPager({
  page,
  pageSize,
  total,
  busy,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  busy: boolean;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <nav className="mw-pager" aria-label="Watchlist pages">
      <span className="mw-pager-count" role="status">
        {from}–{to} of {total} carriers
      </span>

      {pages > 1 ? (
        <span className="mw-pager-controls">
          <button
            type="button"
            className="mw-page"
            disabled={page === 0 || busy}
            aria-label="Previous page"
            onClick={() => onPage(Math.max(0, page - 1))}
          >
            <ChevronLeft size={14} aria-hidden />
          </button>

          {pageWindow(page, pages).map((n, i) =>
            n === null ? (
              <span key={`gap-${i}`} className="mw-page-gap" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className="mw-page"
                aria-current={n === page ? 'page' : undefined}
                disabled={busy}
                onClick={() => onPage(n)}
              >
                {n + 1}
              </button>
            ),
          )}

          <button
            type="button"
            className="mw-page"
            disabled={page >= pages - 1 || busy}
            aria-label="Next page"
            onClick={() => onPage(Math.min(pages - 1, page + 1))}
          >
            <ChevronRight size={14} aria-hidden />
          </button>
        </span>
      ) : null}
    </nav>
  );
}
