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
import { useIsPhone } from '@/hooks/useMediaQuery';
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import { setDialContext } from '@/components/ringcentral/ringcentralEvents';
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
import { PhoneDealsList, PhoneLeadsList, PhoneRejectionsList } from './dataCenterPhoneList';

const AV = (size = 34, fs = 13): string =>
  `width:${size}px;height:${size}px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-weight:700;font-size:${fs}px;background:var(--raised);color:var(--text2)`;
const COUNT_CHIP =
  "min-width:22px;height:20px;padding:0 7px;border-radius:99px;background:var(--raised);color:var(--muted);font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-mono)";
const SUB = 'font-size:12px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
const FOOT = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;font-size:12px;color:var(--faint)';
const LEAD_LIST_COLS =
  'display:grid;grid-template-columns:170px 170px 130px 120px 210px 140px 140px 100px;gap:10px;padding:12px 16px;min-width:fit-content';
const HOVER_ACTION =
  'width:96px;height:26px;border-radius:var(--radius-md);border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;gap:6px;flex-shrink:0';

function utmPill(source: string) {
  const c = utmColor(source);
  return (
    <span style={s(`display:inline-block;margin-top:8px;font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,${c} 16%,transparent);color:${c}`)}>{source}</span>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return <div style={s('padding:44px;text-align:center;color:var(--muted);font-size:14px')}>{msg}</div>;
}

function KanbanCol({ col, count, children }: { col: { label: string; col: string }; count: number; children: ReactNode }) {
  return (
    <div style={s('flex:0 0 264px;width:264px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);display:flex;flex-direction:column;max-height:640px')}>
      <div style={s('display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--border2)')}>
        <span style={s(`width:8px;height:8px;border-radius:50%;background:${col.col}`)} />
        <span style={s('font-family:var(--font-head);font-weight:700;font-size:14px;letter-spacing:.04em;text-transform:uppercase;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{col.label}</span>
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

export function LeadsView({
  leads,
  search,
  view,
  statusFilter = 'all',
  sourceFilter = 'all',
  metaOnly = false,
}: {
  leads: LeadVM[];
  search: string;
  view: 'kanban' | 'list';
  statusFilter?: string;
  sourceFilter?: string;
  metaOnly?: boolean;
}) {
  const { openLead, pushToast } = useSales();
  const phone = useIsPhone();
  const [hoverField, setHoverField] = useState<string | null>(null);
  const q = search.toLowerCase();
  const rows = leads.filter((l) => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
    // "Meta" quick-filter — Meta/Facebook/Instagram ad leads carry a utm_source containing "meta".
    if (metaOnly && !l.source.toLowerCase().includes('meta')) return false;
    if (q && !`${l.contact} ${l.company} ${l.source} ${l.status} ${l.phone} ${l.cell} ${l.email}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  if (rows.length === 0) {
    return <EmptyRow msg="No leads found." />;
  }

  if (phone) {
    return <PhoneLeadsList rows={rows} onOpen={openLead} />;
  }

  const copyVal = (e: MouseEvent, value: string, label: string): void => {
    stop(e);
    if (!value || value === '—') return;
    void navigator.clipboard?.writeText(value).then(
      () => pushToast('Copied', label),
      () => pushToast('Copy failed', label),
    );
  };

  const dial = (e: MouseEvent, phone: string, leadId: string): void => {
    stop(e);
    if (!phone.trim()) return;
    // Success only — never toast Phone/backend load failures.
    setDialContext({ leadId });
    clickToDial(phone);
  };

  if (view === 'list') {
    return (
      <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow-x:auto;background:var(--surface)')}>
        <div style={s(`${LEAD_LIST_COLS};background:var(--alt);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)`)}>
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
              style={s(`${LEAD_LIST_COLS.replace('padding:12px 16px', 'padding:13px 16px')};border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:14px`)}
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
                    <button type="button" aria-label="Call phone" onClick={(e) => dial(e, ld.phone, ld.id)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="calls" size={12} color="#fff" />
                    </button>
                    <span style={s('width:1px;background:rgba(255,255,255,.3);flex-shrink:0')} />
                    <button type="button" aria-label="Copy phone" onClick={(e) => copyVal(e, ld.phone, ld.phone)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="copy" size={12} color="#fff" />
                    </button>
                  </div>
                ) : (
                  <span style={s("color:var(--text2);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{ld.phone || '—'}</span>
                )}
              </div>
              <div
                onMouseEnter={() => setHoverField(cellKey)}
                onMouseLeave={() => setHoverField((h) => (h === cellKey ? null : h))}
                style={s('height:26px;display:flex;align-items:center;justify-content:center;min-width:0')}
              >
                {hoverField === cellKey && ld.cell ? (
                  <div style={s('width:96px;height:26px;border-radius:var(--radius-md);overflow:hidden;display:flex;background:linear-gradient(140deg,var(--accent),var(--accent-2))')}>
                    <button type="button" aria-label="Call cell" onClick={(e) => dial(e, ld.cell, ld.id)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="calls" size={12} color="#fff" />
                    </button>
                    <span style={s('width:1px;background:rgba(255,255,255,.3);flex-shrink:0')} />
                    <button type="button" aria-label="Copy cell" onClick={(e) => copyVal(e, ld.cell, ld.cell)} style={s('flex:1;height:100%;border:none;cursor:pointer;background:transparent;color:#fff;display:flex;align-items:center;justify-content:center')}>
                      <Icon name="copy" size={12} color="#fff" />
                    </button>
                  </div>
                ) : (
                  <span style={s("color:var(--text2);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{ld.cell || '—'}</span>
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
                <div key={ld.id} onClick={() => openLead(ld)} className="ss-card-h" style={s(`padding:13px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)`)}>
                  <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:8px')}>
                    <div style={s('font-size:14px;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.contact}</div>
                    <span style={s(`${src.style};flex-shrink:0;white-space:nowrap`)}>{src.text}</span>
                  </div>
                  <div style={s('font-size:13px;color:var(--text2);font-weight:500;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.company}</div>
                  <div style={s('font-size:12px;color:var(--muted);margin-top:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.email}</div>
                  <div style={s('margin-top:9px;display:flex;align-items:baseline;justify-content:space-between;gap:8px')}>
                    <span style={s("font-size:13px;color:var(--text2);font-weight:600;font-family:var(--font-mono);white-space:nowrap")}>{ld.phone || '—'}</span>
                    <span style={s('font-size:12px;color:var(--faint);white-space:nowrap')}>{ld.created}</span>
                  </div>
                </div>
              );
            })}
            {cards.length === 0 && <div style={s('padding:14px;text-align:center;font-size:12px;color:var(--faint)')}>Empty</div>}
          </KanbanCol>
        );
      })}
    </div>
  );
}

// ---------- Deals ----------

export function DealsView({
  deals,
  search,
  view,
  stageFilter = 'all',
}: {
  deals: DealVM[];
  search: string;
  view: 'kanban' | 'list';
  stageFilter?: string;
}) {
  const { openDeal } = useSales();
  const phone = useIsPhone();
  const q = search.toLowerCase();
  const rows = deals.filter((d) => {
    if (stageFilter !== 'all' && d.stage !== stageFilter) return false;
    if (q && !`${d.name} ${d.company} ${d.stage} ${d.carrierId} ${d.app}`.toLowerCase().includes(q)) return false;
    return true;
  });

  if (phone) {
    if (rows.length === 0) return <EmptyRow msg="No deals found." />;
    return <PhoneDealsList rows={rows} onOpen={openDeal} />;
  }

  if (view === 'list') {
    return (
      <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
        <div style={s('display:grid;grid-template-columns:1.6fr 1fr 0.9fr 0.9fr 0.8fr;gap:10px;padding:12px 16px;background:var(--alt);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
          <span>Deal</span><span>Stage</span><span>Carrier</span><span>App ID</span><span style={s('text-align:right')}>Created</span>
        </div>
        {rows.map((dl) => (
          <div key={dl.id} onClick={() => openDeal(dl)} className="ss-tab-x" style={s('display:grid;grid-template-columns:1.6fr 1fr 0.9fr 0.9fr 0.8fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:14px')}>
            <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{dl.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</span></div>
            <span style={s(`color:${dealStageColor(dl.stage)};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{dl.stage}</span>
            <span style={s("color:var(--text2);font-family:var(--font-mono)")}>{dl.carrierId || '—'}</span>
            <span style={s("color:var(--text2);font-family:var(--font-mono)")}>{dl.app || '—'}</span>
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
              <div key={dl.id} onClick={() => openDeal(dl)} className="ss-card-h" style={s(`padding:13px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)`)}>
                <div style={s('font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</div>
                {dl.carrierId && <div style={s(SUB)}>Carrier: {dl.carrierId}</div>}
                {dl.app && <div style={s(SUB)}>App ID: {dl.app}</div>}
                {dl.utmSource && utmPill(dl.utmSource)}
                <div style={s(FOOT)}>
                  <span>{dl.created}</span>
                  {dl.appDate && <span>App: {dl.appDate}</span>}
                </div>
              </div>
            ))}
            {cards.length === 0 && <div style={s('padding:14px;text-align:center;font-size:12px;color:var(--faint)')}>Empty</div>}
          </KanbanCol>
        );
      })}
    </div>
  );
}

