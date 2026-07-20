/**
 * Standardized Automations picklists + loaders.
 * Deal rows: company title + App/Carrier badges + contact · phone.
 * Card rows: last-4 + status badge (active green / inactive orange / fraud red).
 * Micro loaders for dropdowns; macro loader for the “waiting for result” run phase.
 */
import type { ReactNode, RefObject } from 'react';
import { s, Badge } from './dc';
import { Icon } from './icons';
import { badge, type BadgeVM } from './salesData';
import { AutoEmptyState } from './AutoActionResult';
import { AutoFloatingDrop } from './AutoFloatingDrop';
import type { Card, Deal } from './autoLive';

const MONO = "font-family:'JetBrains Mono',monospace";
const INP =
  'width:100%;height:44px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px';
const LABEL =
  'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em';

/** Contact · phone only — App / Carrier render as badges. */
export function dealMetaLine(d: Deal): string {
  const parts: string[] = [];
  if (d.company && d.company !== d.name) parts.push(d.company);
  if (d.phone && d.phone !== '—') parts.push(d.phone);
  return parts.join(' · ');
}

export function dealAppBadge(d: Deal): BadgeVM | null {
  if (!d.app || d.app === '—') return null;
  return badge(`App ${d.app}`, 'var(--accent)');
}

export function dealCarrierBadge(d: Deal): BadgeVM | null {
  if (!d.carrier) return null;
  return badge(`CR-${d.carrier}`, 'var(--cyan)');
}

/** Card status → green / orange / red pills (zoho-octane cardStatusBadgeClass). */
export function cardStatusBadge(status: string): BadgeVM {
  const x = status.trim().toLowerCase();
  if (x === 'active' || x === 'a') return badge('ACTIVE', 'var(--ok)');
  if (x.includes('fraud') || x === 'f' || x.includes('hold')) return badge('FRAUD', 'var(--danger)');
  if (x === 'inactive' || x === 'i') return badge('INACTIVE', 'var(--warn)');
  if (x.includes('lost') || x.includes('stolen') || x.includes('terminat') || x.includes('cancel') || x.includes('deactiv')) {
    return badge(status.toUpperCase() || 'INACTIVE', 'var(--muted)');
  }
  return badge(status.toUpperCase() || 'UNKNOWN', 'var(--muted)');
}

