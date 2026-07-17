/**
 * Client drilldown modal — Overview / Cards / Activity / Manage (registration links).
 */
import { useEffect, useState } from 'react';

import { ClientManagePanel } from './ClientManagePanel';
import {
  loadClientCards,
  loadClientActivity,
  CLIENT_ACTIVITY_PAGE,
  type ClientActivityVM,
} from './clientDrilldown';
import type { ClientRecord } from './ctx';
import { s } from './dc';
import { Icon } from './icons';
import { useLoad } from './live';
import { badge } from './salesData';

export type ClientModalTab = 'overview' | 'cards' | 'activity' | 'manage';

const REC_STATUS: Record<ClientRecord['status'], [string, string]> = {
  active: ['Active', 'var(--ok)'],
  attention: ['Needs attention', 'var(--orange)'],
  debtor: ['Debtor', 'var(--danger)'],
};

export function ClientModal({
  client,
  clientTab,
  setClientTab,
  onClose,
  onRun,
}: {
  client: ClientRecord;
  clientTab: ClientModalTab;
  setClientTab: (t: ClientModalTab) => void;
  onClose: () => void;
  onRun: () => void;
}) {
  const [lbl, col] = REC_STATUS[client.status];
  const statusBadge = badge(lbl, col);
  const initials = client.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const cardsL = useLoad(() => loadClientCards(client.id), [client.id]);
  const [actRows, setActRows] = useState<ClientActivityVM[]>([]);
  const [actLimit, setActLimit] = useState(CLIENT_ACTIVITY_PAGE);
  const [actHasMore, setActHasMore] = useState(false);
  const [actLoading, setActLoading] = useState(false);
  const [actLoadingMore, setActLoadingMore] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setActRows([]);
    setActLimit(CLIENT_ACTIVITY_PAGE);
    setActHasMore(false);
    setActError(null);
    setActLoading(true);
    void loadClientActivity(client.id, CLIENT_ACTIVITY_PAGE)
      .then((page) => {
        if (off) return;
        setActRows(page.rows);
        setActHasMore(page.hasMore);
        setActLimit(page.limit);
      })
      .catch((e: unknown) => {
        if (!off) setActError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!off) setActLoading(false);
      });
    return () => {
      off = true;
    };
  }, [client.id]);

  const loadMoreActivity = (): void => {
    if (actLoadingMore || !actHasMore) return;
    const next = actLimit + CLIENT_ACTIVITY_PAGE;
    setActLoadingMore(true);
    void loadClientActivity(client.id, next)
      .then((page) => {
        setActRows(page.rows);
        setActHasMore(page.hasMore && page.rows.length > actRows.length);
        setActLimit(page.limit);
      })
      .catch((e: unknown) => setActError(e instanceof Error ? e.message : 'Failed to load more'))
      .finally(() => setActLoadingMore(false));
  };

  const avStyle = `width:52px;height:52px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
  const tabs: Array<[ClientModalTab, string]> = [
    ['overview', 'Overview'],
    ['cards', 'Cards'],
    ['activity', 'Activity'],
    ['manage', 'Manage'],
  ];
  const tile = 'padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:118;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle)}>{initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{client.name}</div>
            <div style={s("font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.carrier} · MC {client.mc} · DOT {client.dot}</div>
          </div>
          <span style={s(statusBadge.style)}>{statusBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div style={s('display:flex;gap:4px;padding:0 22px;border-bottom:1px solid var(--border);overflow-x:auto')}>
          {tabs.map(([id, label]) => {
            const on = clientTab === id;
            return (
              <button key={id} onClick={() => setClientTab(id)} style={s(`padding:8px 15px;border:none;background:none;border-bottom:2px solid ${on ? 'var(--accent)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--muted)'};font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap`)}>{label}</button>
            );
          })}
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
          {clientTab === 'overview' && (
            <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
              <div style={s(`grid-column:1 / span 2;${tile}`)}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Primary Contact</div>
                <div style={s('font-size:14px;font-weight:700;margin-top:5px')}>{client.contact}</div>
                <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:3px")}>{client.phone}</div>
              </div>
              <div style={s(tile)}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Cards</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px")}>{client.active}<span style={s('color:var(--muted);font-size:14px')}>/{client.cards}</span> active</div>
              </div>
              <div style={s(tile)}>
                <div style={s('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Gallons · Cycle</div>
                <div style={s("font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600;margin-top:5px;color:var(--violet)")}>{client.gallons}</div>
              </div>
            </div>
          )}
          {clientTab === 'cards' && (
            <div style={s('display:flex;flex-direction:column;gap:10px')}>
              {cardsL.loading && <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>Loading cards…</div>}
              {cardsL.error && <div style={s('font-size:12.5px;color:var(--danger);padding:8px 2px')}>Couldn't load cards — {cardsL.error}</div>}
              {!cardsL.loading && !cardsL.error && (cardsL.data?.length ?? 0) === 0 && (
                <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>No cards on file for this carrier.</div>
              )}
              {(cardsL.data ?? []).map((card, i) => (
                <div key={`${card.num}-${i}`} style={s('display:flex;align-items:center;gap:12px;padding:13px 15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
                  <span style={s("font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600")}>{card.num}</span>
                  <span style={s(`font-size:10px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,${card.tone} 16%,transparent);color:${card.tone}`)}>{card.status}</span>
                </div>
              ))}
            </div>
          )}
          {clientTab === 'activity' && (
            <div style={s('display:flex;flex-direction:column;gap:0')}>
              {actLoading && <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>Loading activity…</div>}
              {actError && <div style={s('font-size:12.5px;color:var(--danger);padding:8px 2px')}>Couldn't load activity — {actError}</div>}
              {!actLoading && !actError && actRows.length === 0 && (
                <div style={s('font-size:12.5px;color:var(--muted);padding:8px 2px')}>No transactions for this carrier.</div>
              )}
              {actRows.map((ev, i, arr) => {
                const line = i < arr.length - 1;
                return (
                  <div key={`${ev.title}-${i}`} style={s('display:flex;gap:12px')}>
                    <div style={s('display:flex;flex-direction:column;align-items:center')}>
                      <div style={s(`width:9px;height:9px;border-radius:50%;background:${ev.tone}`)} />
                      {line ? <div style={s('width:2px;flex:1;background:var(--border)')} /> : null}
                    </div>
                    <div style={s(line ? 'padding-bottom:18px' : '')}>
                      <div style={s('font-size:12.5px;font-weight:700')}>{ev.title}</div>
                      <div style={s('font-size:11px;color:var(--muted);margin-top:2px')}>{ev.sub}</div>
                    </div>
                  </div>
                );
              })}
              {actHasMore && (
                <button
                  type="button"
                  disabled={actLoadingMore}
                  onClick={loadMoreActivity}
                  style={s('margin-top:16px;height:36px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12px;cursor:pointer;opacity:' + (actLoadingMore ? '.6' : '1'))}
                >
                  {actLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          )}
          {clientTab === 'manage' && (
            <ClientManagePanel carrierId={client.id} companyName={client.name} />
          )}
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
          {clientTab !== 'manage' && (
            <button onClick={onRun} className="ss-btn-p" style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px;cursor:pointer')}>Run an action</button>
          )}
        </div>
      </div>
    </div>
  );
}
