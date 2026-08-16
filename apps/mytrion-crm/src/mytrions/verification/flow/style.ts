/**
 * Verification-flow styling — a local `s()` and the GLOBAL token names.
 *
 * WHY THIS EXISTS. The Sales redesign's `s()` and its token vocabulary (`--text`, `--muted`,
 * `--ok`, `--warn`, `--faint`, `--alt`, `--accent-rgb`) are declared under `.ss-root` — see the
 * header of `sales/redesign/theme.css`, which says so explicitly. The Verification Mytrion renders
 * through `ModuleShell`, not inside `.ss-root`, so every one of those names resolves to nothing
 * here and CSS drops the whole declaration silently. Nothing catches it: `tokens.test.ts` checks a
 * token is declared SOMEWHERE in src, not that it is in scope at the use site.
 *
 * So this module carries the same parser with the tokens the Verification tree actually has
 * (`--text-primary`, `--text-muted`, `--surface-alt`, `--success`, `--warning`, the `--intent-*`
 * family), and the flow components import from here rather than across Mytrion trees.
 */
import type { CSSProperties } from 'react';

const CACHE = new Map<string, CSSProperties>();

/**
 * Parse an inline-style string ("a:b;c:d") into a React style object.
 *
 * Splits on `;` at paren depth zero so a `color-mix(...)` or `linear-gradient(...)` value survives,
 * and on the FIRST `:` only so `url(https://…)` and `var(--x, a:b)` are not truncated.
 */
export function s(css: string | undefined): CSSProperties {
  if (!css) return {};
  const hit = CACHE.get(css);
  if (hit) return hit;

  const out: Record<string, string> = {};
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ';' && depth === 0) {
      parts.push(css.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(css.slice(start));

  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const rawKey = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!rawKey || !value) continue;
    // Custom properties keep their name; everything else becomes camelCase for React.
    const key = rawKey.startsWith('--')
      ? rawKey
      : rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }

  const frozen = out as CSSProperties;
  CACHE.set(css, frozen);
  return frozen;
}

/**
 * The tokens this tree may use. Named so a call site reads as intent rather than as a variable
 * lookup, and so the Sales-scoped names cannot creep back in by muscle memory.
 */
export const T = {
  text: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  muted: 'var(--text-muted)',
  surface: 'var(--surface)',
  surfaceAlt: 'var(--surface-alt)',
  border: 'var(--border)',
  accent: 'var(--accent)',
  onAccent: 'var(--on-accent)',
  accentSoft: 'var(--accent-soft)',
  ok: 'var(--success)',
  warn: 'var(--warning)',
  danger: 'var(--danger)',
  okBg: 'var(--intent-success-bg)',
  okBd: 'var(--intent-success-bd)',
  warnBg: 'var(--intent-warning-bg)',
  warnBd: 'var(--intent-warning-bd)',
  dangerBg: 'var(--intent-danger-bg)',
  dangerBd: 'var(--intent-danger-bd)',
  radius: 'var(--radius-md)',
  radiusSm: 'var(--radius-sm)',
  radiusFull: 'var(--radius-full)',
} as const;

/**
 * Minimum comfortable hit area. The project ladder has no token for this; 44px is the WCAG 2.5.5
 * AAA target and what the Sales desk's own fields already use.
 */
export const TOUCH = '44px';
