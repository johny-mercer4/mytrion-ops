import type { MouseEvent, ReactNode } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import type { DealVM, LeadVM, RejectionVM } from './dataCenterLive';
import { dealStageColor, leadStatusColor } from './dataCenterLive';

const ROW =
  'width:100%;display:flex;align-items:center;gap:12px;min-height:56px;padding:12px 14px;border:none;border-bottom:1px solid var(--border2);background:var(--surface);color:var(--text);text-align:left;font-family:inherit;cursor:pointer';

function Chevron() {
  return (
    <span style={s('flex-shrink:0;color:var(--muted);display:flex')} aria-hidden>
      <Icon name="chevronRight" size={16} />
    </span>
  );
}

function PhoneRow({
  title,
  meta,
  onClick,
  leading,
}: {
  title: string;
  meta: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  leading?: ReactNode;
}) {
  return (
    <button type="button" className="ss-row-h" onClick={onClick} style={s(ROW)}>
      {leading}
      <span style={s('flex:1;min-width:0')}>
        <span
          style={s(
            'display:block;font-size:16px;font-weight:650;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
          )}
        >
          {title}
        </span>
        <span
          style={s(
            'display:block;margin-top:3px;font-size:13px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
          )}
        >
          {meta}
        </span>
      </span>
      <Chevron />
    </button>
  );
}

export function PhoneLeadsList({
  rows,
  onOpen,
}: {
  rows: LeadVM[];
  onOpen: (lead: LeadVM) => void;
}) {
  return (
    <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
      {rows.map((ld) => (
        <PhoneRow
          key={ld.id}
          title={ld.contact}
          meta={[ld.company, ld.converted ? 'Converted' : ld.status, ld.created].filter(Boolean).join(' · ')}
          onClick={() => onOpen(ld)}
          leading={
            <span
              style={s(
                `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${leadStatusColor(ld.status)}`,
              )}
            />
          }
        />
      ))}
    </div>
  );
}

export function PhoneDealsList({
  rows,
  onOpen,
}: {
  rows: DealVM[];
  onOpen: (deal: DealVM) => void;
}) {
  return (
    <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
      {rows.map((dl) => (
        <PhoneRow
          key={dl.id}
          title={dl.name}
          meta={[dl.stage, dl.carrierId ? `#${dl.carrierId}` : '', dl.created].filter(Boolean).join(' · ')}
          onClick={() => onOpen(dl)}
          leading={
            <span
              style={s(
                `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${dealStageColor(dl.stage)}`,
              )}
            />
          }
        />
      ))}
    </div>
  );
}

export function PhoneRejectionsList({
  rows,
  onOpen,
}: {
  rows: RejectionVM[];
  onOpen: (row: RejectionVM) => void;
}) {
  return (
    <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);overflow:hidden;background:var(--surface)')}>
      {rows.map((r) => (
        <PhoneRow
          key={r.id}
          title={r.company}
          meta={[r.errorText || 'Declined', r.driverName, r.date].filter(Boolean).join(' · ')}
          onClick={() => onOpen(r)}
        />
      ))}
    </div>
  );
}
