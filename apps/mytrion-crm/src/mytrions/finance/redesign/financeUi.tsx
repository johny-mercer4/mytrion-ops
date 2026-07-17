/** Shared UI fragments — verbatim from Finance Mytrion.dc.html */
import type { ReactNode } from 'react';

import { Badge, s, Svg } from './dc';
import { chipStyle } from './financeData';

export const ICONS = {
  dollar: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  card: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  users: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  alert: 'M12 9v4m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z',
  check: 'M5 13l4 4L19 7',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  refresh: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  chev: 'M9 18l6-6-6-6',
  close: 'M18 6L6 18M6 6l12 12',
  fuel: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h6M14 2v6m0-6l6 6m-6 0h6m0 0v10a2 2 0 01-2 2h-2M9 13h1m4 4h.01',
  fuelKpi: 'M3 22h12M4 9h8M14 22V4a2 2 0 00-2-2H6a2 2 0 00-2 2v18M14 13h2a2 2 0 012 2v2a2 2 0 002 2 2 2 0 002-2V9.83a2 2 0 00-.59-1.42L18 5',
  flame: 'M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z',
  spark: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
  home: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  dash: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  load: 'M19 9l-7 7-7-7',
  ban: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
  bolt: 'M13 10V3L4 14h7v7l9-11h-7z',
  tag: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
  doc: 'M9 12h6m-3-3v6m-9 0h.01M4 6h16M4 10h16M4 14h16M4 18h16',
  trend: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
};

export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.02em;text-transform:uppercase')}>{title}</div>
      <div style={s('font-size:12px;color:var(--muted);margin-top:3px')}>{sub}</div>
    </div>
  );
}

export function RefreshBtn({ onClick, spin, label = 'Refresh' }: { onClick: () => void; spin?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mf-ico"
      style={s('height:34px;padding:0 13px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:11.5px;font-weight:700;display:flex;align-items:center;gap:7px')}
    >
      <Svg d={ICONS.refresh} size={13} {...(spin ? { style: { animation: 'mf-spin .8s linear infinite' } } : {})} />
      {label}
    </button>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  maxWidth = 360,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxWidth?: number;
}) {
  return (
    <div style={s(`display:flex;align-items:center;gap:8px;flex:1;min-width:220px;max-width:${maxWidth}px;height:38px;padding:0 12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)`)}>
      <Svg d={ICONS.search} size={14} stroke="var(--muted)" />
      <input
        className="mf-in"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={s('flex:1;min-width:0;border:none;background:transparent;color:var(--text);font-size:13px;outline:none;padding:0')}
      />
    </div>
  );
}

export function ClearFiltersBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mf-chip"
      style={s('display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:11.5px;font-weight:600;cursor:pointer')}
    >
      <Svg d={ICONS.close} size={11} strokeWidth={2.4} />
      Clear
    </button>
  );
}

export function HorizontalKpi({
  icon,
  iconStyle,
  value,
  label,
  color = 'var(--text)',
}: {
  icon: string;
  iconStyle: string;
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <div className="mf-card" style={s('padding:15px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;gap:12px')}>
      <div style={s(iconStyle)}>
        <Svg d={icon} size={17} />
      </div>
      <div style={s('min-width:0')}>
        <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px;color:${color}`)}>{value}</div>
        <div style={s('font-size:10.5px;color:var(--muted);margin-top:1px')}>{label}</div>
      </div>
    </div>
  );
}

export function LoadMore({ onClick, meta }: { onClick: () => void; meta: string }) {
  return (
    <div style={s('padding:14px;display:flex;flex-direction:column;align-items:center;gap:7px')}>
      <button
        type="button"
        onClick={onClick}
        className="mf-chip"
        style={s('height:34px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px')}
      >
        <Svg d={ICONS.load} size={12} strokeWidth={2.2} />
        Load more
      </button>
      <div style={s('font-size:10.5px;color:var(--muted)')}>{meta}</div>
    </div>
  );
}

export function EmptyState({ msg, onClear }: { msg: string; onClear?: () => void }) {
  return (
    <div style={s('padding:54px 20px;text-align:center;color:var(--muted)')}>
      <Svg d={ICONS.search} size={42} strokeWidth={1.4} style={{ opacity: 0.5, marginBottom: 12, display: 'inline-block' }} />
      <div style={s('font-size:13px')}>{msg}</div>
      {onClear ? (
        <button type="button" onClick={onClear} className="mf-chip" style={s('margin-top:12px;height:32px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:11.5px;font-weight:600;cursor:pointer')}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

export function ChipRow({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={s('display:flex;align-items:center;gap:7px;flex-wrap:wrap')}>
      <span style={s('font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-right:2px')}>{label}</span>
      {options.map((o) => (
        <button key={o.id} type="button" className="mf-chip" data-active={active === o.id ? 'true' : 'false'} onClick={() => onSelect(o.id)} style={s(chipStyle(active === o.id))}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div style={s('border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);overflow:hidden;box-shadow:var(--shadow-sm)')}>{children}</div>
  );
}

export function SkelRows({ n = 5, h = 58 }: { n?: number; h?: number }) {
  return (
    <div style={s('padding:11px')}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="mf-skel" style={s(`height:${h}px;margin-bottom:${i < n - 1 ? 9 : 0}px`)} />
      ))}
    </div>
  );
}

export function SkelBlock({ heights, pad = 8 }: { heights: number[]; pad?: number }) {
  return (
    <div style={s(`padding:${pad}px`)}>
      {heights.map((h, i) => (
        <div key={i} className="mf-skel" style={s(`height:${h}px;margin-bottom:${i < heights.length - 1 ? 8 : 0}px`)} />
      ))}
    </div>
  );
}

export function KvGroup({ title, rows }: { title: string; rows: { k: string; v: string; mono?: string }[] }) {
  return (
    <div>
      <div style={s('font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:10px')}>{title}</div>
      <div style={s('display:flex;flex-direction:column;gap:1px;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border)')}>
        {rows.map((r) => (
          <div key={r.k} style={s('display:flex;justify-content:space-between;gap:12px;padding:10px 13px;background:var(--alt)')}>
            <span style={s('font-size:11.5px;color:var(--muted)')}>{r.k}</span>
            <span style={s(`font-size:12px;font-weight:600;color:var(--text);text-align:right;${r.mono ?? ''}`)}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RowChev() {
  return <Svg d={ICONS.chev} size={15} stroke="var(--muted)" strokeWidth={2.2} style={{ flexShrink: 0 }} className="mf-chev" />;
}

export function BadgeRow({ badges }: { badges: { text: string; style: string }[] }) {
  return (
    <>
      {badges.map((b, i) => (
        <Badge key={i} vm={b} />
      ))}
    </>
  );
}
