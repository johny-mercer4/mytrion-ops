/**
 * WEX application search panel — the Automations modal's "search" action, extracted from
 * AutoTab (which sits at the file-size cap). Self-contained: owns the query/result state and
 * resets it by remounting (the modal renders it only while a search automation is open).
 *
 * Race guard: rapid searches keep a monotonic request id (seqRef) and only the LATEST
 * request may commit results — the same staleness rule live.ts's useLoad applies.
 */
import { useRef, useState } from 'react';
import { callTouchpoint } from '@/api/touchpoints';
import { s, Badge } from './dc';
import { badge } from './salesData';
import { mapWex, mapWexSearchRow, type WexResult } from './autoLive';

interface WexQ { appId: string; last: string; mc: string; }

const inp40 = 'width:100%;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px';
const labelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const dropMsg = 'padding:14px;font-size:12.5px;color:var(--muted);text-align:center';
const dropErr = 'padding:14px;font-size:12.5px;color:var(--danger);text-align:center';
const mono = "font-family:'JetBrains Mono',monospace";
const grad = 'linear-gradient(120deg,var(--accent),var(--accent-2))';
const btnP = (extra: string): string => `border:none;background:${grad};color:#fff;font-weight:700;cursor:pointer;${extra}`;
const skel8 = [1, 2, 3, 4, 5, 6, 7, 8];

function Lbl({ t }: { t: string }) { return <div style={s(labelCss)}>{t}</div>; }

export function AutoWexPanel() {
  const [wexQ, setWexQ] = useState<WexQ>({ appId: '', last: '', mc: '' });
  const [wexSearching, setWexSearching] = useState(false);
  const [wexResults, setWexResults] = useState<readonly WexResult[] | null>(null);
  const [wexErr, setWexErr] = useState<string | null>(null);
  const seqRef = useRef(0);

  const setWexField = (k: keyof WexQ, v: string): void => setWexQ((q) => ({ ...q, [k]: v }));

  const runWex = (): void => {
    const appId = wexQ.appId.trim();
    const lastName = wexQ.last.trim();
    const mc = wexQ.mc.trim();
    setWexResults(null); setWexErr(null);
    if (!appId && !lastName && !mc) { setWexErr('Enter an Application ID, last name, or MC number.'); return; }
    setWexSearching(true);
    const seq = ++seqRef.current;
    const search = appId && !lastName && !mc
      ? callTouchpoint('wex.application', { appId }).then((res) => {
          if (!res || res.found === false) return [] as WexResult[];
          return [mapWex(res, appId)];
        })
      : callTouchpoint('wex.applications_search', {
          ...(appId ? { appId } : {}),
          ...(lastName ? { lastName } : {}),
          ...(mc ? { mc } : {}),
        }).then((res) => {
          const rows = (res.data ?? res.applications ?? []) as Array<Record<string, unknown>>;
          return rows.map((r, i) => mapWexSearchRow(r, i));
        });
    search
      .then((rows) => { if (seq === seqRef.current) setWexResults(rows); })
      .catch((e: unknown) => {
        if (seq !== seqRef.current) return;
        setWexErr(e instanceof Error ? e.message : 'Search failed.');
        setWexResults([]);
      })
      .finally(() => { if (seq === seqRef.current) setWexSearching(false); });
  };

  const wexResultsVM = (wexResults ?? []).map((r) => ({ ...r, statusBadge: badge(r.group, r.group === 'Complete' ? 'var(--ok)' : 'var(--warn)') }));
  const wexShow = wexResults !== null && !wexSearching;

  return (
    <div>
      <div style={s('font-size:12.5px;color:var(--text2);margin-bottom:12px')}>Search WEX applications by Application ID, last name, or MC.</div>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
        <div><Lbl t="Application ID" /><input value={wexQ.appId} onChange={(e) => setWexField('appId', e.target.value)} placeholder="e.g. 872228" className="ss-in" style={s(inp40)} /></div>
        <div><Lbl t="Last Name" /><input value={wexQ.last} onChange={(e) => setWexField('last', e.target.value)} placeholder="e.g. Crossan" className="ss-in" style={s(inp40)} /></div>
        <div><Lbl t="MC Number" /><input value={wexQ.mc} onChange={(e) => setWexField('mc', e.target.value)} placeholder="e.g. 285921" className="ss-in" style={s(inp40)} /></div>
        <div style={s('display:flex;align-items:flex-end')}><button onClick={runWex} className="ss-btn-p" style={s(btnP('width:100%;height:40px;border-radius:10px;font-size:13px'))}>Search</button></div>
      </div>
      {wexSearching && <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:9px')}>{skel8.map((sk) => <div key={sk} style={s('display:flex;gap:10px;padding:13px;border-radius:11px;background:var(--alt);border:1px solid var(--border2)')}><div className="ss-skel" style={s('flex:1;height:14px')}></div><div className="ss-skel" style={s('width:60px;height:14px')}></div></div>)}</div>}
      {wexErr && <div style={s(`margin-top:16px;${dropErr}`)}>{wexErr}</div>}
      {wexShow && wexResultsVM.length === 0 && !wexErr && <div style={s(`margin-top:16px;${dropMsg}`)}>No applications found.</div>}
      {wexShow && wexResultsVM.length > 0 && (
        <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:9px')}>
          {wexResultsVM.map((r) => (
            <div key={r.appId} className="ss-card-h" style={s('padding:13px 15px;border-radius:12px;background:var(--surface);border:1px solid var(--border)')}>
              <div style={s('display:flex;align-items:center;justify-content:space-between;gap:8px')}><span style={s('font-size:13.5px;font-weight:700')}>{r.company}</span><Badge vm={r.statusBadge} /></div>
              <div style={s(`font-size:11.5px;color:var(--muted);margin-top:5px;${mono}`)}>App #{r.appId} · {r.contact} · {r.status}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
