/**
 * Line icons — the exact Lucide path geometry the design prototype ships (24-box, round caps).
 * currentColor throughout; size via props. Kept as a tiny local set instead of the lucide-react
 * package: the app uses eleven icons and Telegram Mini Apps are weight-sensitive.
 */
import type { ReactElement } from 'react';

export type IconName =
  | 'wallet'
  | 'shield'
  | 'list'
  | 'doc'
  | 'card'
  | 'clock'
  | 'pin'
  | 'check'
  | 'plane'
  | 'x'
  | 'userplus'
  | 'dollar'
  | 'key'
  | 'alert'
  | 'headset'
  | 'users'
  | 'lock'
  | 'refresh'
  | 'truck';

const PATHS: Record<IconName, string> = {
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4Z',
  shield:
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
  list: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1ZM14 8H8M16 12H8M13 16H8',
  doc: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8',
  card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM2 10h20',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 6v6l4 2',
  pin: 'M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  check: 'M20 6 9 17l-5-5',
  plane: 'm22 2-7 20-4-9-9-4ZM22 2 11 13',
  x: 'M18 6 6 18M6 6l12 12',
  userplus: 'M2 21a8 8 0 0 1 13.29-6M10 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 16v6M22 19h-6',
  dollar: 'M12 2v20M17 5.5H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6.5',
  key: 'M15.5 8.5h.01M21 3l-1.5 1.5M13.7 10.3a5 5 0 1 0-7.07 7.07 5 5 0 0 0 7.07-7.07ZM13.7 10.3 19.5 4.5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  headset:
    'M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H3ZM21 14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h1Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8 11V7a4 4 0 0 1 8 0v4',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5',
  truck: 'M1 8h13v8H1zM14 11h4l3 3v2h-7zM6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      {...(className ? { className } : {})}
    >
      <path
        d={PATHS[name]}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The small right-facing chevron (8x13 box) used on rows; rotates when a row expands. */
export function Chevron({ style }: { style?: React.CSSProperties }): ReactElement {
  return (
    <svg width="8" height="13" viewBox="0 0 8 13" style={{ flex: 'none', ...style }} aria-hidden>
      <path d="M1.5 1.5L6 6.5l-4.5 5" stroke="var(--muted-foreground)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Back chevron for "‹ Home" / "‹ Back" buttons. */
export function BackChevron(): ReactElement {
  return (
    <svg width="9" height="15" viewBox="0 0 9 15" fill="none" aria-hidden>
      <path d="M7.5 1.5L1.5 7.5l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Search magnifier (17px, matches the fleet search field). */
export function SearchGlyph(): ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flex: 'none', color: 'var(--muted-foreground)' }} aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Eye / eye-off toggle for the driver hero card's PAN reveal button. */
export function EyeToggle({ revealed, size = 14 }: { revealed: boolean; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {revealed ? (
        <>
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.6 18.6 0 0 1 4.22-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <path d="M1 1l22 22" />
        </>
      ) : (
        <>
          <path d="M1 12s3.5-8 11-8 11 8 11 8-3.5 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/** Bottom tab-bar glyph: home / services / inbox, each with a distinct active (filled) state. */
export function TabBarIcon({ kind, active, size = 22 }: { kind: 'home' | 'services' | 'inbox'; active: boolean; size?: number }): ReactElement {
  if (kind === 'home') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <path d={active ? 'M12 3a9 9 0 1 1-9 9h9z' : 'M12 3a9 9 0 1 0 9 9h-9z'} fill={active ? 'currentColor' : 'none'} stroke={active ? 'none' : 'currentColor'} strokeWidth={1.8} strokeLinejoin="round" />
        <path d="M14 3.5A9 9 0 0 1 20.5 10H14z" fill={active ? 'currentColor' : 'none'} stroke={active ? 'none' : 'currentColor'} strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === 'services') {
    const rects = [
      [4, 4],
      [13.5, 4],
      [4, 13.5],
      [13.5, 13.5],
    ] as const;
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        {rects.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width={6.5} height={6.5} rx={1.6} fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} />
        ))}
      </svg>
    );
  }
  const sw = active ? 2.2 : 1.8;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22 12h-5l-2 3h-6l-2-3H2" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
