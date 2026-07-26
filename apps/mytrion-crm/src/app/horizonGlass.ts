/**
 * Per-workspace glass accents — verbatim from HorizonNew `src/app/App.tsx` workspaces[].
 *
 * Tailwind classes in the source are expanded to their literal CSS here:
 *   dark  gradient = `from-<hue>-700/22 via-<via>-700/8 to-transparent`
 *   light gradient = `from-<hue>-200/50 via-<via>-100/30 to-transparent`
 * The light `cardBg*`/`border*` values are the hue-tinted ones from the reference — a card at rest
 * is a *tinted* frosted pane, not neutral white. That's what makes light read as glass.
 *
 * DELIBERATE DIVERGENCE from the reference, in light mode only: `iconHoverLight` BRIGHTENS to the
 * hue's 600 rather than darkening to its 950. The reference darkens toward near-black on hover,
 * which (a) makes the chip feel heavier as you approach it, the opposite of the dark theme, and
 * (b) turned the icon's `drop-shadow(0 0 4px currentColor)` glow into a black smudge, since the
 * glow takes its colour from the ink. Dark mode is untouched.
 */
export interface HorizonGlassTheme {
  glow: string;
  icon: string;
  iconHover: string;
  iconBg: string;
  iconBgHover: string;
  /** Dark: from-*-700/22 via-*-700/8 */
  gradient: string;
  /** Light: from-*-200/50 via-*-100/30 */
  gradientLight: string;
  badgeClass: string;
  cardBgLight: string;
  cardBgHoverLight: string;
  borderLight: string;
  borderHoverLight: string;
  glowLight: string;
  iconLight: string;
  iconHoverLight: string;
  badgeLight: string;
}

const sky: HorizonGlassTheme = {
  glow: 'rgba(14,165,233,0.38)',
  icon: '#38bdf8',
  iconHover: '#e0f2fe',
  iconBg: 'rgba(14,165,233,0.12)',
  iconBgHover: 'rgba(14,165,233,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(3,105,161,0.22), rgba(29,78,216,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(186,230,253,0.5), rgba(219,234,254,0.3), transparent)',
  badgeClass: 'hzBadgeSky',
  cardBgLight: 'rgba(240,249,255,0.82)',
  cardBgHoverLight: 'rgba(219,242,255,0.96)',
  borderLight: 'rgba(125,211,252,0.22)',
  borderHoverLight: 'rgba(14,165,233,0.55)',
  glowLight: 'rgba(14,165,233,0.25)',
  iconLight: '#0369a1',
  iconHoverLight: '#0284c7',
  badgeLight: 'hzBadgeSkyLight',
};

const violet: HorizonGlassTheme = {
  glow: 'rgba(139,92,246,0.38)',
  icon: '#a78bfa',
  iconHover: '#ede9fe',
  iconBg: 'rgba(139,92,246,0.12)',
  iconBgHover: 'rgba(139,92,246,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(109,40,217,0.22), rgba(126,34,206,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(221,214,254,0.5), rgba(243,232,255,0.3), transparent)',
  badgeClass: 'hzBadgeViolet',
  cardBgLight: 'rgba(245,243,255,0.82)',
  cardBgHoverLight: 'rgba(233,228,255,0.96)',
  borderLight: 'rgba(167,139,250,0.22)',
  borderHoverLight: 'rgba(139,92,246,0.55)',
  glowLight: 'rgba(139,92,246,0.25)',
  iconLight: '#6d28d9',
  iconHoverLight: '#7c3aed',
  badgeLight: 'hzBadgeVioletLight',
};

const emerald: HorizonGlassTheme = {
  glow: 'rgba(16,185,129,0.38)',
  icon: '#34d399',
  iconHover: '#d1fae5',
  iconBg: 'rgba(16,185,129,0.12)',
  iconBgHover: 'rgba(16,185,129,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(4,120,87,0.22), rgba(15,118,110,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(167,243,208,0.5), rgba(204,251,241,0.3), transparent)',
  badgeClass: 'hzBadgeEmerald',
  cardBgLight: 'rgba(236,253,245,0.82)',
  cardBgHoverLight: 'rgba(209,250,229,0.96)',
  borderLight: 'rgba(110,231,183,0.22)',
  borderHoverLight: 'rgba(16,185,129,0.55)',
  glowLight: 'rgba(16,185,129,0.25)',
  iconLight: '#065f46',
  iconHoverLight: '#059669',
  badgeLight: 'hzBadgeEmeraldLight',
};

