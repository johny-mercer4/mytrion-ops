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
  const prepay = /prepa/i.test(c.paymentTerms ?? '');
  const flags = (c.isLocSuspended || c.isDebtor) && (
    <div style={s('display:flex;gap:8px')}>
      {c.isLocSuspended && <span style={s(badge('LOC Suspended', 'var(--danger)').style)}>LOC Suspended</span>}
      {c.isDebtor && <span style={s(badge('Debtor', 'var(--warn)').style)}>Debtor</span>}
    </div>
  );

  // Prepay = pay-per-load, no credit line — the credit tiles are all N/A, so don't show them.
  if (prepay) {
    return (
      <div style={s('display:flex;flex-direction:column;gap:14px')}>
        <div style={s('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
          <span style={s(`${badge('Prepay', 'var(--accent)').style};font-size:12px`)}>Prepay</span>
          <span style={s('font-size:12.5px;color:var(--text2)')}>Pay-per-load client — no credit line, limit, or billing cycle.</span>
        </div>
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:10px')}>
          <TermTile label="Active Cards" value={`${c.totalActiveCards}`} />
          <TermTile label="Swiped (30d)" value={`${c.activeCardsLast30Days}`} />
          <TermTile label="First Swipe" value={c.firstSwipeDate ?? '—'} />
        </div>
        {flags}
      </div>
    );
  }

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
      {flags}
      <div style={s('font-size:11.5px;color:var(--muted);line-height:1.5')}>
        Limit-change requests (Credit / Card / Weekly) are coming soon — you'll be able to send them here
        without contacting Verification.
      </div>
    </div>
  );
}

// ---- in-page detail (replaces the list; the page scrolls naturally — no modal, no inner scrollbox) ----
function ClientDetailPage({ client, onBack }: { client: VerificationClient; onBack: () => void }) {
  const cls = CLASS_VIS[client.classification];
  const isActive = client.classification === 'active';
  return (
    <div className="ss-fu" style={s('max-width:1180px;margin:0 auto')}>
      <button
        type="button"
        onClick={onBack}
        className="ss-ico-btn"
        style={s('display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 15px 0 11px;margin-bottom:14px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:var(--shadow-sm)')}
      >
        <Icon name="chevronLeft" size={16} strokeWidth={2.4} /> Back to pipeline
      </button>

      <div style={s('display:flex;align-items:center;gap:14px;padding:20px 22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow-sm)')}>
        <div style={s('flex:1;min-width:0')}>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:20px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{client.companyName}</div>
          <div style={s("font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:3px")}>
            {client.dealStage}{client.appFillDate ? ` · applied ${client.appFillDate}` : ''}{client.carrierId ? ` · #${client.carrierId}` : ''}
          </div>
        </div>
        <span style={s(`${badge(cls.label, cls.color).style};font-size:11px;flex-shrink:0`)}>{cls.label}</span>
      </div>

      <div style={s('margin-top:14px;padding:22px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow-sm)')}>
        <div style={s(isActive ? '' : 'max-width:760px')}>
          {isActive ? <TermsPanel client={client} /> : <PipelineTimeline client={client} />}
        </div>
      </div>
    </div>
  );
}

