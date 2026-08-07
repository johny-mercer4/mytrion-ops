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
  // The rest of the Horizon scale. Eight tokens for ~22 departments meant heavy collisions in the
  // auto-assignment below; these are already defined for both themes in styles/horizon.css.
  'tone-blue': { label: 'Blue', cssVar: 'var(--tone-blue)' },
  'tone-purple': { label: 'Purple', cssVar: 'var(--tone-purple)' },
  'tone-orange': { label: 'Orange', cssVar: 'var(--tone-orange)' },
  'tone-pink': { label: 'Pink', cssVar: 'var(--tone-pink)' },
  'tone-slate': { label: 'Slate', cssVar: 'var(--tone-slate)' },
};

export const DEPARTMENT_TONE_NAMES = Object.keys(DEPARTMENT_TONES);

/**
 * The tones auto-assignment may pick from.
 *
 * Slate is excluded deliberately: it is the neutral the org canvas gives its "No Department" bucket, so
 * a real department landing on it by hash would read as "these people are unassigned too".
 */
const AUTO_TONE_NAMES = DEPARTMENT_TONE_NAMES.filter((name) => name !== 'tone-slate');

/** Stable bucket from a seed string — same department, same colour, on every screen and every reload. */
function toneBucket(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 65_521;
  return h % AUTO_TONE_NAMES.length;
}

/** Resolve a stored icon name to a component. Unknown / null → the default glyph. */
export function departmentIcon(name: string | null | undefined): LucideIcon {
  const hit = name ? DEPARTMENT_ICONS[name] : undefined;
  return hit ?? DEPARTMENT_ICONS[DEFAULT_DEPARTMENT_ICON]!;
}

/**
 * Resolve a stored tone token to a CSS value.
 *
 * WHY THE SEED. `icon_color` is null for every department nobody has hand-coloured, which is nearly all
 * of them — the Zoho migration never set it. Falling straight back to `--accent` therefore painted all
 * ~22 departments the same HR red, on the cards and across the whole org canvas, which is precisely the
 * information a colour is supposed to carry. Passing a stable seed (the department ID, so a rename does
 * not reshuffle the chart) picks a deterministic tone instead: distinct at a glance, identical on every
 * surface, and still overridden the moment someone picks a colour in the modal.
 *
 * With no seed and no stored token it is still the module accent — that is the right answer for
 * "a department, in the abstract".
 */
export function departmentTone(name: string | null | undefined, seed?: string | null): string {
  const hit = name ? DEPARTMENT_TONES[name] : undefined;
  if (hit) return hit.cssVar;
  if (seed) {
    const token = AUTO_TONE_NAMES[toneBucket(seed)];
    if (token) return DEPARTMENT_TONES[token]!.cssVar;
  }
  return 'var(--accent)';
}
