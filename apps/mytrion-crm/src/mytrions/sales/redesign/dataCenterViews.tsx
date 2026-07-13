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
  DEAL_STAGES,
  DEAL_STAGE_META,
  LEAD_STAGES,
  LEAD_STAGE_META,
  REASON_COL,
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
    { label: 'Filled', value: String(rows.filter((l) => l.stage === 'filled').length), col: 'var(--ok)' },
  ];

  return (
    <>
      <Stats items={stats} />
      {rows.length === 0 ? (
        <div style={s('border-radius:14px;border:1px solid var(--border);background:var(--surface)')}><EmptyRow msg="No leads match your search." /></div>
      ) : view === 'kanban' ? (
        <div className="ss-scroll" style={s('display:flex;gap:14px;overflow-x:auto;padding-bottom:12px;align-items:flex-start')}>
          {LEAD_STAGES.map((col) => {
            const cards = rows.filter((l) => l.stage === col.key);
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
            const meta = LEAD_STAGE_META[ld.stage];
            return (
              <div key={ld.id} onClick={() => openLead(ld)} className="ss-tab-x" style={s('display:grid;grid-template-columns:1.6fr 1.2fr 1fr 1fr 0.8fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:12.5px')}>
                <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{ld.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{ld.company}</span></div>
                <span style={s('color:var(--text2)')}>{ld.contact}</span>
                <span style={s(`color:${meta.col};font-weight:700`)}>{meta.label}</span>
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
          {DEAL_STAGES.map((col) => {
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
            const meta = DEAL_STAGE_META[dl.stage];
            return (
              <div key={dl.id} onClick={() => openDeal(dl)} className="ss-tab-x" style={s('display:grid;grid-template-columns:1.6fr 1.4fr 1fr 0.9fr 0.9fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;cursor:pointer;font-size:12.5px')}>
                <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{dl.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.company}</span></div>
                <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{dl.name}</span>
                <span style={s(`color:${meta.col};font-weight:700`)}>{meta.label}</span>
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

export function RejectionsView({ rejections, search }: { rejections: RejectionVM[]; search: string }) {
  const q = search.toLowerCase();
  const rows = q
    ? rejections.filter((r) => `${r.company} ${r.appId} ${r.reason} ${r.reasonCat}`.toLowerCase().includes(q))
    : rejections;
  const stats = [
    { label: 'Total Rejected', value: String(rejections.length), col: 'var(--danger)' },
    { label: 'Retry Eligible', value: String(rejections.filter((r) => r.canRetry).length), col: 'var(--ok)' },
    { label: 'This Month', value: String(rejections.filter((r) => r.month).length), col: 'var(--text)' },
  ];
  const agg = new Map<string, number>();
  for (const r of rejections) agg.set(r.reasonCat, (agg.get(r.reasonCat) ?? 0) + 1);
  const max = Math.max(1, ...agg.values());
  const breakdown = [...agg.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Stats items={stats} />
      {breakdown.length > 0 && (
        <div style={s('padding:18px 20px;border-radius:16px;background:var(--surface);border:1px solid var(--border);margin-bottom:16px')}>
          <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:14px')}>Why applications were rejected</div>
          <div style={s('display:flex;flex-direction:column;gap:11px')}>
            {breakdown.map(([cat, count]) => {
              const col = REASON_COL[cat] ?? 'var(--text2)';
              return (
                <div key={cat} style={s('display:flex;align-items:center;gap:12px')}>
                  <span style={s('width:110px;font-size:12px;font-weight:600;color:var(--text2);flex-shrink:0')}>{cat}</span>
                  <div style={s('flex:1;height:22px;border-radius:7px;background:var(--raised);overflow:hidden')}>
                    <div style={s(`height:100%;width:${Math.round((count / max) * 100)}%;background:color-mix(in srgb,${col} 32%,transparent);border-left:3px solid ${col}`)} />
                  </div>
                  <span style={s(`font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:600;width:24px;text-align:right;color:${col}`)}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={s('border-radius:14px;border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
        <div style={s('display:grid;grid-template-columns:1.6fr 0.9fr 1.5fr 0.9fr 1.1fr;gap:10px;padding:12px 16px;background:var(--alt);font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
          <span>Company</span><span>App ID</span><span>Reason</span><span>Rejected</span><span style={s('text-align:right')}>Status</span>
        </div>
        {rows.map((r) => {
          const retry = r.canRetry ? badge('Retry eligible', 'var(--ok)') : badge('Closed', 'var(--muted)');
          return (
            <div key={r.id} style={s('display:grid;grid-template-columns:1.6fr 0.9fr 1.5fr 0.9fr 1.1fr;gap:10px;padding:13px 16px;border-top:1px solid var(--border2);align-items:center;font-size:12.5px')}>
              <div style={s('display:flex;align-items:center;gap:10px;min-width:0')}><div style={s(AV())}>{r.initials}</div><span style={s('font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{r.company}</span></div>
              <span style={s("font-family:'JetBrains Mono',monospace;color:var(--text2)")}>{r.appId}</span>
              <span style={s('color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')} title={r.reason}>{r.reason}</span>
              <span style={s('color:var(--muted)')}>{r.date}</span>
              <span style={s('text-align:right')}><span style={s(retry.style)}>{retry.text}</span></span>
            </div>
          );
        })}
        {rows.length === 0 && <EmptyRow msg="No rejections match your search." />}
      </div>
    </>
  );
}
