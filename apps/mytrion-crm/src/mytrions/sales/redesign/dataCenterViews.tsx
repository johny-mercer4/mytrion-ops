/**
 * Data Center views — Leads & Deals (kanban / list) and the Rejection report.
 * Leads list/kanban match the Sales Mytrion Leads redesign (real Zoho CRM fields).
 * Deal kanban uses the fixed 10-stage blueprint. Clicking a card opens the shell modal.
 */
import { useState, type MouseEvent, type ReactNode } from 'react';
import { s } from './dc';
import { badge } from './salesData';
import { useSales } from './ctx';
import { Icon } from './icons';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import {
  dealColumns,
  dealStageColor,
  leadColumns,
  leadSourceColor,
  leadStatusColor,
  utmColor,
  type DealVM,
  type LeadVM,
  type RejectionVM,
} from './dataCenterLive';

const AV = (size = 34, fs = 13): string =>
  `width:${size}px;height:${size}px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:${fs}px;background:var(--raised);color:var(--text2)`;
const COUNT_CHIP =
  "min-width:22px;height:20px;padding:0 7px;border-radius:99px;background:var(--raised);color:var(--muted);font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace";
const SUB = 'font-size:11px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
const FOOT = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;font-size:10.5px;color:var(--faint)';
const LEAD_LIST_COLS =
  'display:grid;grid-template-columns:170px 170px 130px 120px 210px 140px 140px 100px;gap:10px;padding:12px 16px;min-width:fit-content';
const HOVER_ACTION =
  'width:96px;height:26px;border-radius:var(--radius-md);border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0';