// ---- compact term chip for active cards (terms visible at a glance) ----
function MiniTerm({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const accent = tone ?? 'var(--text)';
  const bg = tone ? `color-mix(in srgb,${tone} 9%,var(--surface))` : 'var(--alt)';
  const bd = tone ? `color-mix(in srgb,${tone} 28%,var(--border2))` : 'var(--border2)';
  return (
    <div style={s(`flex:1;min-width:0;padding:8px 10px;border-radius:10px;background:${bg};border:1px solid ${bd}`)}>
      <div style={s('font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)')}>{label}</div>
      <div style={s(`font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;margin-top:3px;color:${accent};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{value}</div>
    </div>
  );
}

export function VerificationTab() {
  const actAs = getImpersonation()?.zohoUserId ?? 'self';
  const load = useCachedLoad<VerificationClient[]>(`sales:verification:${actAs}`, () =>
    getVerificationClients(getImpersonation()?.zohoUserId),
  );
  const [view, setView] = useState<'pipeline' | 'active'>('pipeline');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<VerificationClient | null>(null);

  const clients = load.data ?? [];
  const pipelineCount = useMemo(() => clients.filter((c) => c.classification !== 'active').length, [clients]);
  const activeCount = clients.length - pipelineCount;

  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    const inView = clients.filter((c) => (view === 'active' ? c.classification === 'active' : c.classification !== 'active'));
    const searched = q ? inView.filter((c) => `${c.companyName} ${c.dealStage} ${c.carrierId}`.toLowerCase().includes(q)) : inView;
    return [...searched].sort((a, b) => {
      const av = a.appFillDate ?? '';
      const bv = b.appFillDate ?? '';
      if (av === bv) return 0;
      if (!av) return 1; // undated last, regardless of direction
      if (!bv) return -1;
      return sort === 'newest' ? (av < bv ? 1 : -1) : av < bv ? -1 : 1;
    });
  }, [clients, view, q, sort]);

  if (selected) {
    return <ClientDetailPage client={selected} onBack={() => setSelected(null)} />;
  }

  const emptyMsg = q
    ? 'No clients match your search.'
    : view === 'active'
      ? 'No active card-swiping clients yet.'
      : 'No clients in your pipeline yet.';

  const tabs: Array<{ v: 'pipeline' | 'active'; label: string; count: number; hue: string }> = [
    { v: 'pipeline', label: 'Pipeline', count: pipelineCount, hue: 'var(--accent)' },
    { v: 'active', label: 'Active', count: activeCount, hue: 'var(--ok)' },
  ];

  return (
    <div className="ss-fu" style={s('max-width:1180px;margin:0 auto')}>
      <div style={s('margin-bottom:16px')}>
        <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.01em')}>Verification Pipeline</div>
        <div style={s('font-size:13px;color:var(--muted);margin-top:3px')}>
          Your clients by application date — track pipeline clients through compliance to decision, and review active clients' terms.
        </div>
      </div>

      {/* Pipeline / Active sub-tabs */}
      <div style={s('display:inline-flex;gap:4px;padding:4px;margin-bottom:14px;border-radius:99px;background:var(--alt);border:1px solid var(--border2)')}>
        {tabs.map((t) => {
          const on = view === t.v;
          return (
            <button key={t.v} type="button" onClick={() => setView(t.v)} style={s(`height:34px;padding:0 16px;border:none;border-radius:99px;cursor:pointer;font-size:12.5px;font-weight:700;display:flex;align-items:center;gap:7px;transition:background .15s,color .15s;${on ? 'background:var(--surface);color:var(--text);box-shadow:var(--shadow-sm)' : 'background:transparent;color:var(--muted)'}`)}>
              {t.label}
              <span style={s(`font-size:10.5px;font-weight:800;padding:1px 7px;border-radius:99px;${on ? `background:color-mix(in srgb,${t.hue} 16%,transparent);color:${t.hue}` : 'background:var(--border2);color:var(--muted)'}`)}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {/* toolbar: search · applied-date sort · refresh */}
      <div style={s('display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap')}>
        <div style={s('position:relative;flex:1;min-width:240px')}>
          <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
          <input value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search clients by name, carrier ID or stage…" className="ss-in" style={s('width:100%;height:44px;padding:0 16px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px;box-shadow:var(--shadow-sm)')} />
        </div>
        <button type="button" onClick={() => setSort((p) => (p === 'newest' ? 'oldest' : 'newest'))} title="Sort by application date" className="ss-ico-btn" style={s('height:44px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;box-shadow:var(--shadow-sm)')}>
          <Icon name="arrows" size={15} /> Applied: {sort === 'newest' ? 'Newest' : 'Oldest'}
        </button>
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
      ) : list.length === 0 ? (
        <div style={s('padding:48px;text-align:center;color:var(--muted);font-size:13px')}>{emptyMsg}</div>
      ) : (
        <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:14px')}>
          {list.map((c) => {
            const cls = CLASS_VIS[c.classification];
            const isActive = c.classification === 'active';
            const isPrepay = isActive && /prepa/i.test(c.paymentTerms ?? '');
            return (
              <div key={c.carrierId} onClick={() => setSelected(c)} className="ss-card-h" style={s(`padding:18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)${isActive ? ';border-left:3px solid var(--ok)' : ''}`)}>
                <div style={s('display:flex;align-items:start;justify-content:space-between;gap:10px')}>
                  <div style={s('font-size:14px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.companyName}</div>
                  <span style={s(`${badge(cls.label, cls.color).style};flex-shrink:0`)}>{cls.label}</span>
                </div>
                <div style={s("font-size:11.5px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:6px")}>{c.dealStage}</div>
                {isActive &&
                  (isPrepay ? (
                    <div style={s('margin-top:12px')}>
                      <span style={s(`${badge('Prepay', 'var(--accent)').style};font-size:11.5px`)}>Prepay</span>
                    </div>
                  ) : (
                    <div style={s('display:flex;gap:7px;margin-top:12px')}>
                      <MiniTerm label="Limit" value={money(c.creditLimit)} tone="var(--ok)" />
                      <MiniTerm label="Cycle" value={c.billingCycle ?? '—'} />
                      <MiniTerm label="Terms" value={c.paymentTerms ?? '—'} />
                    </div>
                  ))}
                <div style={s('display:flex;align-items:center;justify-content:space-between;margin-top:12px;font-size:11.5px;color:var(--text2)')}>
                  <span>{c.appFillDate ? `Applied ${c.appFillDate}` : '—'}</span>
                  {isActive && c.lastTransactionDate ? <span style={s('color:var(--muted)')}>Last swipe {c.lastTransactionDate}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
