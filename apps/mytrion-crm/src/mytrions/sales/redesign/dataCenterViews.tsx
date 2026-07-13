/**
 * Data Center views — Leads & Deals (kanban / list) and the Rejection report. Ported from the
 * reference prototype's dcLeads / dcDeals / dcRejections slices, rendering the real CRM
 * view-models (LeadVM / DealVM / RejectionVM). Clicking a card opens the shell's lead/deal modal.
 */
import { s } from './dc';
import { badge } from './salesData';
import { money } from './live';
import { useSales } from './ctx';
import {
  DEAL_STAGE_ORDER,
  LEAD_STATUS_ORDER,
  columnsFor,
  stageColor,
  TEMP_COL,
  type DealVM,
  type LeadVM,
  type RejectionVM,
} from './dataCenterLive';

const AV = (size = 34, fs = 13): string =>
  `width:${size}px;height:${size}px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:${fs}px;background:var(--raised);color:var(--text2)`;
const COUNT_CHIP =
  "min-width:22px;height:20px;padding:0 7px;border-radius:99px;background:var(--raised);color:var(--muted);font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace";

function Stats({ items }: { items: { label: string; value: string; col: string }[] }) {
  return (
    <div style={s('display:flex;gap:26px;flex-wrap:wrap;align-items:baseline;margin:2px 2px 18px')}>
      {items.map((st) => (
        <div key={st.label} style={s('display:flex;align-items:baseline;gap:8px')}>
          <span style={s(`font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;color:${st.col}`)}>{st.value}</span>
          <span style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700')}>{st.label}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyRow({ msg }: { msg: string }) {
  return <div style={s('padding:44px;text-align:center;color:var(--muted);font-size:13px')}>{msg}</div>;
}

// ---------- Leads ----------

export function LeadsView({ leads, search, view }: { leads: LeadVM[]; search: string; view: 'kanban' | 'list' }) {
  const { openLead } = useSales();
  const q = search.toLowerCase();
  const rows = q
    ? leads.filter((l) => `${l.company} ${l.contact} ${l.source} ${l.status}`.toLowerCase().includes(q))
    : leads;
  const total = rows.reduce((a, l) => a + l.value, 0);
  const stats = [
    { label: 'Open Leads', value: String(rows.length), col: 'var(--accent)' },
    { label: 'Pipeline Value', value: total > 0 ? money(total) : '—', col: 'var(--text)' },
    { label: 'Hot Leads', value: String(rows.filter((l) => l.temp === 'hot').length), col: 'var(--danger)' },
    { label: 'Filled', value: String(rows.filter((l) => l.status === 'Application Filled').length), col: 'var(--ok)' },
  ];

  return (
    <>
      <Stats items={stats} />
      {rows.length === 0 ? (
        <div style={s('border-radius:14px;border:1px solid var(--border);background:var(--surface)')}><EmptyRow msg="No leads match your search." /></div>
      ) : view === 'kanban' ? (
        <div className="ss-scroll" style={s('display:flex;gap:14px;overflow-x:auto;padding-bottom:12px;align-items:flex-start')}>
          {columnsFor(LEAD_STATUS_ORDER, rows.map((l) => l.status)).map((col) => {
            const cards = rows.filter((l) => l.status === col.key);
            return (
              <div key={col.key} style={s('flex:0 0 264px;width:264px;border-radius:16px;background:var(--alt);border:1px solid var(--border2);display:flex;flex-direction:column;max-height:600px')}>
                <div style={s('display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--border2)')}>
                  <span style={s(`width:8px;height:8px;border-radius:50%;background:${col.col}`)} />
                  <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:13.5px;letter-spacing:.04em;text-transform:uppercase;flex:1')}>{col.label}</span>
                  <span style={s(COUNT_CHIP)}>{cards.length}</span>
                </div>
                <div className="ss-scroll" style={s('padding:11px;display:flex;flex-direction:column;gap:10px;overflow-y:auto')}>
                  {cards.map((ld) => (
                    <div key={ld.id} onClick={() => openLead(ld)} className="ss-card-h" style={s('padding:13px;border-radius:13px;background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
                      <div style={s('display:flex;align-items:center;gap:10px')}>
                        <div style={s(AV())}>{ld.initials}</div>
                        <div style={s('min-width:0;flex:1')}>
                          <div style={s('font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.company}</div>
                          <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px')}>{ld.contact}</div>
                        </div>
                      </div>
                      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-top:11px')}>
                        <span style={s("font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600")}>{ld.valueFmt}</span>
                        <span style={s('display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);font-weight:600')}>
                          <span style={s(`width:7px;height:7px;border-radius:50%;background:${TEMP_COL[ld.temp]}`)} />{ld.temp.charAt(0).toUpperCase() + ld.temp.slice(1)}
                        </span>
                      </div>
                      <div style={s('margin-top:9px;font-size:10.5px;color:var(--muted)')}>{ld.trucks} trucks · {ld.last}</div>
                    </div>
                  ))}
                  {cards.length === 0 && <div style={s('padding:14px;text-align:center;font-size:11px;color:var(--faint)')}>Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={s('border-radius:14px;border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
          <div style={s('display:grid;grid-template-columns:1.6fr 1.2fr 1fr 1fr 0.8fr;gap:10px;padding:12px 16px;background:var(--alt);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
            <span>Company</span><span>Contact</span><span>Stage</span><span style={s('text-align:right')}>Value</span><span style={s('text-align:right')}>Temp</span>
          </div>
          {rows.map((ld) => {
            const stCol = stageColor(LEAD_STATUS_ORDER, ld.status);
            return (
              <div key={ld.id} onClick={() => openLead(ld)} className="ss-tab-x" style={s('display:grid;grid-template-columns:1.6fr 1.2fr 1fr 1fr 0.8fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:12.5px')}>
                <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{ld.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.company}</span></div>
                <span style={s('color:var(--text2)')}>{ld.contact}</span>
                <span style={s(`color:${stCol};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{ld.status}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>{ld.valueFmt}</span>
                <span style={s('text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:6px;color:var(--muted);font-size:11.5px;font-weight:600')}><span style={s(`width:7px;height:7px;border-radius:50%;background:${TEMP_COL[ld.temp]}`)} />{ld.temp.charAt(0).toUpperCase() + ld.temp.slice(1)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------- Deals ----------

export function DealsView({ deals, search, view }: { deals: DealVM[]; search: string; view: 'kanban' | 'list' }) {
  const { openDeal } = useSales();
  const q = search.toLowerCase();
  const rows = q
    ? deals.filter((d) => `${d.company} ${d.name} ${d.app} ${d.contact}`.toLowerCase().includes(q))
    : deals;
  const total = rows.reduce((a, d) => a + d.value, 0);
  const weighted = Math.round(rows.reduce((a, d) => a + (d.value * d.prob) / 100, 0));
  const stats = [
    { label: 'Open Deals', value: String(rows.length), col: 'var(--accent)' },
    { label: 'Pipeline Value', value: total > 0 ? money(total) : '—', col: 'var(--text)' },
    { label: 'Weighted Forecast', value: weighted > 0 ? money(weighted) : '—', col: 'var(--violet)' },
    { label: 'Closing This Week', value: String(rows.filter((d) => d.thisWeek).length), col: 'var(--warn)' },
  ];

  return (
    <>
      <Stats items={stats} />
      {rows.length === 0 ? (
        <div style={s('border-radius:14px;border:1px solid var(--border);background:var(--surface)')}><EmptyRow msg="No deals match your search." /></div>
      ) : view === 'kanban' ? (
        <div className="ss-scroll" style={s('display:flex;gap:14px;overflow-x:auto;padding-bottom:12px;align-items:flex-start')}>
          {columnsFor(DEAL_STAGE_ORDER, rows.map((d) => d.stage)).map((col) => {
            const cards = rows.filter((d) => d.stage === col.key);
            return (
              <div key={col.key} style={s('flex:0 0 264px;width:264px;border-radius:16px;background:var(--alt);border:1px solid var(--border2);display:flex;flex-direction:column;max-height:600px')}>
                <div style={s('display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--border2)')}>
                  <span style={s(`width:8px;height:8px;border-radius:50%;background:${col.col}`)} />
                  <span style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:13.5px;letter-spacing:.04em;text-transform:uppercase;flex:1')}>{col.label}</span>
                  <span style={s(COUNT_CHIP)}>{cards.length}</span>
                </div>
                <div className="ss-scroll" style={s('padding:11px;display:flex;flex-direction:column;gap:10px;overflow-y:auto')}>
                  {cards.map((dl) => (
                    <div key={dl.id} onClick={() => openDeal(dl)} className="ss-card-h" style={s('padding:13px;border-radius:13px;background:var(--surface);border:1px solid var(--border);cursor:pointer;box-shadow:var(--shadow-sm)')}>
                      <div style={s('display:flex;align-items:center;gap:10px')}>
                        <div style={s(AV())}>{dl.initials}</div>
                        <div style={s('min-width:0;flex:1')}>
                          <div style={s('font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.company}</div>
                          <div style={s('font-size:10.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</div>
                        </div>
                      </div>
                      <div style={s('display:flex;align-items:center;justify-content:space-between;margin-top:11px')}>
                        <span style={s("font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600")}>{dl.valueFmt}</span>
                        <span style={s('font-size:10.5px;color:var(--muted)')}>{dl.cards} cards</span>
                      </div>
                      <div style={s('margin-top:10px')}>
                        <div style={s('display:flex;justify-content:space-between;font-size:9.5px;color:var(--muted);margin-bottom:4px')}><span>Win probability</span><span style={s('color:var(--text2);font-weight:700')}>{dl.prob}%</span></div>
                        <div style={s('height:5px;border-radius:99px;background:var(--raised);overflow:hidden')}><div style={s(`height:100%;width:${dl.prob}%;background:var(--accent)`)} /></div>
                      </div>
                      <div style={s('margin-top:9px;font-size:10.5px;color:var(--muted)')}>Closes {dl.close}</div>
                    </div>
                  ))}
                  {cards.length === 0 && <div style={s('padding:14px;text-align:center;font-size:11px;color:var(--faint)')}>Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={s('border-radius:14px;border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
          <div style={s('display:grid;grid-template-columns:1.6fr 1.4fr 1fr 0.9fr 0.9fr;gap:10px;padding:12px 16px;background:var(--alt);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
            <span>Company</span><span>Deal</span><span>Stage</span><span style={s('text-align:right')}>Value</span><span style={s('text-align:right')}>Close</span>
          </div>
          {rows.map((dl) => {
            const stCol = stageColor(DEAL_STAGE_ORDER, dl.stage);
            return (
              <div key={dl.id} onClick={() => openDeal(dl)} className="ss-tab-x" style={s('display:grid;grid-template-columns:1.6fr 1.4fr 1fr 0.9fr 0.9fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:12.5px')}>
                <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{dl.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.company}</span></div>
                <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</span>
                <span style={s(`color:${stCol};font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{dl.stage}</span>
                <span style={s("text-align:right;font-family:'JetBrains Mono',monospace;font-weight:600")}>{dl.valueFmt}</span>
                <span style={s('text-align:right;color:var(--muted)')}>{dl.close}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------- Rejections ----------

const REJ_STATUS_COL: Record<string, string> = {
  Open: 'var(--accent)',
  'On Hold': 'var(--warn)',
  Escalated: 'var(--violet)',
  Closed: 'var(--muted)',
  Resolved: 'var(--ok)',
};

/**
 * Rejection reports — the real "Rejection Report: …" tickets from Zoho Desk. No computed totals, no
 * synthetic categories: just the report rows Desk created (company, reason/error, when, status).
 */
export function RejectionsView({ rejections, search }: { rejections: RejectionVM[]; search: string }) {
  const q = search.toLowerCase();
  const rows = q
    ? rejections.filter((r) => `${r.company} ${r.number} ${r.reason} ${r.status}`.toLowerCase().includes(q))
    : rejections;

  return (
    <div style={s('border-radius:14px;border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
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