function utmPill(source: string) {
  const c = utmColor(source);
  return (
    <span style={s(`display:inline-block;margin-top:8px;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,${c} 16%,transparent);color:${c}`)}>{source}</span>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return <div style={s('padding:44px;text-align:center;color:var(--muted);font-size:13px')}>{msg}</div>;
}

function KanbanCol({ col, count, children }: { col: { label: string; col: string }; count: number; children: ReactNode }) {
  return (
    <div style={s('flex:0 0 264px;width:264px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);display:flex;flex-direction:column;max-height:640px')}>
      <div style={s('display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--border2)')}>
        <span style={s(`width:8px;height:8px;border-radius:50%;background:${col.col}`)} />
        <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:13.5px;letter-spacing:.04em;text-transform:uppercase;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{col.label}</span>
        <span style={s(COUNT_CHIP)}>{count}</span>
      </div>
      <div className="ss-scroll" style={s('padding:11px;display:flex;flex-direction:column;gap:10px;overflow-y:auto')}>{children}</div>
    </div>
  );
}

function sourceBadge(source: string) {
  const label = source || 'No source';
  const c = leadSourceColor(label);
  return badge(label, c);
}

function stop(e: MouseEvent): void {
  e.stopPropagation();
}

// ---------- Leads ----------

export function LeadsView({ leads, search, view }: { leads: LeadVM[]; search: string; view: 'kanban' | 'list' }) {
  const { openLead, pushToast } = useSales();
  const [hoverField, setHoverField] = useState<string | null>(null);
  const q = search.toLowerCase();
  const rows = q
    ? leads.filter((l) =>
        `${l.contact} ${l.company} ${l.source} ${l.status} ${l.phone} ${l.cell} ${l.email}`.toLowerCase().includes(q),
      )
    : leads;

  if (rows.length === 0) {
    return <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)')}><EmptyRow msg="No leads found." /></div>;
  }

  const copyVal = (e: MouseEvent, value: string, label: string): void => {
    stop(e);
    if (!value || value === '—') return;
    void navigator.clipboard?.writeText(value).then(
      () => pushToast('Copied', label),
      () => pushToast('Copy failed', label),
    );
  };

  const dial = (e: MouseEvent, phone: string): void => {
    stop(e);
    if (!phone.trim()) return;
    // Success only — never toast Phone/backend load failures.
    if (clickToDial(phone)) pushToast('Calling', phone);
  };

  if (view === 'list') {
    return (
      <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow-x:auto;background:var(--surface)')}>
        <div style={s(`${LEAD_LIST_COLS};background:var(--alt);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)`)}>
          <span>Name</span><span>Company</span><span>Status</span><span>Source</span><span>Email</span><span>Phone</span><span>Cell</span><span>Created</span>
        </div>
        {rows.map((ld) => {
          const stCol = leadStatusColor(ld.status);
          const emailKey = `${ld.id}:email`;
          const phoneKey = `${ld.id}:phone`;
          const cellKey = `${ld.id}:cell`;
          return (
            <div
              key={ld.id}
              onClick={() => openLead(ld)}
              className="ss-tab-x"
              style={s(`${LEAD_LIST_COLS.replace('padding:12px 16px', 'padding:13px 16px')};border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:12.5px`)}
            >
              <span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.contact}</span>
              <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.company}</span>
              <span style={s('display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
                <span style={s(`width:7px;height:7px;border-radius:50%;background:${stCol};flex-shrink:0`)} />
                <span style={s('overflow:hidden;text-overflow:ellipsis')}>{ld.converted ? 'Converted' : ld.status}</span>
              </span>
              <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.source || 'No source'}</span>
              <div
                onMouseEnter={() => setHoverField(emailKey)}
                onMouseLeave={() => setHoverField((h) => (h === emailKey ? null : h))}
                style={s('height:26px;display:flex;align-items:center;gap:6px;min-width:0')}
              >
                {hoverField === emailKey && ld.email && ld.email !== '—' ? (
                  <button type="button" aria-label="Copy email" onClick={(e) => copyVal(e, ld.email, ld.email)} style={s(HOVER_ACTION)}>
                    <Icon name="copy" size={12} color="#fff" /> Copy
                  </button>
                ) : (
                  <span style={s('color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.email}</span>
                )}
              </div>
              <div
                onMouseEnter={() => setHoverField(phoneKey)}
                onMouseLeave={() => setHoverField((h) => (h === phoneKey ? null : h))}
                style={s('height:26px;display:flex;align-items:center;justify-content:center;min-width:0')}
              >
                {hoverField === phoneKey && ld.phone ? (
                  <div style={s('width:96px;height:26px;border-radius:var(--radius-md);overflow:hidden;display:flex;background:linear-gradient(140deg,var(--accent),var(--accent-2))')}>
                    <button type="button" aria-label="Call phone" onClick={(e) => dial(e, ld.phone)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="calls" size={12} color="#fff" />
                    </button>
                    <span style={s('width:1px;background:rgba(255,255,255,.3);flex-shrink:0')} />
                    <button type="button" aria-label="Copy phone" onClick={(e) => copyVal(e, ld.phone, ld.phone)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="copy" size={12} color="#fff" />
                    </button>
                  </div>
                ) : (
                  <span style={s("color:var(--text2);font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{ld.phone || '—'}</span>
                )}
              </div>
              <div
                onMouseEnter={() => setHoverField(cellKey)}
                onMouseLeave={() => setHoverField((h) => (h === cellKey ? null : h))}
                style={s('height:26px;display:flex;align-items:center;justify-content:center;min-width:0')}
              >
                {hoverField === cellKey && ld.cell ? (
                  <div style={s('width:96px;height:26px;border-radius:var(--radius-md);overflow:hidden;display:flex;background:linear-gradient(140deg,var(--accent),var(--accent-2))')}>
                    <button type="button" aria-label="Call cell" onClick={(e) => dial(e, ld.cell)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="calls" size={12} color="#fff" />
                    </button>
                    <span style={s('width:1px;background:rgba(255,255,255,.3);flex-shrink:0')} />
                    <button type="button" aria-label="Copy cell" onClick={(e) => copyVal(e, ld.cell, ld.cell)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="copy" size={12} color="#fff" />
                    </button>
                  </div>
                ) : (
                  <span style={s("color:var(--text2);font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{ld.cell || '—'}</span>
                )}
              </div>
              <span style={s('color:var(--muted);white-space:nowrap')}>{ld.created}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="ss-scroll" style={s('display:flex;gap:14px;overflow-x:auto;padding-bottom:12px;align-items:flex-start')}>
      {leadColumns(rows.map((l) => l.status)).map((col) => {
        const cards = rows.filter((l) => l.status === col.key);
        return (
          <KanbanCol key={col.key} col={col} count={cards.length}>
            {cards.map((ld) => {
              const src = sourceBadge(ld.source);
              return (
                <div key={ld.id} onClick={() => openLead(ld)} className="ss-card-h" style={s(`padding:13px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-left:3px solid ${col.col};cursor:pointer;box-shadow:var(--shadow-sm)`)}>
                  <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:8px')}>
                    <div style={s('font-size:13px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.contact}</div>
                    <span style={s(`${src.style};flex-shrink:0;white-space:nowrap`)}>{src.text}</span>
                  </div>
                  <div style={s('font-size:11.5px;color:var(--text2);font-weight:500;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.company}</div>
                  <div style={s('font-size:11px;color:var(--muted);margin-top:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.email}</div>
                  <div style={s('margin-top:9px;display:flex;align-items:baseline;justify-content:space-between;gap:8px')}>
                    <span style={s("font-size:11.5px;color:var(--text2);font-weight:600;font-family:'JetBrains Mono',monospace;white-space:nowrap")}>{ld.phone || '—'}</span>
                    <span style={s('font-size:10.5px;color:var(--faint);white-space:nowrap')}>{ld.created}</span>
                  </div>
                </div>
              );
            })}
            {cards.length === 0 && <div style={s('padding:14px;text-align:center;font-size:11px;color:var(--faint)')}>Empty</div>}
          </KanbanCol>
        );
      })}
    </div>
  );
}

// ---------- Deals ----------

export function DealsView({ deals, search, view }: { deals: DealVM[]; search: string; view: 'kanban' | 'list' }) {
  const { openDeal } = useSales();
  const q = search.toLowerCase();
  const rows = q
    ? deals.filter((d) => `${d.name} ${d.company} ${d.stage} ${d.carrierId} ${d.app}`.toLowerCase().includes(q))
    : deals;

  if (view === 'list') {
    return (
      <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
        <div style={s('display:grid;grid-template-columns:1.6fr 1fr 0.9fr 0.9fr 0.8fr;gap:10px;padding:12px 16px;background:var(--alt);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
          <span>Deal</span><span>Stage</span><span>Carrier</span><span>App ID</span><span style={s('text-align:right')}>Created</span>
        </div>
        {rows.map((dl) => (
          <div key={dl.id} onClick={() => openDeal(dl)} className="ss-tab-x" style={s('display:grid;grid-template-columns:1.6fr 1fr 0.9fr 0.9fr 0.8fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:12.5px')}>
            <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{dl.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</span></div>
            <span style={s(`color:${dealStageColor(dl.stage)};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{dl.stage}</span>
            <span style={s("color:var(--text2);font-family:'JetBrains Mono',monospace")}>{dl.carrierId || '—'}</span>
            <span style={s("color:var(--text2);font-family:'JetBrains Mono',monospace")}>{dl.app || '—'}</span>
            <span style={s('text-align:right;color:var(--muted)')}>{dl.created}</span>
          </div>
        ))}
        {rows.length === 0 && <EmptyRow msg="No deals found." />}
      </div>
    );
  }

  return (
    <div className="ss-scroll" style={s('display:flex;gap:14px;overflow-x:auto;padding-bottom:12px;align-items:flex-start')}>
      {dealColumns().map((col) => {
        const cards = rows.filter((d) => d.stage === col.key);
        return (
          <KanbanCol key={col.key} col={col} count={cards.length}>
            {cards.map((dl) => (
              <div key={dl.id} onClick={() => openDeal(dl)} className="ss-card-h" style={s(`padding:13px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-left:3px solid ${col.col};cursor:pointer;box-shadow:var(--shadow-sm)`)}>
                <div style={s('font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</div>
                {dl.carrierId && <div style={s(SUB)}>Carrier: {dl.carrierId}</div>}
                {dl.app && <div style={s(SUB)}>App ID: {dl.app}</div>}
                {dl.utmSource && utmPill(dl.utmSource)}
                <div style={s(FOOT)}>
                  <span>{dl.created}</span>
                  {dl.appDate && <span>App: {dl.appDate}</span>}
                </div>
              </div>
            ))}
            {cards.length === 0 && <div style={s('padding:14px;text-align:center;font-size:11px;color:var(--faint)')}>Empty</div>}
          </KanbanCol>
        );
      })}
    </div>
  );
}

// ---------- Rejections (from Zoho Desk — real "Rejection Report" tickets) ----------

const REJ_STATUS_COL: Record<string, string> = {
  Open: 'var(--accent)',
  'On Hold': 'var(--warn)',
  Escalated: 'var(--violet)',
  Closed: 'var(--muted)',
  Resolved: 'var(--ok)',
};

export function RejectionsView({ rejections, search }: { rejections: RejectionVM[]; search: string }) {
  const q = search.toLowerCase();
  const rows = q
    ? rejections.filter((r) => `${r.company} ${r.number} ${r.reason} ${r.status}`.toLowerCase().includes(q))
    : rejections;

  return (
    <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
      <div style={s('display:grid;grid-template-columns:1.6fr 0.9fr 1.6fr 0.9fr 1fr;gap:10px;padding:12px 16px;background:var(--alt);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
        <span>Company</span><span>Ticket</span><span>Reason</span><span>Reported</span><span style={s('text-align:right')}>Status</span>
      </div>
      {rows.map((r) => {
        const stBadge = badge(r.status, REJ_STATUS_COL[r.status] ?? 'var(--muted)');
        return (
          <div key={r.id} style={s('display:grid;grid-template-columns:1.6fr 0.9fr 1.6fr 0.9fr 1fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}>
            <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{r.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.company}</span></div>
            <span style={s("font-family:'JetBrains Mono',monospace;color:var(--text2)")}>#{r.number}</span>
            <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')} title={r.reason}>{r.reason}</span>
            <span style={s('color:var(--muted)')}>{r.date}</span>
            <span style={s('text-align:right')}><span style={s(stBadge.style)}>{stBadge.text}</span></span>
          </div>
        );
      })}
      {rows.length === 0 && <EmptyRow msg="No rejection reports." />}
    </div>
  );
}
