/**
 * Data Center drilldowns — Lead and Deal detail modals. Lead layout matches the Sales Mytrion
 * Leads redesign (contact hero, Phone + Cell call rows, MC/DOT/dates). Read-only over LeadVM /
 * DealVM; the shell owns open state.
 */
import { s } from './dc';
import { Icon } from './icons';
import { badge } from './salesData';
import { dealStageColor, leadSourceColor, leadStatusColor, type DealVM, type LeadVM } from './dataCenterLive';

function avStyle(col: string): string {
  return `width:52px;height:52px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-weight:700;font-size:19px;background:color-mix(in srgb,${col} 16%,transparent);color:${col}`;
}
const CARD = 'padding:15px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';
const CARD_LABEL = 'font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em';
const DATE_ROW = 'display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid var(--border2)';
const CALL_BTN =
  'width:30px;height:30px;border-radius:50%;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);cursor:pointer;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0';

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

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s(DATE_ROW)}>
      <span style={s('font-size:11.5px;color:var(--muted)')}>{label}</span>
      <span style={s("font-size:12px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace")}>{value}</span>
    </div>
  );
}

function ContactCallRow({
  label,
  value,
  onCall,
}: {
  label: string;
  value: string;
  onCall?: (phone: string) => void;
}) {
  const canCall = Boolean(onCall && value.trim() && value !== '—');
  return (
    <div style={s('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--border2)')}>
      <div style={s('flex:1;min-width:0')}>
        <div style={s('font-size:9.5px;color:var(--muted)')}>{label}</div>
        <div style={s("font-size:12px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>
          {value.trim() ? value : '—'}
        </div>
      </div>
      {canCall && (
        <button type="button" aria-label={`Call ${label.toLowerCase()}`} onClick={() => onCall?.(value)} style={s(CALL_BTN)}>
          <Icon name="calls" size={13} />
        </button>
      )}
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
  const stageBadge = lead.converted ? badge('Converted', 'var(--ok)') : badge(meta.label, meta.col);
  const canCallPhone = Boolean(onCall && lead.phone.trim());
  const fleetText = `${lead.trucks} truck${lead.trucks === 1 ? '' : 's'}`;
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:120;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s(`width:100%;max-width:540px;max-height:86vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid ${meta.col};box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden`)}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle(meta.col))}>{lead.initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{lead.contact}</div>
            <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px')}>{lead.company}</div>
          </div>
          <span style={s(stageBadge.style)}>{stageBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Icon name="close" size={15} strokeWidth={2.4} />
          </button>
        </div>
        <div className="ss-scroll" style={s('flex:1;min-height:0;padding:22px')}>
          <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:12px')}>
            <StatCard label="Fleet Size" value={fleetText} mono />
            <div style={s(CARD)}>
              <div style={s(CARD_LABEL)}>Source</div>
              {(() => {
                const src = lead.source || 'No source';
                const c = leadSourceColor(src);
                return (
                  <div style={s(`margin-top:8px;display:inline-block;font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;background:color-mix(in srgb,${c} 16%,transparent);color:${c}`)}>
                    {src}
                  </div>
                );
              })()}
            </div>
            <StatCard label="MC Number" value={lead.mc} mono />
            <StatCard label="DOT Number" value={lead.dot} mono />
            <div style={s(`grid-column:1 / span 2;${CARD}`)}>
              <div style={s(CARD_LABEL)}>Referral Source</div>
              <div style={s('font-size:14px;font-weight:700;margin-top:5px')}>{lead.referral}</div>
            </div>
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:10px`)}>Contact</div>
            <ContactCallRow label="Phone" value={lead.phone} {...(onCall ? { onCall } : {})} />
            <ContactCallRow label="Cell" value={lead.cell} {...(onCall ? { onCall } : {})} />
            <div style={s('padding:9px 0;border-top:1px solid var(--border2)')}>
              <div style={s('font-size:9.5px;color:var(--muted)')}>Email</div>
              <div style={s("font-size:12px;font-weight:600;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:2px")}>{lead.email}</div>
            </div>
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:10px`)}>Dates</div>
            <DateRow label="Created" value={lead.createdAt} />
            <DateRow label="FB Registration" value={lead.fbRegisteredAt} />
            <DateRow label="Web Registration" value={lead.webRegisteredAt} />
            <DateRow label="Last Activity" value={lead.lastActivityAt} />
            <DateRow label="Modified" value={lead.modifiedAt} />
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Notes</div>
            <div style={s('font-size:13px;line-height:1.6;color:var(--text2);white-space:pre-wrap')}>{lead.note}</div>
          </div>
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          {canCallPhone && (
            <button
              type="button"
              onClick={() => onCall?.(lead.phone)}
              style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px')}
            >
              Call {lead.phone}
            </button>
          )}
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function DealModal({
  deal,
  onClose,
  onCall,
}: {
  deal: DealVM;
  onClose: () => void;
  /** Click-to-dial via RingCentral Embeddable (Sales shell wires this). */
  onCall?: (phone: string) => void;
}) {
  const meta = { col: dealStageColor(deal.stage), label: deal.stage };
  const stageBadge = badge(meta.label, meta.col);
  const canCallPhone = Boolean(onCall && deal.phone.trim() && deal.phone !== '—');
  return (
    <div onClick={onClose} style={s('position:fixed;inset:0;z-index:120;background:rgba(3,7,14,.62);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}>
      <div onClick={(e) => e.stopPropagation()} style={s(`width:100%;max-width:560px;max-height:86vh;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid ${meta.col};box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden`)}>
        <div style={s('padding:22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px')}>
          <div style={s(avStyle(meta.col))}>{deal.initials}</div>
          <div style={s('flex:1;min-width:0')}>
            <div style={s('font-size:17px;font-weight:700')}>{deal.company}</div>
            <div style={s('font-size:11.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{deal.name}</div>
          </div>
          <span style={s(stageBadge.style)}>{stageBadge.text}</span>
          <button onClick={onClose} aria-label="Close" className="ss-ico-btn" style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center')}>
            <Icon name="close" size={15} strokeWidth={2.4} />
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
            <ContactCallRow label="Phone" value={deal.phone} {...(onCall ? { onCall } : {})} />
          </div>
          <div style={s(`margin-top:14px;${CARD}`)}>
            <div style={s(`${CARD_LABEL};margin-bottom:6px`)}>Notes</div>
            <div style={s('font-size:13px;line-height:1.6;color:var(--text2);white-space:pre-wrap')}>{deal.note}</div>
          </div>
        </div>
        <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px')}>
          {canCallPhone && (
            <button
              type="button"
              onClick={() => onCall?.(deal.phone)}
              style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:none;cursor:pointer;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:#fff;font-weight:700;font-size:12.5px')}
            >
              Call {deal.phone}
            </button>
          )}
          <button onClick={onClose} style={s('height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:12.5px;cursor:pointer')}>Close</button>
        </div>
      </div>
    </div>
  );
}
