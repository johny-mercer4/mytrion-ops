/**
 * Sales Mytrion redesign — icon layer. Single source of truth for every glyph in the module.
 *
 * The redesign used to carry hand-authored SVG path-`d` strings (two `ICO` maps, `NAV`, and
 * dozens of inline `<svg>`). Those are replaced by ready-made `lucide-react` icons behind a
 * data-driven registry: data carries an `IconName` key, and `<Icon name=… />` renders the
 * matching lucide component. To change an icon, edit one line here — no path strings anywhere.
 *
 * `<Icon>` mirrors the old `dc.tsx` `Svg` API (size/strokeWidth/color/style) and keeps the
 * `.ss-icon` class + block/flex-shrink layout so alignment is unchanged. lucide draws on the
 * same 24×24 grid at strokeWidth 2, so visual weight matches the prior outline set. The `color`
 * prop maps to the SVG stroke, so the old `stroke="var(--warn)"` sites become `color="var(--warn)"`.
 */
import type { CSSProperties } from 'react';
import {
  ArrowUpDown,
  Ban,
  Banknote,
  Bell,
  Building2,
  Calendar,
  ChartColumn,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CirclePause,
  CirclePlus,
  ClipboardCheck,
  Clock,
  CloudUpload,
  Copy,
  CreditCard,
  Database,
  DollarSign,
  Download,
  File,
  FileText,
  FileX,
  Fuel,
  Funnel,
  Handshake,
  Hash,
  Headset,
  House,
  Inbox,
  Info,
  Kanban,
  KeyRound,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Link,
  List,
  LoaderCircle,
  Lock,
  MessageSquare,
  Moon,
  Package,
  PanelLeft,
  Paperclip,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Star,
  Sun,
  Ticket,
  TrendingUp,
  TriangleAlert,
  Truck,
  User,
  UserPlus,
  Users,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Semantic icon name → lucide component. Keys are the vocabulary the rest of the module uses;
 * several keys deliberately share a glyph (e.g. `assign`/`lead` both → `UserPlus`) so call sites
 * stay self-documenting.
 */
export const ICON_REGISTRY = {
  // sidebar navigation
  home: House,
  inbox: Inbox,
  tickets: Ticket,
  pool: Layers,
  records: Database,
  create: CirclePlus,
  dash: LayoutDashboard,
  grid: LayoutGrid,
  carriers: Truck,
  callHub: Headset,
  /* Re-engage / win-back — clearer than handshake for Retention desk */
  retention: RefreshCw,
  // shared KPI / activity glyphs (was salesData `ICO`)
  calls: Phone,
  notes: FileText,
  lead: UserPlus,
  star: Star,
  doc: FileText,
  check: CircleCheck,
  users: Users,
  warn: TriangleAlert,
  clock: Clock,
  money: CircleDollarSign,
  card: CreditCard,
  fuel: Fuel,
  trend: TrendingUp,
  bell: Bell,
  bolt: Zap,
  rocket: Rocket,
  // automation catalog glyphs (was autoLive `ICO`)
  clipboardCheck: ClipboardCheck,
  package: Package,
  invoice: ReceiptText,
  chart: ChartColumn,
  edit: SquarePen,
  refresh: RefreshCw,
  checkCircle: CircleCheck,
  ban: Ban,
  arrows: ArrowUpDown,
  cash: Banknote,
  lock: Lock,
  key: KeyRound,
  gear: Settings,
  link: Link,
  closeDoc: FileX,
  // Data Center sub-nav + view toggles
  clients: Building2,
  leads: UserPlus,
  deals: Handshake,
  rejections: Ban,
  moneyCodes: Hash,
  board: Kanban,
  list: List,
  // controls / inline chrome
  search: Search,
  spinner: LoaderCircle,
  panel: PanelLeft,
  close: X,
  plus: Plus,
  info: Info,
  alert: CircleAlert,
  user: User,
  file: File,
  download: Download,
  attach: Paperclip,
  send: Send,
  chat: MessageSquare,
  copy: Copy,
  filter: Funnel,
  assign: UserPlus,
  calendar: Calendar,
  dollar: DollarSign,
  pause: CirclePause,
  upload: CloudUpload,
  chevronLeft: ChevronLeft,
  chevronDown: ChevronDown,
  // ticket department glyphs
  cs: Headset,
  billing: ReceiptText,
  verification: ShieldCheck,
  maintenance: Wrench,
  // theme + annotation chrome
  sun: Sun,
  moon: Moon,
  sparkles: Sparkles,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICON_REGISTRY;

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Maps to the SVG stroke (lucide `color`). Defaults to `currentColor`. */
  color?: string;
  style?: CSSProperties;
  /** Extra class appended after `ss-icon` (e.g. for CSS-positioned glyphs like search inputs). */
  className?: string;
}

/**
 * Render a registry icon. Block-level + flex-shrink:0 (like the old `Svg`) so icons never sit
 * on the text baseline or get squeezed in flex rows.
 */
export function Icon({ name, size = 18, strokeWidth = 2, color = 'currentColor', style, className }: IconProps) {
  const Glyph = ICON_REGISTRY[name];
  return (
    <Glyph
      className={className ? `ss-icon ${className}` : 'ss-icon'}
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      style={{ display: 'block', flexShrink: 0, overflow: 'visible', ...style }}
      aria-hidden="true"
    />
  );
}
