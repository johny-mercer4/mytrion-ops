import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Ban,
  BarChart3,
  BookOpen,
  Briefcase,
  Building,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CloudUpload,
  Copy,
  Database,
  Eye,
  FileText,
  Handshake,
  Hash,
  Headset,
  Heart,
  History,
  Home,
  Landmark,
  Layers,
  LogOut,
  MessageCircleMore,
  Moon,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Square,
  Sun,
  TriangleAlert,
  User,
  Users,
  X,
  Rocket,
  Wallet,
  Activity,
  LineChart,
  LayoutGrid,
} from 'lucide-react';

/**
 * The CRM's named icon set — all Lucide, one consistent stroke weight and sizing scale.
 *
 * Named exports keep stable default sizes so icons stay proportionate beside their labels.
 * Everything is decorative (aria-hidden); visible text carries the meaning.
 *
 * `Sparkle` stays hand-drawn — brand mark only. Module picker glyphs use `MytrionGlyph`.
 */
type IconProps = { size?: number; className?: string; style?: CSSProperties };

/** Wraps a lucide icon with this set's default size, so callers keep calling `<XIcon />`. */
function icon(Glyph: LucideIcon, defaultSize: number, strokeWidth?: number) {
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
export const KnowledgeIcon = icon(BookOpen, 19);
export const ScopeIcon = icon(Hash, 19);
export const DatabaseIcon = icon(Database, 19);
export const WarehouseIcon = icon(Layers, 19);
export const AccessIcon = icon(ShieldCheck, 19);
export const UsersIcon = icon(Users, 19);
export const HistoryIcon = icon(History, 13);
export const ChatIcon = icon(MessageCircleMore, 16);

// ── actions + controls ──────────────────────────────────────────────────────
export const SearchIcon = icon(Search, 15);
export const SwitchIcon = icon(LayoutGrid, 13);
/** Impersonation / "View as" — distinct from SwitchIcon (module picker). */
export const ViewAsIcon = icon(Eye, 13);
export const PlusIcon = icon(Plus, 12);
export const ArrowRightIcon = icon(ArrowRight, 12, 2.2);
export const SendArrowIcon = icon(ArrowRight, 16, 2.2);
export const CheckIcon = icon(Check, 11, 2.5);
export const XIcon = icon(X, 10, 2.5);
export const LogOutIcon = icon(LogOut, 13, 2.2);
export const RefreshIcon = icon(RefreshCw, 12);
export const CopyIcon = icon(Copy, 11);
export const RevokeIcon = icon(ShieldOff, 11);
export const BanIcon = icon(Ban, 11);
export const ChevronLeftIcon = icon(ChevronLeft, 13);
export const ChevronRightIcon = icon(ChevronRight, 13);
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

// ── brand ───────────────────────────────────────────────────────────────────

/** The four-point fuel "spark" used in the brand mark and assistant gem (filled). */
export const Sparkle = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
    <path d="M12 1.6c.55 5.18 4.62 9.25 9.8 9.8-5.18.55-9.25 4.62-9.8 9.8-.55-5.18-4.62-9.25-9.8-9.8 5.18-.55 9.25-4.62 9.8-9.8z" />
  </svg>
);

/** Lucide glyphs for each Mytrion module — picker tiles and anywhere a department icon is needed. */
const MYTRION_GLYPHS: Record<string, LucideIcon> = {
  admin: Shield,
  sales: Rocket,
  billing: Wallet,
  collection: Receipt,
  finance: Landmark,
  'customer-service': Headset,
  retention: Heart,
  verification: BadgeCheck,
  manager: Users,
  analyst: LineChart,
  hr: Briefcase,
};

/** Per-Mytrion glyph for the wizard picker (Lucide, consistent with the rest of the shell). */
export const MytrionGlyph = ({ name, size = 22, className, style }: IconProps & { name: string }) => {
  const Glyph = MYTRION_GLYPHS[name] ?? Shield;
  return <Glyph size={size} className={className} style={style} strokeWidth={1.75} aria-hidden="true" />;
};
