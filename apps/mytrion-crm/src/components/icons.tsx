import type { CSSProperties } from 'react';

/**
 * Icon set ported from the Mytrion design system. All are 24×24 stroke icons (currentColor) unless
 * noted. `size` sets width/height; pass className/style for color via the surrounding token.
 */
type IconProps = { size?: number; className?: string; style?: CSSProperties };

function stroke(size: number, path: string, sw = 2, className?: string, style?: CSSProperties) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export const HomeIcon = ({ size = 19, className, style }: IconProps) =>
  stroke(size, 'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-6h6v6h3a1 1 0 001-1V10', 2, className, style);

export const TrainIcon = ({ size = 19, className, style }: IconProps) =>
  stroke(size, 'M7 16a4 4 0 01-.88-7.9A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12', 2, className, style);

export const KnowledgeIcon = ({ size = 19, className, style }: IconProps) =>
  stroke(size, 'M4 7v10c0 2.2 3.6 4 8 4s8-1.8 8-4V7M4 7c0 2.2 3.6 4 8 4s8-1.8 8-4M4 7c0-2.2 3.6-4 8-4s8 1.8 8 4', 2, className, style);

export const ScopeIcon = ({ size = 19, className, style }: IconProps) =>
  stroke(size, 'M9 3v18m6-18v18M3 9h18M3 15h18', 2, className, style);

export const SearchIcon = ({ size = 15, className, style }: IconProps) =>
  stroke(size, 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z', 2, className, style);

export const SwitchIcon = ({ size = 13, className, style }: IconProps) =>
  stroke(size, 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4', 2, className, style);

export const PlusIcon = ({ size = 12, className, style }: IconProps) =>
  stroke(size, 'M12 4v16m8-8H4', 2, className, style);

export const ArrowRightIcon = ({ size = 12, className, style }: IconProps) =>
  stroke(size, 'M14 5l7 7m0 0l-7 7m7-7H3', 2.2, className, style);

export const SendArrowIcon = ({ size = 16, className, style }: IconProps) =>
  stroke(size, 'M5 12h14m0 0l-6-6m6 6l-6 6', 2.2, className, style);

export const CheckIcon = ({ size = 11, className, style }: IconProps) =>
  stroke(size, 'M5 13l4 4L19 7', 2.5, className, style);

export const XIcon = ({ size = 10, className, style }: IconProps) =>
  stroke(size, 'M6 18L18 6M6 6l12 12', 2.5, className, style);

export const DocIcon = ({ size = 14, className, style }: IconProps) =>
  stroke(size, 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6a1 1 0 01.7.3l5.4 5.4a1 1 0 01.3.7V19a2 2 0 01-2 2z', 2, className, style);

export const MoonIcon = ({ size = 15, className, style }: IconProps) =>
  stroke(size, 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z', 2, className, style);

export const SunIcon = ({ size = 15, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4" />
  </svg>
);

export const ChatIcon = ({ size = 16, className, style }: IconProps) =>
  stroke(size, 'M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 01-11.3 7.3L3 21l1.7-6.7A8 8 0 1121 12z', 2, className, style);

/** Filled square — Stop generation. */
export const StopIcon = ({ size = 12, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const HistoryIcon = ({ size = 13, className, style }: IconProps) =>
  stroke(size, 'M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8m0-5v5h5m4-1v5l4 2', 2, className, style);

export const UsersIcon = ({ size = 19, className, style }: IconProps) =>
  stroke(size, 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.34M5 11a3 3 0 102.5-1.34', 2, className, style);

export const BuildingIcon = ({ size = 14, className, style }: IconProps) =>
  stroke(size, 'M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h.01M9 11h.01M9 15h.01M15 7h.01M15 11h.01M15 15h.01', 2, className, style);

export const PersonIcon = ({ size = 14, className, style }: IconProps) =>
  stroke(size, 'M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z', 2, className, style);

/** The four-point fuel "spark" used in the brand mark and assistant gem (filled). */
export const Sparkle = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
    <path d="M12 1.6c.55 5.18 4.62 9.25 9.8 9.8-5.18.55-9.25 4.62-9.8 9.8-.55-5.18-4.62-9.25-9.8-9.8 5.18-.55 9.25-4.62 9.8-9.8z" />
  </svg>
);

/** Per-Mytrion glyphs (shield/chart/receipt/etc.) keyed for the picker + nav. */
export const MytrionGlyph = ({ name, size = 22, className, style }: IconProps & { name: string }) => {
  const paths: Record<string, string> = {
    admin: 'M12 3l8 4v5c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V7l8-4z',
    sales: 'M3 17l6-6 4 4 8-8m0 0h-5m5 0v5',
    billing: 'M9 14l6-6m-6 0h.01M15 14h.01M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16l-3-2-2 2-2-2-2 2-2-2-3 2z',
    collection:
      'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    finance: 'M3 21h12M3 21V5a2 2 0 012-2h6a2 2 0 012 2v16M13 8h3l3 3v8a2 2 0 01-2 2M16 11h3M7 7h2M7 11h2',
    'customer-service': 'M18 10a6 6 0 00-12 0c0 4-1.5 5-2 6h16c-.5-1-2-2-2-6zM10 20a2 2 0 004 0',
    retention: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
    verification: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    manager: 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.5-1.34M5 11a3 3 0 102.5-1.34',
    analyst: 'M4 4v16h16M9 16v-4M14 16V8M19 16v-6',
  };
  return stroke(size, paths[name] ?? paths.admin!, 1.8, className, style);
};
