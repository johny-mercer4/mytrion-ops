/**
 * Sales Mytrion — Carrier Lookup (self-service CarrierSearchPanel parity).
 * Search → client filters (status / has contact / min units) → Create Lead per row
 * with DUPLICATE_DATA → "Already exists ↗" / success → Lead #xxxxxx deep link.
 *
 * Fetch 200/500 re-runs the search with that limit (widget `@change="search"`).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { s, Badge } from '../dc';
import { Icon } from '../icons';
import { badge } from '../salesData';
import { searchCarriers, type CarrierSearchVM } from '../live';
import { createLeadFromCarrier } from '../carrierLead';
import { leadShortId, zohoLeadUrl } from '../crmUrls';

function statusColor(status: string): string {
  const x = status.toLowerCase();
  if (/^authorized/.test(x) || x === 'active') return 'var(--ok)';
  if (/out.of.service|revoked|inactive/.test(x)) return 'var(--danger)';
  return 'var(--orange)';
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'authorized', label: 'Authorized' },
  { id: 'not_authorized', label: 'Not Authorized' },
  { id: 'out_of_service', label: 'Out of Service' },
] as const;
type CarrierStatusKey = (typeof STATUS_FILTERS)[number]['id'];

function statusKey(status: string): Exclude<CarrierStatusKey, 'all'> | 'other' {
  const st = status.toLowerCase();
  if (st.includes('out of service')) return 'out_of_service';
  if (st.includes('not authorized') || st.includes('revoked')) return 'not_authorized';
  if (st.includes('authorized')) return 'authorized';
  return 'other';
}

const FETCH_LIMITS = [200, 500] as const;
const PAGE_SIZES = [50, 100] as const;

type LeadResult = {
  ok: boolean;
  duplicate: boolean;
  leadId: string;
  message: string;
};

function hasContact(c: CarrierSearchVM): boolean {
  const phone = c.phone !== '—' && c.phone.trim() !== '';
  const email = c.email !== '—' && c.email.trim() !== '';
  return phone || email;
}

function LeadAction(props: {
  result: LeadResult | undefined;
  busy: boolean;
  disabled: boolean;
  onCreate: () => void;
}): ReactNode {
  const { result, busy, disabled, onCreate } = props;
  if (!result) {
    return (
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled || busy}
        className={!disabled && !busy ? 'ss-btn-p' : undefined}
        style={s(
          `height:34px;padding:0 14px;border-radius:var(--radius-md);border:none;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:8px;${
            busy || disabled
              ? 'background:var(--raised);color:var(--faint);cursor:not-allowed'
              : 'background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);cursor:pointer'
          }`,
        )}
      >
        {busy ? (
          <>
            <span
              style={s(
                'width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:ss-spin .8s linear infinite',
              )}
            />
            Creating…
          </>
        ) : (
          'Create Lead'
        )}
      </button>
    );
  }
  if (result.ok && result.leadId && !result.duplicate) {
    return (
      <a
        href={zohoLeadUrl(result.leadId)}
        target="_blank"
        rel="noopener noreferrer"
        style={s(
          'display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--ok) 40%,var(--border));background:color-mix(in srgb,var(--ok) 12%,transparent);color:var(--ok);font-weight:700;font-size:12px;text-decoration:none',
        )}
      >
        Lead #{leadShortId(result.leadId)} ↗
      </a>
    );
  }
  if (result.duplicate && result.leadId) {
    return (
      <a
        href={zohoLeadUrl(result.leadId)}
        target="_blank"
        rel="noopener noreferrer"
        title="Lead already exists — click to open"
        style={s(
          'display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--orange) 45%,var(--border));background:color-mix(in srgb,var(--orange) 12%,transparent);color:var(--orange);font-weight:700;font-size:12px;text-decoration:none',
        )}
      >
        Already exists ↗
      </a>
    );
  }
  // Failed → a clickable Retry (a transient error shouldn't strand the row until a full re-search).
  return (
    <button
      type="button"
      onClick={onCreate}
      disabled={busy}
      title={`${result.message} — click to retry`}
      style={s(
        `display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 40%,var(--border));background:color-mix(in srgb,var(--danger) 8%,transparent);color:var(--danger);font-weight:700;font-size:12px;cursor:${busy ? 'wait' : 'pointer'}`,
      )}
    >
      {busy ? 'Retrying…' : 'Failed — retry'}
    </button>
  );
}

export function CarriersTab() {
  const [carrierQuery, setCarrierQuery] = useState('');
  const [carrierSearching, setCarrierSearching] = useState(false);
  const [results, setResults] = useState<CarrierSearchVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CarrierStatusKey>('all');
  const [onlyWithContact, setOnlyWithContact] = useState(false);
  const [minUnits, setMinUnits] = useState('');
  const [fetchLimit, setFetchLimit] = useState<number>(200);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState(1);
  const [totalMatches, setTotalMatches] = useState(0);
  const [moreRecords, setMoreRecords] = useState(false);
  const [leadLoadingId, setLeadLoadingId] = useState<string | null>(null);
  const [leadResults, setLeadResults] = useState<Record<string, LeadResult>>({});

  const all = results ?? [];
  const minU = Number(minUnits);
  const filtered = all.filter((c) => {
    if (statusFilter !== 'all' && statusKey(c.status) !== statusFilter) return false;
    if (onlyWithContact && !hasContact(c)) return false;
    if (Number.isFinite(minU) && minU > 0 && c.unitsNum < minU) return false;
    return true;
  });
  const counts: Record<string, number> = { all: all.length, authorized: 0, not_authorized: 0, out_of_service: 0 };
  for (const row of all) {
    const k = statusKey(row.status);
    if (k in counts) counts[k] = (counts[k] ?? 0) + 1;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const paged = filtered.slice(pageStart, pageStart + pageSize);

  // Keep page state in bounds after filters / page-size shrink the result set.
  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const hasActiveFilters = statusFilter !== 'all' || onlyWithContact || minUnits.trim() !== '';
  const clearFilters = (): void => {
    setStatusFilter('all');
    setOnlyWithContact(false);
    setMinUnits('');
    setPage(1);
  };

  const carrierIdle = !carrierSearching && !error && !hasSearched;
  const carrierEmpty = !carrierSearching && !error && hasSearched && all.length === 0;
  const carrierHas = !carrierSearching && !error && all.length > 0;

  /** `limitOverride` avoids the React setState race when Fetch 200→500 re-runs search. */
  const runCarrierSearch = async (limitOverride?: number): Promise<void> => {
    const q = carrierQuery.trim();
    if (!q || carrierSearching) return;
    const limit = limitOverride ?? fetchLimit;
    setCarrierSearching(true);
    setError(null);
    setHasSearched(true);
    setPage(1);
    setLeadResults({});
    setMoreRecords(false);
    try {
      const pageRes = await searchCarriers(q, limit);
      setResults(pageRes.rows);
      setTotalMatches(pageRes.total);
      setMoreRecords(pageRes.moreRecords);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults(null);
      setTotalMatches(0);
      setMoreRecords(false);
    } finally {
      setCarrierSearching(false);
    }
  };

  const onFetchLimitChange = (next: number): void => {
    setFetchLimit(next);
    // Widget: changing Fetch immediately re-queries with the new window.
    if (hasSearched && carrierQuery.trim()) void runCarrierSearch(next);
  };

  const onCreateLead = async (c: CarrierSearchVM): Promise<void> => {
    // Block while a create is in flight or already succeeded; a FAILED result may be retried.
    if (leadLoadingId || leadResults[c.id]?.ok) return;
    setLeadLoadingId(c.id);
    try {
      const outcome = await createLeadFromCarrier(c);
      setLeadResults((prev) => ({ ...prev, [c.id]: outcome }));
    } catch (e) {
      setLeadResults((prev) => ({
        ...prev,
        [c.id]: {
          ok: false,
          duplicate: false,
          leadId: '',
          message: e instanceof Error ? e.message : 'Unexpected error. Please try again.',
        },
      }));
    } finally {
      setLeadLoadingId(null);
    }
  };

  return (
    <div className="ss-fu" style={s('max-width:1180px;margin:0 auto')}>
      <div style={s('margin-bottom:16px')}>
        <div
          style={s(
            'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase',
          )}
        >
          Carrier Lookup
        </div>
        <div style={s('font-size:13px;color:var(--muted);margin-top:2px')}>
          Search by DOT number, company name, or phone — then create a lead when it’s a fit.
        </div>
      </div>

      <div style={s('position:relative;margin-bottom:18px')}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')}
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={carrierQuery}
          onChange={(e) => setCarrierQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runCarrierSearch();
          }}
          placeholder="e.g. 98765 · Great Way Inc · 5551234567"
          className="ss-in"
          style={s(
            'width:100%;height:48px;padding:0 120px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)',
          )}
        />
        <button
          type="button"
          onClick={() => void runCarrierSearch()}
          disabled={carrierSearching || !carrierQuery.trim()}
          className="ss-btn-p"
          style={s(
            'position:absolute;right:8px;top:8px;height:32px;padding:0 18px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer',
          )}
        >
          {carrierSearching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {carrierSearching && (
        <div style={s('padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;gap:14px;align-items:center')}>
            <div className="ss-skel" style={s('width:52px;height:52px;border-radius:var(--radius-md)')} />
            <div style={s('flex:1')}>
              <div className="ss-skel" style={s('width:44%;height:16px')} />
              <div className="ss-skel" style={s('width:28%;height:12px;margin-top:8px')} />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div style={s('text-align:center;padding:56px 20px;color:var(--danger);font-size:13px')}>{error}</div>
      )}
      {carrierIdle && (
        <div style={s('text-align:center;padding:56px 20px;color:var(--muted)')}>
          <div
            style={s(
              'width:64px;height:64px;border-radius:var(--radius-md);background:var(--raised);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:var(--accent)',
            )}
          >
            <Icon name="carriers" size={30} strokeWidth={1.6} />
          </div>
          <div style={s('font-size:13px')}>Search for a carrier to see their account at a glance.</div>
        </div>
      )}
      {carrierEmpty && (
        <div style={s('text-align:center;padding:56px 20px;color:var(--muted);font-size:13px')}>
          No carriers found for “{carrierQuery.trim()}”.
        </div>
      )}

      {carrierHas && (
        <div style={s('display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px')}>
          {STATUS_FILTERS.map((f) => {
            const on = statusFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setStatusFilter(f.id);
                  setPage(1);
                }}
                style={s(
                  `display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;border:1px solid ${on ? 'var(--accent)' : 'var(--border)'};background:${on ? 'rgba(var(--accent-rgb),.12)' : 'transparent'};color:${on ? 'var(--accent)' : 'var(--muted)'};font-size:12px;font-weight:700;cursor:pointer`,
                )}
              >
                {f.label}
                <span
                  style={s(
                    `font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:800;color:${on ? 'var(--accent)' : 'var(--faint)'}`,
                  )}
                >
                  {counts[f.id] ?? 0}
                </span>
              </button>
            );
          })}
          <label
            style={s(
              'display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:99px;border:1px solid var(--border);font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;user-select:none',
            )}
          >
            <input
              type="checkbox"
              checked={onlyWithContact}
              onChange={(e) => {
                setOnlyWithContact(e.currentTarget.checked);
                setPage(1);
              }}
            />
            Has phone / email
          </label>
          <div style={s('display:flex;align-items:center;gap:7px')}>
            <span style={s('font-size:11px;color:var(--muted);font-weight:600')}>Min units</span>
            <input
              type="number"
              min={0}
              value={minUnits}
              onChange={(e) => {
                setMinUnits(e.currentTarget.value);
                setPage(1);
              }}
              placeholder="0"
              className="ss-in"
              style={s(
                'width:72px;height:32px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px',
              )}
            />
          </div>
          <div style={s('display:flex;align-items:center;gap:7px')}>
            <span style={s('font-size:11px;color:var(--muted);font-weight:600')}>Fetch</span>
            <select
              value={fetchLimit}
              onChange={(e) => onFetchLimitChange(Number(e.currentTarget.value))}
              disabled={carrierSearching}
              className="ss-in"
              title="How many matches to load from the server (200 or 500)"
              style={s(
                'height:32px;padding:0 8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px;cursor:pointer',
              )}
            >
              {FETCH_LIMITS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              style={s(
                'padding:6px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:transparent;color:var(--muted);font-size:12px;font-weight:700;cursor:pointer',
              )}
            >
              Clear
            </button>
          )}
          <span style={s('margin-left:auto;font-size:11px;color:var(--faint);text-align:right')}>
            {filtered.length === 0
              ? '0 carriers'
              : `Showing ${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length}`}
            {filtered.length !== all.length ? ` (from ${all.length} loaded)` : ''}
            {moreRecords && totalMatches > all.length
              ? ` · ${all.length.toLocaleString()} of ${totalMatches.toLocaleString()} matches — refine your search to narrow`
              : ''}
          </span>
        </div>
      )}

      {carrierHas && filtered.length === 0 && (
        <div style={s('text-align:center;padding:44px 20px;color:var(--muted);font-size:13px')}>
          No carriers match the current filters.{' '}
          <button
            type="button"
            onClick={clearFilters}
            style={s('border:none;background:transparent;color:var(--accent);font-weight:700;cursor:pointer;font-size:13px')}
          >
            Clear filters
          </button>
        </div>
      )}

      {carrierHas && paged.length > 0 && (
        <div style={s('display:flex;flex-direction:column;gap:14px')}>
          {paged.map((c) => {
            const statusBadge = badge(c.status, statusColor(c.status));
            return (
              <div
                key={c.id}
                className="ss-fu"
                style={s(
                  'padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)',
                )}
              >
                <div style={s('display:flex;align-items:center;gap:14px')}>
                  <div
                    style={s(
                      'width:52px;height:52px;border-radius:var(--radius-md);background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0',
                    )}
                  >
                    <Icon name="carriers" size={24} strokeWidth={1.8} />
                  </div>
                  <div style={s('flex:1;min-width:0')}>
                    <div style={s('font-size:16px;font-weight:700')}>{c.owner}</div>
                    <div
                      style={s(
                        "font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px",
                      )}
                    >
                      {c.address || '—'}
                    </div>
                  </div>
                  <Badge vm={statusBadge} />
                  <LeadAction
                    result={leadResults[c.id]}
                    busy={leadLoadingId === c.id}
                    disabled={!!leadLoadingId && leadLoadingId !== c.id}
                    onCreate={() => void onCreateLead(c)}
                  />
                </div>
                <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px')}>
                  <div style={s('padding:14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600")}>{c.dot}</div>
                    <div style={s('font-size:11px;color:var(--muted);margin-top:3px')}>DOT #</div>
                  </div>
                  <div style={s('padding:14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--ok)")}>{c.units}</div>
                    <div style={s('font-size:11px;color:var(--muted);margin-top:3px')}>Power Units</div>
                  </div>
                  <div style={s('padding:14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                    <div style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--violet)")}>{c.phone}</div>
                    <div style={s('font-size:11px;color:var(--muted);margin-top:3px')}>Phone</div>
                  </div>
                  <div style={s('padding:14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                    <div style={s(`font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:600;color:${statusColor(c.status)}`)}>{c.status}</div>
                    <div style={s('font-size:11px;color:var(--muted);margin-top:3px')}>Status</div>
                  </div>
                </div>
                <div style={s('margin-top:16px;font-size:13px;color:var(--muted)')}>
                  Email: <strong style={s('color:var(--text2)')}>{c.email}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {carrierHas && filtered.length > pageSize && (
        <div style={s('display:flex;align-items:center;justify-content:center;gap:12px;margin-top:18px')}>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={s(
              `height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;font-size:12px;${safePage <= 1 ? 'color:var(--faint);cursor:not-allowed' : 'color:var(--text);cursor:pointer'}`,
            )}
          >
            Prev
          </button>
          <span style={s('font-size:12px;color:var(--muted)')}>
            Page <strong style={s('color:var(--text)')}>{safePage}</strong> of {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={s(
              `height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;font-size:12px;${safePage >= totalPages ? 'color:var(--faint);cursor:not-allowed' : 'color:var(--text);cursor:pointer'}`,
            )}
          >
            Next
          </button>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.currentTarget.value));
              setPage(1);
            }}
            className="ss-in"
            style={s(
              'height:34px;padding:0 8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:12px;cursor:pointer',
            )}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