const amber: HorizonGlassTheme = {
  glow: 'rgba(245,158,11,0.38)',
  icon: '#fbbf24',
  iconHover: '#fef3c7',
  iconBg: 'rgba(245,158,11,0.12)',
  iconBgHover: 'rgba(245,158,11,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(180,83,9,0.22), rgba(194,65,12,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(253,230,138,0.5), rgba(255,237,213,0.3), transparent)',
  badgeClass: 'hzBadgeAmber',
  cardBgLight: 'rgba(255,251,235,0.82)',
  cardBgHoverLight: 'rgba(254,243,199,0.96)',
  borderLight: 'rgba(252,211,77,0.22)',
  borderHoverLight: 'rgba(245,158,11,0.55)',
  glowLight: 'rgba(245,158,11,0.25)',
  iconLight: '#92400e',
  iconHoverLight: '#b45309',
  badgeLight: 'hzBadgeAmberLight',
};

const rose: HorizonGlassTheme = {
  glow: 'rgba(244,63,94,0.38)',
  icon: '#fb7185',
  iconHover: '#ffe4e6',
  iconBg: 'rgba(244,63,94,0.12)',
  iconBgHover: 'rgba(244,63,94,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(190,18,60,0.22), rgba(190,24,93,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(254,205,211,0.5), rgba(252,231,243,0.3), transparent)',
  badgeClass: 'hzBadgeRose',
  cardBgLight: 'rgba(255,241,242,0.82)',
  cardBgHoverLight: 'rgba(255,228,230,0.96)',
  borderLight: 'rgba(253,164,175,0.22)',
  borderHoverLight: 'rgba(244,63,94,0.55)',
  glowLight: 'rgba(244,63,94,0.25)',
  iconLight: '#9f1239',
  iconHoverLight: '#e11d48',
  badgeLight: 'hzBadgeRoseLight',
};

const pink: HorizonGlassTheme = {
  glow: 'rgba(236,72,153,0.38)',
  icon: '#f472b6',
  iconHover: '#fce7f3',
  iconBg: 'rgba(236,72,153,0.12)',
  iconBgHover: 'rgba(236,72,153,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(190,24,93,0.22), rgba(190,18,60,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(251,207,232,0.5), rgba(255,228,230,0.3), transparent)',
  badgeClass: 'hzBadgePink',
  cardBgLight: 'rgba(253,242,248,0.82)',
  cardBgHoverLight: 'rgba(252,231,243,0.96)',
  borderLight: 'rgba(249,168,212,0.22)',
  borderHoverLight: 'rgba(236,72,153,0.55)',
  glowLight: 'rgba(236,72,153,0.25)',
  iconLight: '#9d174d',
  iconHoverLight: '#db2777',
  badgeLight: 'hzBadgePinkLight',
};

const indigo: HorizonGlassTheme = {
  glow: 'rgba(99,102,241,0.38)',
  icon: '#818cf8',
  iconHover: '#e0e7ff',
  iconBg: 'rgba(99,102,241,0.12)',
  iconBgHover: 'rgba(99,102,241,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(67,56,202,0.22), rgba(29,78,216,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(199,210,254,0.5), rgba(219,234,254,0.3), transparent)',
  badgeClass: 'hzBadgeIndigo',
  cardBgLight: 'rgba(238,242,255,0.82)',
  cardBgHoverLight: 'rgba(224,231,255,0.96)',
  borderLight: 'rgba(165,180,252,0.22)',
  borderHoverLight: 'rgba(99,102,241,0.55)',
  glowLight: 'rgba(99,102,241,0.25)',
  iconLight: '#3730a3',
  iconHoverLight: '#4f46e5',
  badgeLight: 'hzBadgeIndigoLight',
};

