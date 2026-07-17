import type { CSSProperties } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Building,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Copy,
  Database,
  FileText,
  Hash,
  History,
  Home,
  Layers,
  MessageCircleMore,
  Moon,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Square,
  Sun,
  TriangleAlert,
  User,
  Users,
  X,
} from 'lucide-react';

/**
 * The CRM's named icon set, rendered by lucide.
 *
 * These were hand-drawn SVGs that traced lucide's own paths — the same library the module pages
 * already import from directly. They now delegate, so the app draws from one icon set instead of a
 * near-duplicate of it. The named exports and their per-icon default sizes are kept as-is: every
 * call site depends on them, and the size defaults are what keep an icon proportionate to the text
 * beside it.
 *
 * Everything here is decorative — each icon sits next to its own visible label — so all of it is
 * aria-hidden, as the hand-rolled set was.
 *
 * `Sparkle` and `MytrionGlyph` stay hand-drawn below: they're brand, not UI furniture.
 */
type IconProps = { size?: number; className?: string; style?: CSSProperties };

/** Wraps a lucide icon with this set's default size, so callers keep calling `<XIcon />`. */
function icon(Glyph: typeof Home, defaultSize: number, strokeWidth?: number) {
  return function Icon({ size = defaultSize, className, style }: IconProps) {
    return (
      <Glyph
        size={size}
        className={className}
        style={style}
        aria-hidden="true"
        {...(strokeWidth === undefined ? {} : { strokeWidth })}
      />
    );
  };
}

// ── navigation ──────────────────────────────────────────────────────────────
export const HomeIcon = icon(Home, 19);
export const TrainIcon = icon(CloudUpload, 19);
export const KnowledgeIcon = icon(Database, 19);
export const ScopeIcon = icon(Hash, 19);
export const DatabaseIcon = icon(Database, 19);
export const WarehouseIcon = icon(Layers, 19);
export const AccessIcon = icon(ShieldCheck, 19);
export const UsersIcon = icon(Users, 19);
export const HistoryIcon = icon(History, 13);
export const ChatIcon = icon(MessageCircleMore, 16);

// ── actions + controls ──────────────────────────────────────────────────────
export const SearchIcon = icon(Search, 15);
export const SwitchIcon = icon(ArrowLeftRight, 13);
export const PlusIcon = icon(Plus, 12);
// The heavier strokes are carried over from the hand-drawn set: these render small enough that
// lucide's default 2 reads thin against the label they sit beside.
export const ArrowRightIcon = icon(ArrowRight, 12, 2.2);
export const SendArrowIcon = icon(ArrowRight, 16, 2.2);
export const CheckIcon = icon(Check, 11, 2.5);
export const XIcon = icon(X, 10, 2.5);
export const RefreshIcon = icon(RefreshCw, 12);
export const CopyIcon = icon(Copy, 11);
/** Revoke — access taken away, distinct from Ban's "this link is dead". */
export const RevokeIcon = icon(ShieldOff, 11);
/** Cancel an invite — the link stops working. */
export const BanIcon = icon(Ban, 11);
export const ChevronLeftIcon = icon(ChevronLeft, 13);
export const ChevronRightIcon = icon(ChevronRight, 13);
/** Warning — pairs with the warn tint so urgency isn't carried by colour alone. */
export const AlertIcon = icon(TriangleAlert, 11);

// ── content ─────────────────────────────────────────────────────────────────
export const DocIcon = icon(FileText, 14);
export const BuildingIcon = icon(Building, 14);
export const PersonIcon = icon(User, 14);

// ── theme ───────────────────────────────────────────────────────────────────
export const MoonIcon = icon(Moon, 15);
export const SunIcon = icon(Sun, 15);

/** Filled square — Stop generation. Lucide draws outlines, so this one fills its own shape. */
export const StopIcon = ({ size = 12, className, style }: IconProps) => (
  <Square size={size} className={className} style={style} fill="currentColor" strokeWidth={2} aria-hidden="true" />
);

// ── brand (deliberately not lucide) ─────────────────────────────────────────

function brandGlyph(size: number, path: string, sw: number, className?: string, style?: CSSProperties) {
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
  return brandGlyph(size, paths[name] ?? paths.admin!, 1.8, className, style);
};
