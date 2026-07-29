/**
 * How a department LOOKS: its glyph and its tone.
 *
 * Both stored values are resolved through the static maps below and NEVER interpolated raw. That is
 * what makes them safe: `icon` is looked up for an imported component (unknown → `Building2`), and
 * `iconColor` is looked up for a `var(--tone-*)` string (unknown → the module accent). A value that
 * somehow got past the backend's shape check still cannot become markup or a style rule, because it is
 * only ever used as a Map key.
 *
 * The picker offers a CURATED set rather than all ~1,600 lucide icons. A department needs a glyph that
 * reads at 18px and says something about the team — an exhaustive searchable list would be slower to
 * choose from and would ship every icon in the library into the bundle.
 */
import {
  Banknote,
  Bot,
  Briefcase,
  Building2,
  Calculator,
  ChartLine,
  CircleDollarSign,
  Cog,
  Compass,
  Fuel,
  Gavel,
  Handshake,
  Headset,
  Landmark,
  LifeBuoy,
  Megaphone,
  Package,
  PenTool,
  Phone,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** Curated glyphs, keyed by the exact lucide component name that gets stored in `hr_departments.icon`. */
export const DEPARTMENT_ICONS: Record<string, LucideIcon> = {
  Building2,
  Users,
  Briefcase,
  Handshake,
  Megaphone,
  Phone,
  Headset,
  LifeBuoy,
  Truck,
  Fuel,
  Package,
  Banknote,
  CircleDollarSign,
  Calculator,
  Landmark,
  ChartLine,
  Scale,
  Gavel,
  ShieldCheck,
  Server,
  Cog,
  Wrench,
  PenTool,
  Compass,
  Bot,
  Sparkles,
};

export const DEPARTMENT_ICON_NAMES = Object.keys(DEPARTMENT_ICONS);

/**
 * Human labels for the picker's tooltips and accessible names.
 *
 * The stored value has to be the lucide component name, but "Building2" is meaningless as an accessible
 * name — a screen-reader user hearing it learns nothing about the choice. Keyed by component name so a
 * missing entry falls back to it rather than breaking.
 */
export const DEPARTMENT_ICON_LABELS: Record<string, string> = {
  Building2: 'Building',
  Users: 'People',
  Briefcase: 'Business',
  Handshake: 'Partnerships',
  Megaphone: 'Marketing',
  Phone: 'Calls',
  Headset: 'Support',
  LifeBuoy: 'Customer care',
  Truck: 'Fleet',
  Fuel: 'Fuel',
  Package: 'Logistics',
  Banknote: 'Payments',
  CircleDollarSign: 'Finance',
  Calculator: 'Accounting',
  Landmark: 'Banking',
  ChartLine: 'Analytics',
  Scale: 'Compliance',
  Gavel: 'Legal',
  ShieldCheck: 'Risk',
  Server: 'Infrastructure',
  Cog: 'Operations',
  Wrench: 'Maintenance',
  PenTool: 'Design',
  Compass: 'Strategy',
  Bot: 'Automation',
  Sparkles: 'Innovation',
};

/** The default glyph — what an unset or unrecognised `icon` renders as. */
export const DEFAULT_DEPARTMENT_ICON = 'Building2';

/**
 * Tones, keyed by the token name stored in `hr_departments.icon_color`.
 *
 * These are the same `--tone-*` tokens the HR sidebar already uses per tab (see `hrNav.ts`), so a
 * department's colour is drawn from one palette rather than invented per department — which is why the
 * column stores a token name and not a hex value.
 */
export const DEPARTMENT_TONES: Record<string, { label: string; cssVar: string }> = {
  'tone-rose': { label: 'Rose', cssVar: 'var(--tone-rose)' },
  'tone-sky': { label: 'Sky', cssVar: 'var(--tone-sky)' },
  'tone-indigo': { label: 'Indigo', cssVar: 'var(--tone-indigo)' },
  'tone-teal': { label: 'Teal', cssVar: 'var(--tone-teal)' },
  'tone-emerald': { label: 'Emerald', cssVar: 'var(--tone-emerald)' },
  'tone-amber': { label: 'Amber', cssVar: 'var(--tone-amber)' },
  'tone-violet': { label: 'Violet', cssVar: 'var(--tone-violet)' },
  'tone-cyan': { label: 'Cyan', cssVar: 'var(--tone-cyan)' },
};

export const DEPARTMENT_TONE_NAMES = Object.keys(DEPARTMENT_TONES);

/** Resolve a stored icon name to a component. Unknown / null → the default glyph. */
export function departmentIcon(name: string | null | undefined): LucideIcon {
  const hit = name ? DEPARTMENT_ICONS[name] : undefined;
  return hit ?? DEPARTMENT_ICONS[DEFAULT_DEPARTMENT_ICON]!;
}

/**
 * Resolve a stored tone token to a CSS value. Unknown / null → the HR module accent, so an
 * un-themed department still looks deliberate rather than colourless.
 */
export function departmentTone(name: string | null | undefined): string {
  const hit = name ? DEPARTMENT_TONES[name] : undefined;
  return hit?.cssVar ?? 'var(--accent)';
}