// ---------- Rejections (from Zoho Desk — real "Rejection Report" tickets) ----------

export function RejectionsView({
  rejections,
  search,
  onOpen,
}: {
  rejections: RejectionVM[];
  search: string;
  onOpen: (r: RejectionVM) => void;
}) {
  const q = search.toLowerCase();
  const phone = useIsPhone();
  const rows = q
    ? rejections.filter((r) =>
        `${r.company} ${r.number} ${r.reason} ${r.driverName} ${r.cardLast4}`.toLowerCase().includes(q),
      )
    : rejections;

  if (phone) {
    if (rows.length === 0) {
      return <EmptyRow msg="No declines match that search." />;
    }
    return <PhoneRejectionsList rows={rows} onOpen={onOpen} />;
  }

  // Status is gone: every row is 'new' until someone works it, so the column was a wall of identical
  // "Open" badges carrying no information. The width goes to the decline reason instead, which is the
  // thing an agent actually scans for. Fraud is the one state worth flagging, so it rides the row.
  const COLS = 'grid-template-columns:1.5fr 0.8fr 1.9fr 0.9fr 0.8fr';

  return (
    <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
      <div style={s(`display:grid;${COLS};gap:12px;padding:12px 16px;background:var(--alt);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)`)}>
        <span>Company</span><span>Carrier</span><span>Reason</span><span>Driver</span>
        <span style={s('text-align:right')}>Reported</span>
      </div>
      {rows.length === 0 ? (
        <div style={s('padding:26px 16px;text-align:center;color:var(--muted);font-size:14px')}>
          No declines match that search.
        </div>
      ) : null}
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r)}
          className="ss-row-h"
          style={s(`width:100%;text-align:left;display:grid;${COLS};gap:12px;padding:13px 16px;border:none;border-top:1px solid var(--border2);background:none;color:var(--text);align-items:center;font-size:14px;font-family:inherit;cursor:pointer`)}
        >
          <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}>
            <div style={s(AV())}>{r.initials}</div>
            <span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
              {r.company}
            </span>
          </div>
          <span style={s("font-family:var(--font-mono);color:var(--text2)")}>#{r.number}</span>
          <span style={s('min-width:0;display:flex;align-items:center;gap:8px')}>
            {r.errorCode ? (
              <span style={s(`flex-shrink:0;padding:2px 7px;border-radius:var(--radius-xs,6px);font-family:var(--font-mono);font-size:11.5px;font-weight:700;background:color-mix(in srgb,${r.isFraud ? 'var(--danger)' : 'var(--accent)'} 14%,transparent);color:${r.isFraud ? 'var(--danger)' : 'var(--accent)'}`)}>
                {r.errorCode}
              </span>
            ) : null}
            <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')} title={r.errorRaw || r.errorText}>
              {r.errorText || 'Declined'}
            </span>
          </span>
          <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
            {r.driverName || '—'}
          </span>
          <span style={s('color:var(--muted);text-align:right;white-space:nowrap')}>{r.date}</span>
        </button>
      ))}
    </div>
  );
}
