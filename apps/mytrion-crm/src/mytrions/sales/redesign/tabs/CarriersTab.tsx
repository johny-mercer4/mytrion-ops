/**
 * Sales Mytrion redesign — Carriers tab. Ported from the reference prototype
 * (carriers.html + script.js carrier handlers) at pixel fidelity: a single "Carrier Lookup"
 * search field that, on Enter or button click, shows a skeleton "searching" state for ~1.3s
 * then resolves to a matched RECORDS account card (or the first record as a fallback). The
 * idle empty state shows until the first search. All state is local.
 */
import { useState, useRef } from 'react';
import { s, Svg, Badge } from '../dc';
import { badge } from '../salesData';
import { RECORDS } from '../mock';

type CarrierRec = (typeof RECORDS)[number];

const recStatus: Record<CarrierRec['status'], [string, string]> = {
  active: ['Active', 'var(--ok)'],
  attention: ['Needs attention', 'var(--orange)'],
  debtor: ['Debtor', 'var(--danger)'],
};

const TRUCK_D =
  'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1M9 17a2 2 0 11-4 0 2 2 0 014 0zm10 0a2 2 0 11-4 0 2 2 0 014 0z';

export function CarriersTab() {
  const [carrierQuery, setCarrierQuery] = useState<string>('');
  const [carrierSearching, setCarrierSearching] = useState<boolean>(false);
  const [carrierResult, setCarrierResult] = useState<CarrierRec | null>(null);
  const carTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----- view-model (mirrors renderVals() `carriers` block) -----
  const carrierCard = carrierResult
    ? {
        ...carrierResult,
        statusBadge: badge(recStatus[carrierResult.status][0], recStatus[carrierResult.status][1]),
        balColor: carrierResult.balance.startsWith('-') ? 'var(--danger)' : 'var(--ok)',
      }
    : null;
  const carrierHas = !!carrierCard;
  const carrierIdle = !carrierResult && !carrierSearching;

  const runCarrierSearch = (): void => {
    const q = carrierQuery.trim();
    if (!q) return;
    setCarrierSearching(true);
    setCarrierResult(null);
    if (carTimer.current) clearTimeout(carTimer.current);
    carTimer.current = setTimeout(() => {
      const rec =
        RECORDS.find((r) =>
          (r.name + ' ' + r.carrier + ' ' + r.mc + ' ' + r.dot).toLowerCase().includes(q.toLowerCase()),
        ) ?? RECORDS[0];
      setCarrierSearching(false);
      setCarrierResult(rec);
    }, 1300);
  };

  const carrierKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') runCarrierSearch();
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
          onClick={runCarrierSearch}
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
      {carrierHas && carrierCard && (
        <div
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
              <div style={s('font-size:16px;font-weight:700')}>{carrierCard.name}</div>
              <div
                style={s(
                  "font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px",
                )}
              >
                {carrierCard.carrier} · MC {carrierCard.mc} · DOT {carrierCard.dot}
              </div>
            </div>
            <Badge vm={carrierCard.statusBadge} />
          </div>
          <div style={s('display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:20px')}>
            <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
              <div style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600")}>
                {carrierCard.cards}
              </div>
              <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Total Cards</div>
            </div>
            <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
              <div
                style={s("font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--ok)")}
              >
                {carrierCard.active}
              </div>
              <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Active</div>
            </div>
            <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
              <div
                style={s(
                  "font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:var(--violet)",
                )}
              >
                {carrierCard.gallons}
              </div>
              <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Gallons</div>
            </div>
            <div style={s('padding:14px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)')}>
              <div
                style={s(
                  `font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:600;color:${carrierCard.balColor}`,
                )}
              >
                {carrierCard.balance}
              </div>
              <div style={s('font-size:10.5px;color:var(--muted);margin-top:3px')}>Balance</div>
            </div>
          </div>
          <div style={s('margin-top:16px;font-size:12.5px;color:var(--muted)')}>
            Contact: <strong style={s('color:var(--text2)')}>{carrierCard.contact}</strong> · {carrierCard.phone}
          </div>
        </div>
      )}
    </div>
  );
}
