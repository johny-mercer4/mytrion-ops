/**
 * Sales Mytrion redesign — Carriers tab. "Carrier Lookup": a single search field that, on Enter
 * or button click, queries the real FMCSA broker snapshot (sales.carriers_search) and renders the
 * matching carriers using the design's account-card primitives (one card per result). Shows a
 * skeleton "searching" state, a red error state, a muted empty state, and the idle prompt until the
 * first search. All state is local; search is user-triggered (no live feed for this tab).
 */
import { useState } from 'react';
import { s, Svg, Badge } from '../dc';
import { badge } from '../salesData';
import { searchCarriers, type CarrierSearchVM } from '../live';

const TRUCK_D =
  'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0z';

/** FMCSA operating status → tone color (mirrors the old Carriers tab's statusTone). */
function statusColor(status: string): string {
  const x = status.toLowerCase();
  if (/^authorized/.test(x) || x === 'active') return 'var(--ok)';
  if (/out.of.service|revoked|inactive/.test(x)) return 'var(--danger)';
  return 'var(--orange)';
}

export function CarriersTab() {
  const [carrierQuery, setCarrierQuery] = useState<string>('');
  const [carrierSearching, setCarrierSearching] = useState<boolean>(false);
  const [results, setResults] = useState<CarrierSearchVM[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState<boolean>(false);

  // ----- view-model: each live carrier row mapped onto the account-card slots -----
  const carrierCards = (results ?? []).map((c) => ({
    ...c,
    statusBadge: badge(c.status, statusColor(c.status)),
    statusColor: statusColor(c.status),
  }));

  const carrierIdle = !carrierSearching && !error && !hasSearched;
  const carrierEmpty = !carrierSearching && !error && hasSearched && carrierCards.length === 0;
  const carrierHas = !carrierSearching && !error && carrierCards.length > 0;

  const runCarrierSearch = async (): Promise<void> => {
    const q = carrierQuery.trim();
    if (!q || carrierSearching) return;
    setCarrierSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const rows = await searchCarriers(q);
      setResults(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults(null);
    } finally {
      setCarrierSearching(false);
    }
  };

  const carrierKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') void runCarrierSearch();
  };

  return (
    <div className="ss-fu" style={s('max-width:760px;margin:0 auto')}>
      <div style={s('margin-bottom:16px')}>
        <div
          style={s(
            'font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase',
          )}
        >
          Carrier Lookup
        </div>
        <div style={s('font-size:12.5px;color:var(--muted);margin-top:2px')}>
          Search any carrier by name, carrier ID, MC or DOT number.
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
          onKeyDown={carrierKey}
          placeholder="e.g. RICS, CR-10428, MC 285921, DOT 602070…"
          className="ss-in"
          style={s(
            'width:100%;height:48px;padding:0 120px 0 44px;border-radius:13px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)',
          )}
        />
        <button
          onClick={() => void runCarrierSearch()}
          className="ss-btn-p"
          style={s(
            'position:absolute;right:8px;top:8px;height:32px;padding:0 18px;border-radius:9px;border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer',
          )}
        >
          Search
        </button>
      </div>
      {carrierSearching && (
        <div style={s('padding:22px;border-radius:16px;background:var(--surface);border:1px solid var(--border)')}>
          <div style={s('display:flex;gap:14px;align-items:center')}>
            <div className="ss-skel" style={s('width:52px;height:52px;border-radius:14px')}></div>
            <div style={s('flex:1')}>
              <div className="ss-skel" style={s('width:44%;height:16px')}></div>
              <div className="ss-skel" style={s('width:28%;height:12px;margin-top:8px')}></div>
            </div>
          </div>
          <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px')}>
            <div className="ss-skel" style={s('height:60px')}></div>
            <div className="ss-skel" style={s('height:60px')}></div>
            <div className="ss-skel" style={s('height:60px')}></div>
            <div className="ss-skel" style={s('height:60px')}></div>
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
              'width:64px;height:64px;border-radius:16px;background:var(--raised);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:var(--accent)',
            )}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
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
        <div style={s('display:flex;flex-direction:column;gap:14px')}>
          {carrierCards.map((carrierCard, i) => (
            <div
              key={`${carrierCard.dot}-${i}`}
              className="ss-fu"
              style={s(
                'padding:22px;border-radius:16px;background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)',
              )}
            >
              <div style={s('display:flex;align-items:center;gap:14px')}>
                <div
                  style={s(
                    'width:52px;height:52px;border-radius:14px;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;display:flex;align-items:center;justify-content:center',
                  )}
                >
                  <Svg d={TRUCK_D} size={24} strokeWidth={1.8} />
                </div>
                <div style={s('flex:1')}>
                  <div style={s('font-size:16px;font-weight:700')}>{carrierCard.owner}</div>
                  <div
                    style={s(
                      "font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px",
                    )}
                  >
                    {carrierCard.address || '—'}
                  </div>
                </div>
                <Badge vm={carrierCard.statusBadge} />
              </div>
              <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px')}>
                <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                  <div style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600")}>
                    {carrierCard.dot}
                  </div>
                  <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>DOT #</div>
                </div>
                <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                  <div
                    style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--ok)")}
                  >
                    {carrierCard.units}
                  </div>
                  <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Power Units</div>
                </div>
                <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                  <div
                    style={s(
                      "font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--violet)",
                    )}
                  >
                    {carrierCard.phone}
                  </div>
                  <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Phone</div>
                </div>
                <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
                  <div
                    style={s(
                      `font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:${carrierCard.statusColor}`,
                    )}
                  >
                    {carrierCard.status}
                  </div>
                  <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Status</div>
                </div>
              </div>
              <div style={s('margin-top:16px;font-size:12.5px;color:var(--muted)')}>
                Email: <strong style={s('color:var(--text2)')}>{carrierCard.email}</strong>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