/** Skeleton rows only — one loader, no spinner+skeleton double-up. */
export function PicklistMicroLoader({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="ss-pick-loader" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={s('padding:12px 15px;border-bottom:1px solid var(--border2)')}>
          <div className="ss-pick-skel" style={{ width: i % 2 === 0 ? '52%' : '44%' }} />
          <div className="ss-pick-skel ss-pick-skel--sm" style={{ width: i % 2 === 0 ? '78%' : '68%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

/** Centered run-phase loader (progress ring + bar + phase copy). */
export function AutoMacroLoader({ progress, phase }: { progress: number; phase: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={phase || 'Waiting for result'}
      style={s('padding:40px 20px;display:flex;flex-direction:column;align-items:center;text-align:center')}
    >
      <div style={s('position:relative;width:64px;height:64px;margin-bottom:24px')}>
        <div style={s('position:absolute;inset:0;border-radius:50%;border:3px solid var(--border);opacity:0.5')} />
        <div style={s('position:absolute;inset:0;border-radius:50%;border:3px solid transparent;border-top-color:var(--accent);animation:ss-spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite')} />
        <div style={s(`position:absolute;inset:0;display:flex;align-items:center;justify-content:center;${MONO};font-size:13px;font-weight:700;color:var(--accent)`)}>
          {progress}%
        </div>
      </div>
      <div style={s('font-family:Rajdhani,sans-serif;font-size:20px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;margin-bottom:6px')}>
        {phase || 'Working…'}
      </div>
      <div style={s('font-size:13px;color:var(--muted);max-width:280px;line-height:1.5')}>
        Keep this window open. Closing now loses task status.
      </div>
      <div style={s('width:100%;max-width:320px;height:6px;border-radius:99px;background:var(--raised);overflow:hidden;margin-top:24px')}>
        <div
          style={s(
            `height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));width:${progress}%;transition:width .2s ease-out`,
          )}
        />
      </div>
    </div>
  );
}

function DropMsg({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div
      style={s(
        `padding:16px 15px;font-size:13px;text-align:center;color:${danger ? 'var(--danger)' : 'var(--muted)'};font-weight:${danger ? 600 : 500}`,
      )}
    >
      {children}
    </div>
  );
}

function DropEmpty({ title, message }: { title: string; message?: string }) {
  return <AutoEmptyState title={title} message={message} icon="search" compact />;
}

function DealIdBadges({ deal }: { deal: Deal }) {
  const app = dealAppBadge(deal);
  const carrier = dealCarrierBadge(deal);
  if (!app && !carrier) return null;
  return (
    <div className="ss-deal-id-row">
      {app ? <Badge vm={app} /> : null}
      {carrier ? <Badge vm={carrier} /> : null}
    </div>
  );
}

export function DealPickOption({ deal, onSelect }: { deal: Deal; onSelect: (d: Deal) => void }) {
  const meta = dealMetaLine(deal);
  return (
    <div
      role="option"
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(deal);
      }}
      className="ss-pick-row"
    >
      <div style={s('font-size:13px;font-weight:700;color:var(--text);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
        {deal.name}
      </div>
      <DealIdBadges deal={deal} />
      {meta ? (
        <div style={s(`font-size:11px;color:var(--muted);margin-top:5px;${MONO};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
          {meta}
        </div>
      ) : null}
    </div>
  );
}

export function DealSelectedChip({
  deal,
  onClear,
}: {
  deal: Deal;
  onClear: () => void;
}) {
  const meta = dealMetaLine(deal);
  return (
    <div className="ss-deal-chip">
      <div className="ss-deal-chip-body">
        <div style={s('font-size:13.5px;font-weight:700;line-height:1.3')}>{deal.name}</div>
        <DealIdBadges deal={deal} />
        {meta ? (
          <div style={s(`font-size:12px;color:var(--muted);margin-top:5px;${MONO};line-height:1.35`)}>{meta}</div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear deal"
        className="ss-ico-btn ss-deal-chip-x"
      >
        <Icon name="close" size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}

/** Full Select Deal control used by every automation that needs a deal. */
export function AutoDealPicklist({
  deal,
  query,
  showDrop,
  inputRef,
  loading,
  error,
  deals,
  onQuery,
  onFocus,
  onCloseDrop,
  onSelect,
  onClear,
}: {
  deal: Deal | null;
  query: string;
  showDrop: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  loading: boolean;
  error: string | null;
  deals: Deal[];
  onQuery: (v: string) => void;
  onFocus: () => void;
  onCloseDrop: () => void;
  onSelect: (d: Deal) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div style={s(LABEL)}>Select Deal</div>
      {deal ? (
        <DealSelectedChip deal={deal} onClear={onClear} />
      ) : (
        <div>
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onFocus={onFocus}
            placeholder="Search by name, company, app ID, carrier or phone…"
            className="ss-in"
            style={s(INP)}
            aria-autocomplete="list"
            aria-expanded={showDrop}
          />
          <AutoFloatingDrop open={showDrop} anchorRef={inputRef} maxHeight={280} onClose={onCloseDrop}>
            {loading && <PicklistMicroLoader label="Loading deals" />}
            {!loading && error && <DropMsg danger>{error}</DropMsg>}
            {!loading && !error && deals.map((d) => (
              <DealPickOption key={d.id} deal={d} onSelect={onSelect} />
            ))}
            {!loading && !error && deals.length === 0 && query.length > 0 && (
              <DropEmpty title="No matching deals found" message="Try a different name, app ID, or phone." />
            )}
            {!loading && !error && deals.length === 0 && query.length === 0 && (
              <DropEmpty title="No deals available" message="No deals found for your account." />
            )}
          </AutoFloatingDrop>
        </div>
      )}
    </div>
  );
}

export function CardPickOption({
  card,
  onSelect,
}: {
  card: Card;
  onSelect: (c: Card) => void;
}) {
  return (
    <div
      role="option"
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(card);
      }}
      className="ss-pick-row"
      style={s('display:flex;align-items:center;gap:10px')}
    >
      <span style={s(`${MONO};font-size:13px;font-weight:600`)}>{`•••• ${card.number.slice(-4)}`}</span>
      <Badge vm={cardStatusBadge(card.status)} />
      <span style={s('font-size:11px;color:var(--muted);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
        {`${card.driver || 'No driver'} · Unit ${card.unit || '—'}`}
      </span>
    </div>
  );
}

/** Select Card control — same micro-loader / hover language as the deal picklist. */
export function AutoCardPicklist({
  card,
  query,
  showDrop,
  inputRef,
  loading,
  error,
  cards,
  displayNumber,
  statusBadge,
  onQuery,
  onFocus,
  onCloseDrop,
  onSelect,
  onClear,
}: {
  card: Card | null;
  query: string;
  showDrop: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  loading: boolean;
  error: string | null;
  cards: Card[];
  displayNumber: string;
  statusBadge: BadgeVM;
  onQuery: (v: string) => void;
  onFocus: () => void;
  onCloseDrop: () => void;
  onSelect: (c: Card) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div style={s(LABEL)}>Select Card</div>
      {card ? (
        <div className="ss-deal-chip ss-deal-chip--card">
          <div className="ss-deal-chip-body" style={s('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
            <span style={s(`${MONO};font-size:14px;font-weight:600;letter-spacing:.06em`)}>{displayNumber}</span>
            <Badge vm={statusBadge} />
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear card"
            className="ss-ico-btn ss-deal-chip-x"
          >
            <Icon name="close" size={12} strokeWidth={2.4} />
          </button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef as RefObject<HTMLInputElement>}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onFocus={onFocus}
            placeholder="Search card number…"
            className="ss-in"
            style={s(INP)}
          />
          <AutoFloatingDrop open={showDrop} anchorRef={inputRef} maxHeight={260} onClose={onCloseDrop}>
            {loading && <PicklistMicroLoader rows={3} label="Loading cards" />}
            {!loading && error && <DropMsg danger>{error}</DropMsg>}
            {!loading && !error && cards.map((c) => (
              <CardPickOption key={c.id} card={c} onSelect={onSelect} />
            ))}
            {!loading && !error && cards.length === 0 && (
              <DropEmpty title="No cards found" message="No cards found for this carrier." />
            )}
          </AutoFloatingDrop>
        </div>
      )}
    </div>
  );
}
