/**
 * WEX application search panel — the Automations modal's "search" action, extracted from
 * AutoTab (which sits at the file-size cap). Self-contained: owns the query/result state and
 * resets it by remounting (the modal renders it only while a search automation is open).
 *
 * Race guard: rapid searches keep a monotonic request id (seqRef) and only the LATEST
 * request may commit results — the same staleness rule live.ts's useLoad applies.
 *
 * Field set matches zoho-octane C-29: appId, firstName, lastName, company, email, phone, mc, dot.
 */
import { useRef, useState } from 'react';
import { callTouchpoint, logAutomation } from '@/api/touchpoints';
import { s, Badge } from './dc';
import { badge } from './salesData';
import { mapWex, mapWexSearchRow, type WexResult } from './autoLive';
import { AutoEmptyState } from './AutoActionResult';

interface WexQ {
  appId: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  mc: string;
  dot: string;
}

const WEX0: WexQ = {
  appId: '', firstName: '', lastName: '', company: '', email: '', phone: '', mc: '', dot: '',
};

const inp40 = 'width:100%;height:40px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px';
const labelCss = 'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em';
const dropErr = 'padding:14px;font-size:12.5px;color:var(--danger);text-align:center';
const mono = "font-family:'JetBrains Mono',monospace";
const grad = 'linear-gradient(120deg,var(--accent),var(--accent-2))';
const btnP = (extra: string): string => `border:none;background:${grad};color:#fff;font-weight:700;cursor:pointer;${extra}`;
const skel8 = [1, 2, 3, 4, 5, 6, 7, 8];

function Lbl({ t }: { t: string }) { return <div style={s(labelCss)}>{t}</div>; }

function anyField(q: WexQ): boolean {
  return Object.values(q).some((v) => v.trim().length > 0);
}

export function AutoWexPanel() {
  const [wexQ, setWexQ] = useState<WexQ>(WEX0);
  const [wexSearching, setWexSearching] = useState(false);
  const [wexResults, setWexResults] = useState<readonly WexResult[] | null>(null);
  const [wexErr, setWexErr] = useState<string | null>(null);
  const seqRef = useRef(0);

  const setWexField = (k: keyof WexQ, v: string): void => setWexQ((q) => ({ ...q, [k]: v }));

  const runWex = (): void => {
    const q = {
      appId: wexQ.appId.trim(),
      firstName: wexQ.firstName.trim(),
      lastName: wexQ.lastName.trim(),
      company: wexQ.company.trim(),
      email: wexQ.email.trim(),
      phone: wexQ.phone.trim(),
      mc: wexQ.mc.trim(),
      dot: wexQ.dot.trim(),
    };
    setWexResults(null); setWexErr(null);
    if (!anyField(q)) {
      setWexErr('Enter at least one search field.');
      return;
    }
    setWexSearching(true);
    const seq = ++seqRef.current;
    const onlyAppId = q.appId && !q.firstName && !q.lastName && !q.company && !q.email && !q.phone && !q.mc && !q.dot;
    const search = onlyAppId
      ? callTouchpoint('wex.application', { appId: q.appId }).then((res) => {
          if (!res || res.found === false) return [] as WexResult[];
          return [mapWex(res, q.appId)];
        })
      : callTouchpoint('wex.applications_search', {
          ...(q.appId ? { appId: q.appId } : {}),
          ...(q.firstName ? { firstName: q.firstName } : {}),
          ...(q.lastName ? { lastName: q.lastName } : {}),
          ...(q.company ? { company: q.company } : {}),
          ...(q.email ? { email: q.email } : {}),
          ...(q.phone ? { phone: q.phone } : {}),
          ...(q.mc ? { mc: q.mc } : {}),
          ...(q.dot ? { dot: q.dot } : {}),
        }).then((res) => {
          const rows = (res.data ?? res.applications ?? []) as Array<Record<string, unknown>>;
          return rows.map((r, i) => mapWexSearchRow(r, i));
        });
    search
      .then((rows) => {
        if (seq !== seqRef.current) return;
        setWexResults(rows);
        logAutomation('wex-apps-application');
      })
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
      <div style={s('font-size:12.5px;color:var(--text2);margin-bottom:12px')}>
        Search WEX applications by any combination of applicant fields.
      </div>
      <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
        <div><Lbl t="Application ID" /><input value={wexQ.appId} onChange={(e) => setWexField('appId', e.target.value)} placeholder="e.g. 872228" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="First Name" /><input value={wexQ.firstName} onChange={(e) => setWexField('firstName', e.target.value)} placeholder="e.g. Richard" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="Last Name" /><input value={wexQ.lastName} onChange={(e) => setWexField('lastName', e.target.value)} placeholder="e.g. Crossan" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="Company" /><input value={wexQ.company} onChange={(e) => setWexField('company', e.target.value)} placeholder="e.g. RICS Logistics" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="Email" /><input type="email" value={wexQ.email} onChange={(e) => setWexField('email', e.target.value)} placeholder="e.g. name@company.com" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="Phone" /><input value={wexQ.phone} onChange={(e) => setWexField('phone', e.target.value)} placeholder="e.g. 610-645-2231" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="MC Number" /><input value={wexQ.mc} onChange={(e) => setWexField('mc', e.target.value)} placeholder="e.g. 285921" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div><Lbl t="DOT Number" /><input value={wexQ.dot} onChange={(e) => setWexField('dot', e.target.value)} placeholder="e.g. 602070" className="ss-in" style={s(inp40)} onKeyDown={(e) => { if (e.key === 'Enter') runWex(); }} /></div>
        <div style={s('grid-column:1 / -1;display:flex;justify-content:flex-end')}>
          <button onClick={runWex} disabled={wexSearching} className="ss-btn-p" style={s(btnP('height:40px;padding:0 22px;border-radius:var(--radius-md);font-size:13px'))}>
            Search
          </button>
        </div>
      </div>
      {wexSearching && <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:9px')}>{skel8.map((sk) => <div key={sk} style={s('display:flex;gap:10px;padding:13px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}><div className="ss-skel" style={s('flex:1;height:14px')}></div><div className="ss-skel" style={s('width:60px;height:14px')}></div></div>)}</div>}
      {wexErr && <div style={s(`margin-top:16px;${dropErr}`)}>{wexErr}</div>}
      {wexShow && wexResultsVM.length === 0 && !wexErr && (
        <div style={s('margin-top:16px')}>
          <AutoEmptyState title="No applications matched" message="Try different applicant fields or an Application ID." icon="search" compact />
        </div>
      )}
      {wexShow && wexResultsVM.length > 0 && (
        <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:9px')}>
          {wexResultsVM.map((r) => (
            <div key={r.appId} className="ss-card-h" style={s('padding:13px 15px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
              <div style={s('display:flex;align-items:center;justify-content:space-between;gap:8px')}><span style={s('font-size:13.5px;font-weight:700')}>{r.company}</span><Badge vm={r.statusBadge} /></div>
              <div style={s(`font-size:11.5px;color:var(--muted);margin-top:5px;${mono}`)}>App #{r.appId} · {r.contact} · {r.status}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
