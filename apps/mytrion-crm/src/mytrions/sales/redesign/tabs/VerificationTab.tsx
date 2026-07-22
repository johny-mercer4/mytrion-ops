/**
 * Sales "Verification Pipeline" tab — the agent's deal-clients (freshest application date first),
 * each opening to EITHER the 9-stage compliance pipeline + decision (new/in-pipeline clients) OR a
 * read-only current-terms panel (active card-swiping clients). Pipeline data is served by the
 * backend provider (mock this phase); this tab never talks to the verification DB directly.
 */
import { useMemo, useState } from 'react';
import { s } from '../dc';
import { Icon, type IconName } from '../icons';
import { badge } from '../salesData';
import { useLoad } from '../live';
import { useCachedLoad } from '../dcCache';
import { getImpersonation } from '@/api/impersonation';
import {
  getVerificationClients,
  getPipeline,
  type VerificationClient,
  type PipelineStageStatus,
  type PipelineDecision,
} from '@/api/verification';

// ---- status → visual ----
const STAGE_VIS: Record<PipelineStageStatus, { color: string; icon: IconName; label: string }> = {
  done: { color: 'var(--ok)', icon: 'check', label: 'Passed' },
  failed: { color: 'var(--danger)', icon: 'close', label: 'Failed' },
  pending: { color: 'var(--warn)', icon: 'clock', label: 'In progress' },
  skipped: { color: 'var(--muted)', icon: 'ban', label: 'Skipped' },
  not_started: { color: 'var(--border2)', icon: 'clock', label: 'Not started' },
};

const CLASS_VIS: Record<VerificationClient['classification'], { label: string; color: string }> = {
  in_pipeline: { label: 'In Pipeline', color: 'var(--accent)' },
  active: { label: 'Active', color: 'var(--ok)' },
  closed: { label: 'Closed', color: 'var(--muted)' },
};

function decisionBadge(d: PipelineDecision): { text: string; color: string } {
  switch (d.outcome) {
    case 'loc':
      return { text: 'LOC Approved', color: 'var(--ok)' };
    case 'prepaid':
      return { text: 'Prepaid', color: 'var(--accent)' };
    case 'rejected':
      return { text: 'Not Accepted', color: 'var(--danger)' };
    default:
      return { text: 'Undecided', color: 'var(--warn)' };
  }
}

