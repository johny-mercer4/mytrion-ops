/**
 * Sales "Verification Pipeline" tab — the agent's deal-clients (freshest application date first),
 * each opening to EITHER the 9-stage compliance pipeline + decision (new/in-pipeline clients) OR a
 * read-only current-terms panel (active card-swiping clients). Pipeline data is served by the
 * backend provider; this tab never talks to the verification database directly.
 */
import { useEffect, useState } from 'react';
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
  type VerificationClientPage,
  type PipelineStageStatus,
  type PipelineDecision,
} from '@/api/verification';
import { VerificationActionRequest } from '../VerificationActionRequest';
import { DcCardGridSkeleton, VerificationDetailSkeleton } from '../DataCenterSkeletons';

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

const PAGE_SIZE = 9;
const PENDING_STAGES = [
  'Pre Stop Factors',
  'FMCSA',
  'Plaid / Bank Statement',
  'Highway',
  'iSoft Pull — Credit Score',
  'Black List Match',
  'AntiFraud',
  'CrossCheck',
  'Post Stop Factors',
] as const;

/** Preserve the original nine-stage workspace without pretending a live request already exists. */
function PendingPipeline() {
  const vis = STAGE_VIS.not_started;
  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
        <div>
          <div style={s('font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800')}>Verification pipeline</div>
          <div style={s('font-size:13px;color:var(--text2);margin-top:4px')}>The application is visible to Sales; Verification has not created its live request yet.</div>
        </div>
        <span style={s(`${badge('Awaiting intake', 'var(--warn)').style};font-size:12px;flex-shrink:0`)}>Awaiting intake</span>
      </div>
      <div style={s('display:flex;flex-direction:column;gap:2px')}>
        {PENDING_STAGES.map((label, index) => {
          const last = index === PENDING_STAGES.length - 1;
          return (
            <div key={label} style={s('display:flex;gap:12px')}>
              <div style={s('display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0')}>
                <span style={s(`width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${vis.color} 16%,transparent);color:${vis.color};flex-shrink:0`)}>
                  <Icon name={vis.icon} size={12} strokeWidth={2.6} />
                </span>
                {!last && <span style={s('flex:1;width:2px;min-height:14px;background:var(--border2)')} />}
              </div>
              <div style={s('flex:1;min-width:0;padding-bottom:14px')}>
                <div style={s('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
                  <span style={s('font-size:12px;color:var(--muted);font-family:JetBrains Mono,monospace')}>{index + 1}</span>
                  <span style={s('font-size:14px;font-weight:700')}>{label}</span>
                  <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- 9-stage vertical timeline + decision ----
function PipelineTimeline({ client, showStages = true }: { client: VerificationClient; showStages?: boolean }) {
  const pipe = useLoad(
    () => getPipeline({ dealId: client.dealId, carrierId: client.carrierId, applicationId: client.applicationId, dot: client.dot }),
    [client.dealId, client.carrierId],
  );

  if (pipe.loading && !pipe.data) {
    return <VerificationDetailSkeleton />;
  }
  if (pipe.error) {
    return <div className="ss-verification-state" style={s('color:var(--danger)')}>{pipe.error}</div>;
  }
  if (!pipe.data) {
    return <PendingPipeline />;
  }

  const { stages, decision, requirements, attachments, events } = pipe.data;
  const dec = decisionBadge(decision);

  return (
    <div style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800')}>Live verification</div>
          <div style={s("font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--text2);margin-top:4px")}>Request {pipe.data.requestId}</div>
        </div>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          {requirements.filter((item) => !item.response).length ? (
            <span style={s(`${badge(`${requirements.filter((item) => !item.response).length} action required`, 'var(--danger)').style};font-size:12px`)}>
              <Icon name="warn" size={12} /> {requirements.filter((item) => !item.response).length} action required
            </span>
          ) : null}
          <span style={s(`${badge(pipe.data.status, 'var(--accent)').style};font-size:12px`)}>{pipe.data.status}</span>
        </div>
      </div>

      {requirements.length ? (
        <div style={s('display:flex;flex-direction:column;gap:12px')}>
          {requirements.map((requirement) => (
            <VerificationActionRequest
              key={requirement.id}
              requestId={pipe.data!.requestId}
              dealId={client.dealId}
              requirement={requirement}
              onSent={pipe.reload}
            />
          ))}
        </div>
      ) : null}

      {showStages ? <div style={s('display:flex;flex-direction:column;gap:2px')}>{stages.map((st, i) => {
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
                <span style={s('font-size:12px;color:var(--muted);font-family:JetBrains Mono,monospace')}>{st.order}</span>
                <span style={s('font-size:14px;font-weight:700')}>{st.label}</span>
                <span style={s(badge(vis.label, vis.color).style)}>{vis.label}</span>
              </div>
              {st.detail && <div style={s('font-size:12px;color:var(--text2);margin-top:3px')}>{st.detail}</div>}
            </div>
          </div>
        );
      })}</div> : null}

      {/* decision */}
      {showStages ? <div style={s('padding:14px 16px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
        <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px')}>
          <span style={s('font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>Decision</span>
          <span style={s(`${badge(dec.text, dec.color).style};font-size:13px`)}>{dec.text}</span>
        </div>
        {decision.outcome === 'loc' && (
          <div style={s('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px')}>
            <TermTile label="Credit Score" value={String(decision.creditScore ?? '—')} />
            <TermTile label="Approved Limit" value={money(decision.approvedLimit)} />
            <TermTile label="Billing Cycle" value={decision.billingCycle ?? '—'} />
          </div>
        )}
        {decision.reason && decision.outcome !== 'loc' && (
          <div style={s('font-size:13px;color:var(--text2);margin-top:8px')}>{decision.reason}</div>
        )}
      </div> : null}

      {attachments.length || events.length ? (
        <div style={s('display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px')}>
          <div style={s('padding:14px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
            <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Files received</div>
            <div style={s('display:flex;flex-direction:column;gap:8px;margin-top:10px')}>
              {attachments.length ? attachments.slice(0, 6).map((file) => (
                <div key={file.id} style={s('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2)')}>
                  <Icon name="file" size={14} />
                  <span style={s('min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{file.fileName}</span>
                  <span style={s('margin-left:auto;color:var(--muted);white-space:nowrap')}>{Math.max(1, Math.round(file.byteSize / 1024))} KB</span>
                </div>
              )) : <span style={s('font-size:12px;color:var(--muted)')}>No files received.</span>}
            </div>
          </div>
          <div style={s('padding:14px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
            <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Recent activity</div>
            <div style={s('display:flex;flex-direction:column;gap:8px;margin-top:10px')}>
              {events.slice(0, 5).map((event) => (
                <div key={event.id} style={s('display:flex;gap:8px;font-size:12px;color:var(--text2)')}>
                  <span style={s('width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:5px;flex:0 0 auto')} />
                  <span>{event.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TermTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={s('padding:12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border2)')}>
      <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>{label}</div>
      <div style={s("font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;margin-top:5px")}>{value}</div>
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
          <span style={s(`${badge('Prepay', 'var(--accent)').style};font-size:13px`)}>Prepay</span>
          <span style={s('font-size:13px;color:var(--text2)')}>Pay-per-load client — no credit line, limit, or billing cycle.</span>
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
      <div style={s('font-size:12px;color:var(--muted);line-height:1.5')}>
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
    <div className="ss-fu ss-verification-page">
      <button
        type="button"
        onClick={onBack}
        className="ss-ico-btn"
        style={s('display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 15px 0 11px;margin-bottom:14px;border-radius:99px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:13px;font-weight:700;cursor:pointer;box-shadow:var(--shadow-sm)')}
      >
        <Icon name="chevronLeft" size={16} strokeWidth={2.4} /> Back to pipeline
      </button>

      <div className="ss-verification-detail-header">
        <div style={s('flex:1;min-width:0')}>
          <div className="ss-verification-title" style={s('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{client.companyName}</div>
          <div className="ss-verification-meta">
            {client.dealStage}{client.appFillDate ? ` · applied ${client.appFillDate}` : ''}{client.carrierId ? ` · #${client.carrierId}` : ''}
          </div>
        </div>
        <span style={s(`${badge(cls.label, cls.color).style};font-size:12px;flex-shrink:0`)}>{cls.label}</span>
      </div>

      <div className="ss-verification-detail-body">
        <div className={isActive ? undefined : 'ss-verification-detail-content'}>
          {isActive ? (
            <div style={s('display:flex;flex-direction:column;gap:18px')}>
              <TermsPanel client={client} />
              <PipelineTimeline client={client} showStages={false} />
            </div>
          ) : <PipelineTimeline client={client} />}
        </div>
      </div>
    </div>
  );
}

export function VerificationTab() {
  const viewAsUserId = getImpersonation()?.zohoUserId;
  const actAs = viewAsUserId ?? 'self';
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<VerificationClient | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const load = useCachedLoad<VerificationClientPage>(
    `sales:verification:${actAs}:${page}:${encodeURIComponent(debouncedQuery)}`,
    () => getVerificationClients({
      ...(viewAsUserId ? { zohoUserId: viewAsUserId } : {}),
      page,
      pageSize: PAGE_SIZE,
      query: debouncedQuery,
    }),
  );
  const clients = load.data?.clients ?? [];
  const total = load.data?.pagination.total ?? 0;
  const pageCount = load.data?.pagination.pageCount ?? 1;
  const pageStart = (page - 1) * PAGE_SIZE;

  if (selected) {
    return <ClientDetailPage client={selected} onBack={() => setSelected(null)} />;
  }

  const emptyMsg = debouncedQuery ? 'No clients match your search.' : 'No verification applications yet.';

  return (
    <div className="ss-fu ss-verification-page">
      <div className="ss-verification-header">
        <div>
          <div className="ss-verification-title">Verification Pipeline</div>
          <div className="ss-verification-copy">
            Newest applications first. Review live compliance stages and answer Verification requests.
          </div>
        </div>
      </div>

      <div className="ss-verification-toolbar">
        <div className="ss-verification-search">
          <Icon name="search" size={16} style={s('position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
          <input value={query} onChange={(e) => { setQuery(e.currentTarget.value); setPage(1); }} placeholder="Search by company, carrier ID or stage…" className="ss-in" style={s('width:100%;height:44px;padding:0 16px 0 44px;border-radius:var(--radius-md);border:1px solid var(--border);color:var(--text);font-size:var(--ss-text-sm)')} />
        </div>
      </div>

      {/* content */}
      {load.loading && !load.data ? (
        <DcCardGridSkeleton label="verification applications" count={9} />
      ) : load.error && !load.data ? (
        <div className="ss-verification-state" style={s('color:var(--danger)')}>{load.error}</div>
      ) : clients.length === 0 ? (
        <div className="ss-verification-state">{emptyMsg}</div>
      ) : (
        <>
        <div className="ss-verification-grid" data-testid="verification-grid">
          {clients.map((c, index) => {
            const cls = CLASS_VIS[c.classification];
            return (
              <button key={c.dealId ?? c.carrierId ?? `application-${index}`} type="button" onClick={() => setSelected(c)} data-testid="verification-card" className="ss-verification-card" style={s(`--verification-tone:${c.attentionCount ? 'var(--danger)' : cls.color};border-color:${c.attentionCount ? 'color-mix(in srgb,var(--danger) 48%,var(--border))' : 'var(--border)'}`)}>
                <div style={s('display:flex;align-items:start;justify-content:space-between;gap:10px')}>
                  <div className="ss-verification-card-title">{c.companyName}</div>
                  <span style={s(`${badge(cls.label, cls.color).style};flex-shrink:0`)}>{cls.label}</span>
                </div>
                <div className="ss-verification-meta">{c.dealStage}</div>
                {c.attentionCount ? (
                  <div style={s('display:flex;align-items:center;gap:7px;margin-top:11px;padding:9px 10px;border-radius:9px;background:color-mix(in srgb,var(--danger) 9%,transparent);color:var(--danger);font-size:12px;font-weight:800')}>
                    <Icon name="warn" size={14} /> {c.attentionCount} Verification action{c.attentionCount === 1 ? '' : 's'} required
                  </div>
                ) : c.verificationStatus ? (
                  <div style={s('margin-top:10px;font-size:11px;color:var(--muted)')}>Verification · {c.verificationStatus}</div>
                ) : null}
                <div style={s('display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:14px;font-size:12px;color:var(--text2)')}>
                  <span>{c.appFillDate ? `Applied ${c.appFillDate}` : '—'}</span>
                </div>
              </button>
            );
          })}
        </div>
        {total > 0 ? (
          <div className="ss-verification-pagination">
            <span style={s('font-size:var(--ss-text-xs);color:var(--muted)')}>
              Showing {pageStart + 1}–{Math.min(pageStart + clients.length, total)} of {total} pipeline applications
            </span>
            <div className="ss-verification-page-controls">
              <button type="button" aria-label="Previous verification page" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="ss-ico-btn" style={s(`height:36px;padding:0 13px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font:inherit;font-size:var(--ss-text-xs);font-weight:700;cursor:${page === 1 ? 'default' : 'pointer'};opacity:${page === 1 ? '.45' : '1'}`)}>Previous</button>
              <span style={s("font-family:'JetBrains Mono',monospace;font-size:var(--ss-text-2xs);color:var(--text2)")}>Page {page} of {pageCount}</span>
              <button type="button" aria-label="Next verification page" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount} className="ss-ico-btn" style={s(`height:36px;padding:0 13px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font:inherit;font-size:var(--ss-text-xs);font-weight:700;cursor:${page >= pageCount ? 'default' : 'pointer'};opacity:${page >= pageCount ? '.45' : '1'}`)}>Next</button>
            </div>
          </div>
        ) : null}
        </>
      )}
    </div>
  );
}
