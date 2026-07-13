/**
 * Data Center drilldowns — the Lead and Deal detail modals (ported from the reference prototype's
 * openLead / openDeal modals). Read-only views over a LeadVM / DealVM; the shell owns their open
 * state and renders them, mirroring ClientModal.
 */
import { s, Svg } from './dc';
import { badge } from './salesData';
import { dealStageColor, leadStatusColor, type DealVM, type LeadVM } from './dataCenterLive';

const CLOSE = 'M18 6L6 18M6 6l12 12';

function avStyle(col: string): string {
  return `width:52px;height:52px;border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
}
const CARD = 'padding:15px;border-radius:12px;background:var(--alt);border:1px solid var(--border2)';
const CARD_LABEL = 'font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em';

function StatCard({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div style={s(CARD)}>
      <div style={s(CARD_LABEL)}>{label}</div>
      <div style={s(`${mono ? "font-family:'JetBrains Mono',monospace;font-size:20px" : 'font-size:14px'};font-weight:700;margin-top:5px${color ? `;color:${color}` : ''}`)}>
        {value}
      </div>
    </div>
  );
}

export function LeadModal({
  lead,
  onClose,
  onCall,
}: {
  lead: LeadVM;
  onClose: () => void;
  /** Click-to-dial via RingCentral Embeddable (Sales shell wires this). */
  onCall?: (phone: string) => void;
}) {
  const meta = { col: leadStatusColor(lead.status), label: lead.status };
  const stageBadge = badge(meta.label, meta.col);
  const flagBadge = lead.converted ? badge('Converted', 'var(--ok)') : stageBadge;
  const canCall = Boolean(onCall && lead.phone.trim());
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:120;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s(`width:100%;max-width:540px;max-height:86vh;display:flex;flex-direction:column;border-radius:20px;background:var(--surface);border:1px solid var(--border);border-top:3px solid ${meta.col};box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden`)}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle(meta.col))}>{lead.initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{lead.company}</div>
            <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px')}>{lead.contact} · {lead.title}</div>
          </div>
          <span style={s(flagBadge.style)}>{flagBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Svg d={CLOSE} size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
          <div style={s('display:flex;align-items:center;gap:10px;margin-bottom:16px')}>
            <span style={s(stageBadge.style)}>{stageBadge.text}</span>
            {lead.created && <span style={s('font-size:11.5px;color:var(--muted)')}>Created {lead.created}</span>}
          </div>
          <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
            <StatCard label="Potential Value" value={lead.valueFmt} mono color={meta.col} />
            <StatCard label="Fleet Size" value={`${lead.trucks} trucks`} mono />
            <StatCard label="Source" value={lead.source} />
            <StatCard label="Status" value={lead.status} />
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Contact</div>
            <div style={s('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
              <div style={s("font-size:13px;font-weight:600;font-family:'JetBrains Mono',monospace;flex:1;min-width:140px")}>
                {lead.phone || '—'}
              </div>
              {canCall && (
                <button
                  type="button"
                  onClick={() => onCall?.(lead.phone)}
                  aria-label={`Call ${lead.phone}`}
                  style={s(`height:34px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12px;display:inline-flex;align-items:center;gap:7px;box-shadow:0 4px 14px rgba(var(--accent-rgb),.35)`)}
                >
                  <Svg d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.5a1 1 0 01-.5 1.21l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.5 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z" size={14} stroke="#fff" strokeWidth={2} />
                  Call
                </button>
              )}
            </div>
            <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:6px")}>{lead.email}</div>
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Notes</div>
            <div style={s('font-size:13px;line-height:1.6;color:var(--text2);white-space:pre-wrap')}>{lead.note}</div>
          </div>
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          {canCall && (
            <button
              type="button"
              onClick={() => onCall?.(lead.phone)}
              style={s('height:38px;padding:0 18px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px')}
            >
              Call {lead.phone}
            </button>
          )}
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function DealModal({ deal, onClose }: { deal: DealVM; onClose: () => void }) {
  const meta = { col: dealStageColor(deal.stage), label: deal.stage };
  const stageBadge = badge(meta.label, meta.col);
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:120;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s(`width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:20px;background:var(--surface);border:1px solid var(--border);border-top:3px solid ${meta.col};box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden`)}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle(meta.col))}>{deal.initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{deal.company}</div>
            <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{deal.name}</div>
          </div>
          <span style={s(stageBadge.style)}>{stageBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:8px;border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Svg d={CLOSE} size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
          <div style={s(`margin-bottom:16px;${CARD}`)}>
            <div style={s('display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:8px')}>
              <span style={s('text-transform:uppercase;letter-spacing:.05em;font-weight:700')}>Win probability</span>
              <span style={s(`color:${meta.col};font-weight:800;font-family:'JetBrains Mono',monospace`)}>{deal.prob}%</span>
            </div>
            <div style={s('height:8px;border-radius:99px;background:var(--raised);overflow:hidden')}>
              <div style={s(`height:100%;width:${deal.prob}%;background:${meta.col}`)} />
            </div>
            <div style={s('font-size:11px;color:var(--muted);margin-top:9px')}>Expected close {deal.close}</div>
          </div>
          <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
            <StatCard label="Deal Value" value={deal.valueFmt} mono color={meta.col} />
            <StatCard label="Cards" value={String(deal.cards)} mono />
            <StatCard label="Application" value={deal.app} />
            <StatCard label="Carrier" value={deal.carrier} />
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Contact</div>
            <div style={s('font-size:13px;font-weight:600')}>{deal.contact}</div>
            <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{deal.phone}</div>
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Notes</div>
            <div style={s('font-size:13px;line-height:1.6;color:var(--text2);white-space:pre-wrap')}>{deal.note}</div>
          </div>
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
        </div>
      </div>
    </div>
  );
}