const teal: HorizonGlassTheme = {
  glow: 'rgba(20,184,166,0.38)',
  icon: '#2dd4bf',
  iconHover: '#ccfbf1',
  iconBg: 'rgba(20,184,166,0.12)',
  iconBgHover: 'rgba(20,184,166,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(15,118,110,0.22), rgba(14,116,144,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(153,246,228,0.5), rgba(207,250,254,0.3), transparent)',
  badgeClass: 'hzBadgeTeal',
  cardBgLight: 'rgba(240,253,250,0.82)',
  cardBgHoverLight: 'rgba(204,251,241,0.96)',
  borderLight: 'rgba(94,234,212,0.22)',
  borderHoverLight: 'rgba(20,184,166,0.55)',
  glowLight: 'rgba(20,184,166,0.25)',
  iconLight: '#134e4a',
  iconHoverLight: '#0d9488',
  badgeLight: 'hzBadgeTealLight',
};

const green: HorizonGlassTheme = {
  glow: 'rgba(34,197,94,0.38)',
  icon: '#4ade80',
  iconHover: '#dcfce7',
  iconBg: 'rgba(34,197,94,0.12)',
  iconBgHover: 'rgba(34,197,94,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(21,128,61,0.22), rgba(4,120,87,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(187,247,208,0.5), rgba(209,250,229,0.3), transparent)',
  badgeClass: 'hzBadgeGreen',
  cardBgLight: 'rgba(240,253,244,0.82)',
  cardBgHoverLight: 'rgba(220,252,231,0.96)',
  borderLight: 'rgba(134,239,172,0.22)',
  borderHoverLight: 'rgba(34,197,94,0.55)',
  glowLight: 'rgba(34,197,94,0.25)',
  iconLight: '#14532d',
  iconHoverLight: '#16a34a',
  badgeLight: 'hzBadgeGreenLight',
};

/** HR in the reference is purple-500, deliberately a step warmer than Admin's violet-500. */
const purple: HorizonGlassTheme = {
  glow: 'rgba(168,85,247,0.38)',
  icon: '#c084fc',
  iconHover: '#f3e8ff',
  iconBg: 'rgba(168,85,247,0.12)',
  iconBgHover: 'rgba(168,85,247,0.28)',
  gradient: 'linear-gradient(to bottom right, rgba(126,34,206,0.22), rgba(109,40,217,0.08), transparent)',
  gradientLight: 'linear-gradient(to bottom right, rgba(233,213,255,0.5), rgba(237,233,254,0.3), transparent)',
  badgeClass: 'hzBadgePurple',
  cardBgLight: 'rgba(250,245,255,0.82)',
  cardBgHoverLight: 'rgba(243,232,255,0.96)',
  borderLight: 'rgba(216,180,254,0.22)',
  borderHoverLight: 'rgba(168,85,247,0.55)',
  glowLight: 'rgba(168,85,247,0.25)',
  iconLight: '#581c87',
  iconHoverLight: '#9333ea',
  badgeLight: 'hzBadgePurpleLight',
};

/** By Mytrion / tile id (HorizonNew workspace ids). */
export const HORIZON_BY_ID: Record<string, HorizonGlassTheme> = {
  admin: violet,
  sales: sky,
  billing: emerald,
  'customer-service': amber,
  manager: pink,
  collection: indigo,
  finance: green,
  verification: teal,
  analyst: rose,
  analytics: rose,
  hr: purple,
};

/** Fallback by config hue token when id is unknown. */
export const HORIZON_BY_HUE: Record<string, HorizonGlassTheme> = {
  accent: sky,
  blue: sky,
  'light-blue': sky,
  purple: violet,
  'dark-purple': indigo,
  black: violet,
  rocket: violet,
  success: emerald,
  green: green,
  orange: amber,
  warning: amber,
  yellow: amber,
  danger: rose,
  red: rose,
};

export function glassFor(id: string, hue: string): HorizonGlassTheme {
  return HORIZON_BY_ID[id] ?? HORIZON_BY_HUE[hue] ?? sky;
}

export const LAST_WORKSPACE_KEY = 'mytrion.horizon.lastWorkspace';

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function rememberWorkspace(label: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, label);
  } catch {
    /* private mode */
  }
}