const money = (n: number | null | undefined): string =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// ---- 9-stage vertical timeline + decision ----
function PipelineTimeline({ client }: { client: VerificationClient }) {
  const pipe = useLoad(
    () => getPipeline({ dealId: client.dealId, carrierId: client.carrierId, applicationId: client.applicationId, dot: client.dot }),
    [client.dealId, client.carrierId],
  );

  if (pipe.loading && !pipe.data) {
    return <div style={s('padding:28px;text-align:center;color:var(--muted);font-size:13px')}>Loading pipeline…</div>;
  }
  if (pipe.error) {
    return <div style={s('padding:28px;text-align:center;color:var(--danger);font-size:13px')}>{pipe.error}</div>;
  }
  if (!pipe.data) {
    return <div style={s('padding:28px;text-align:center;color:var(--muted);font-size:13px')}>No verification record for this client yet.</div>;
  }

  const { stages, decision } = pipe.data;
  const dec = decisionBadge(decision);

  return (
    <div style={s('display:flex;flex-direction:column;gap:2px')}>
      {stages.map((st, i) => {
        const vis = STAGE_VIS[st.status];
        const last = i === stages.length - 1;
        return (
          <div key={st.id} style={s('display:flex;gap:12px')}>
            {/* rail: dot + connector */}
            <div style={s('display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0')}>
              <span style={s(`width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${vis.color} 16%,transparent);color:${vis.color};flex-shrink:0`)}>
                <Icon name={vis.icon} size={12} strokeWidth={2.6} />
              </span>
              {!last && <span style={s('flex:1;width:2px;min-height:14px;background:var(--border2)')} />}
            </div>
            {/* body */}
            <div style={s('flex:1;min-width:0;padding-bottom:14px')}>
              <div style={s('display:flex;align-items:center;gap:8px')}>
                <span style={s('font-size:11px;color:var(--muted);font-family:JetBrains Mono,monospace')}>{st.order}</span>
                <span style={s('font-size:13px;font-weight:700')}>{st.label}</span>
                <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
              </div>
              {st.detail && <div style={s('font-size:11.5px;color:var(--text2);margin-top:3px')}>{st.detail}</div>}
            </div>
          </div>
        );
      })}

      {/* decision */}
      <div style={s('margin-top:8px;padding:14px 16px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
          <span style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>Decision</span>
          <span style={s(`${badge(dec.text, dec.color).style};font-size:12px`)}>{dec.text}</span>
        </div>
        {decision.outcome === 'loc' && (
          <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px')}>
            <TermTile label="Credit Score" value={String(decision.creditScore ?? '—')} />
            <TermTile label="Approved Limit" value={money(decision.approvedLimit)} />
            <TermTile label="Billing Cycle" value={decision.billingCycle ?? '—'} />
          </div>
        )}
        {decision.reason && decision.outcome !== 'loc' && (
          <div style={s('font-size:12px;color:var(--text2);margin-top:8px')}>{decision.reason}</div>
        )}
      </div>
    </div>
  );
}

function TermTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={s('padding:12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border2)')}>
      <div style={s('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>{label}</div>
      <div style={s("font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:600;margin-top:5px")}>{value}</div>
    </div>
  );
}

// ---- active-client current terms (read-only this phase) ----
function TermsPanel({ client: c }: { client: VerificationClient }) {
  return (
    <div style={s('display:flex;flex-direction:column;gap:14px')}>
      <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:10px')}>
        <TermTile label="Credit Limit" value={money(c.creditLimit)} />
        <TermTile label="Credit Score" value={c.creditScore != null ? String(c.creditScore) : '—'} />
        <TermTile label="Billing Cycle" value={c.billingCycle ?? '—'} />
        <TermTile label="Payment Terms" value={c.paymentTerms ?? '—'} />
        <TermTile label="Payment Day" value={c.paymentDay ?? '—'} />
        <TermTile label="Min. Balance" value={money(c.minimumRequiredBalance)} />
        <TermTile label="Active Cards" value={`${c.totalActiveCards}`} />
        <TermTile label="Swiped (30d)" value={`${c.activeCardsLast30Days}`} />
        <TermTile label="First Swipe" value={c.firstSwipeDate ?? '—'} />
      </div>
      {(c.isLocSuspended || c.isDebtor) && (
        <div style={s('display:flex;gap:8px')}>
          {c.isLocSuspended && <span style={s(badge('LOC Suspended', 'var(--danger)').style)}>LOC Suspended</span>}
          {c.isDebtor && <span style={s(badge('Debtor', 'var(--warn)').style)}>Debtor</span>}
        </div>
      )}
      <div style={s('font-size:11.5px;color:var(--muted);line-height:1.5')}>
        Limit-change requests (Credit / Card / Weekly) are coming soon — you'll be able to send them here
        without contacting Verification.
      </div>
    </div>
  );
}

// ---- detail modal ----
function ClientDetail({ client, onClose }: { client: VerificationClient; onClose: () => void }) {
  const cls = CLASS_VIS[client.classification];
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:120;background:rgba(3,7,14,.6);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s('width:100%;max-width:560px;max-height:88vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}>
        <div style={s('flex-shrink:0;padding:20px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px')}>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{client.companyName}</div>
            <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px")}>
              {client.dealStage}{client.appFillDate ? ` · applied ${client.appFillDate}` : ''}
            </div>
          </div>
          <span style={s(`${badge(cls.label, cls.color).style};font-size:11px`)}>{cls.label}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:20px 22px')}>
          {client.classification === 'active' ? <TermsPanel client={client} /> : <PipelineTimeline client={client} />}
        </div>
      </div>
    </div>
  );
}

export function VerificationTab() {
  const actAs = getImpersonation()?.zohoUserId ?? 'self';
  const load = useCachedLoad<VerificationClient[]>(`sales:verification:${actAs}`, () =>
    getVerificationClients(getImpersonation()?.zohoUserId),
  );
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<VerificationClient | null>(null);

  const clients = load.data ?? [];
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? clients.filter((c) => `${c.companyName} ${c.dealStage} ${c.carrierId}`.toLowerCase().includes(q)) : clients),
    [clients, q],
  );

  return (
    <div className="ss-fu" style={s('max-width:1180px;margin:0 auto')}>
      <div style={s('margin-bottom:16px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.01em')}>Verification Pipeline</div>
        <div style={s('font-size:13px;color:var(--muted);margin-top:3px')}>
          Your clients by application date — track each one through compliance to decision, and see active clients' terms.
        </div>
      </div>

      {/* toolbar */}
      <div style={s('display:flex;gap:12px;margin-bottom:16px;align-items:center')}>
        <div style={s('position:relative;flex:1;min-width:240px')}>
          <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
          <input value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search clients by name, carrier ID or stage…" className="ss-in" style={s('width:100%;height:44px;padding:0 16px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')} />
        </div>
        <button type="button" onClick={() => load.reload()} disabled={load.revalidating} title="Refresh" className="ss-ico-btn" style={s(`height:44px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:12px;font-weight:700;cursor:${load.revalidating ? 'default' : 'pointer'};display:flex;align-items:center;gap:8px;box-shadow:var(--shadow-sm);opacity:${load.revalidating ? '.7' : '1'}`)}>
          <span style={s(`display:inline-flex${load.revalidating ? ';animation:ss-spin .8s linear infinite' : ''}`)}><Icon name="refresh" size={15} /></span>
          Refresh
        </button>
      </div>

      {/* content */}
      {load.loading && !load.data ? (
        <div style={s('padding:48px;text-align:center;color:var(--muted);font-size:13px')}>Loading clients…</div>
      ) : load.error && !load.data ? (
        <div style={s('padding:36px;text-align:center;color:var(--danger);font-size:13px')}>{load.error}</div>
      ) : filtered.length === 0 ? (
        <div style={s('padding:48px;text-align:center;color:var(--muted);font-size:13px')}>{q ? 'No clients match your search.' : 'No clients in your pipeline yet.'}</div>
      ) : (
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
          {filtered.map((c) => {
            const cls = CLASS_VIS[c.classification];
            return (
              <div key={c.carrierId} onClick={() => setSelected(c)} className="ss-card-h" style={s('padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
                <div style={s('display:flex;align-items:start;justify-content:space-between;gap:10px')}>
                  <div style={s('font-size:14px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.companyName}</div>
                  <span style={s(`${badge(cls.label, cls.color).style};flex-shrink:0`)}>{cls.label}</span>
                </div>
                <div style={s("font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:6px")}>{c.dealStage}</div>
                <div style={s('display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:11.5px;color:var(--text2)')}>
                  <span>{c.appFillDate ? `Applied ${c.appFillDate}` : '—'}</span>
                  {c.classification === 'active' && c.creditLimit != null && <span>{money(c.creditLimit)} · {c.billingCycle ?? '—'}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && <ClientDetail client={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
