/**
 * Thin wrappers around lucide-react so call sites keep using `<Icon name="..."/>` /
 * `<TabBarIcon kind="..."/>` — swap the underlying import here, not at every call site.
 */
import {
  ArrowUpDown,
  Banknote,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  DollarSign,
  Eye,
  EyeOff,
  FileText,
  Headset,
  KeyRound,
  LayoutGrid,
  Lock,
  MapPin,
  Maximize2,
  RefreshCw,
  Search,
  Send,
  Shield,
  List as ListIcon,
  TriangleAlert,
  Truck,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
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
  | 'banknote'
  | 'key'
  | 'alert'
  | 'headset'
  | 'users'
  | 'lock'
  | 'refresh'
  | 'truck'
  | 'sort'
  | 'checkcheck'
  | 'maximize'
  | 'copy';

const ICONS: Record<IconName, LucideIcon> = {
  wallet: Wallet,
  shield: Shield,
  list: ListIcon,
  doc: FileText,
  card: CreditCard,
  clock: Clock,
  pin: MapPin,
  check: Check,
  plane: Send,
  x: X,
  userplus: UserPlus,
  dollar: DollarSign,
  banknote: Banknote,
  key: KeyRound,
  alert: TriangleAlert,
  headset: Headset,
  users: Users,
  lock: Lock,
  refresh: RefreshCw,
  truck: Truck,
  sort: ArrowUpDown,
  checkcheck: CheckCheck,
  maximize: Maximize2,
  copy: Copy,
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
  const LucideCmp = ICONS[name];
  return <LucideCmp size={size} strokeWidth={strokeWidth} aria-hidden {...(className ? { className } : {})} />;
}

/** The small right-facing chevron used on rows; rotates when a row expands. */
export function Chevron({ style }: { style?: React.CSSProperties }): ReactElement {
  return <ChevronRight size={16} strokeWidth={1.8} color="var(--muted-foreground)" aria-hidden style={{ flex: 'none', ...style }} />;
}

/** Back chevron for "‹ Home" / "‹ Back" buttons. */
export function BackChevron(): ReactElement {
  return <ChevronLeft size={16} strokeWidth={2} aria-hidden />;
}

/** Search magnifier (matches the fleet search field). */
export function SearchGlyph(): ReactElement {
  return <Search size={17} strokeWidth={2} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />;
}

/** Eye / eye-off toggle for the driver hero card's PAN reveal button. */
export function EyeToggle({ revealed, size = 14 }: { revealed: boolean; size?: number }): ReactElement {
  const LucideCmp = revealed ? EyeOff : Eye;
  return <LucideCmp size={size} strokeWidth={2} aria-hidden />;
}

/** Bottom tab-bar glyph: home / services / inbox, each with a distinct active (filled) state. */
export function TabBarIcon({ kind, active, size = 22 }: { kind: 'home' | 'services' | 'inbox'; active: boolean; size?: number }): ReactElement {
  const strokeWidth = active ? 2.2 : 1.8;

  if (kind === 'services') {
    // LayoutGrid's 4 squares have real gaps between them — a solid currentColor fill reads fine.
    return <LayoutGrid size={size} strokeWidth={strokeWidth} fill={active ? 'currentColor' : 'none'} aria-hidden />;
  }

  // House and Inbox are each an outer shape PLUS an inner detail line (door / tray-slot) meant to
  // be a stroke, not a fill — Lucide's own component fills both the same solid color when active,
  // which erases that inner line (identical color as the fill sitting behind it). Redraw the
  // detail line in the tab bar's own background color instead, so it still reads once filled.
  if (kind === 'home') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
          fill={active ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
          stroke={active ? 'var(--card)' : 'currentColor'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="22 12 16 12 14 15 10 15 8 12 2 12"
        fill="none"
        stroke={active ? 'var(--card)' : 'currentColor'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
