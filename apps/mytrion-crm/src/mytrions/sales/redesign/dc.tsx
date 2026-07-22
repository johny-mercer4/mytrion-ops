/**
 * Design-canvas helpers for the Sales Mytrion redesign. The reference prototype uses
 * inline CSS-var STRING styles ("display:flex;color:var(--accent)") throughout; `s()` parses
 * those verbatim into React.CSSProperties so the port keeps pixel fidelity with zero
 * hand-conversion. `Chip`/`Badge` render the reference's badge shapes; icons come from
 * `<Icon>` (see ./icons). Everything lives under the `.ss-root` theme scope (see theme.css).
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

const CACHE = new Map<string, CSSProperties>();

/** Parse a reference inline-style string ("a:b;c:d") → React style object (cached). */
export function s(css: string | undefined): CSSProperties {
  if (!css) return {};
  const hit = CACHE.get(css);
  if (hit) return hit;
  const out: Record<string, string> = {};
  // Split on ';' but not inside parens (color-mix/linear-gradient contain ';'-free commas,
  // but rgba()/var() may contain ':'-free content — a paren-depth scan is the safe split).
  let depth = 0;
  let buf = '';
  const decls: string[] = [];
  for (const ch of css) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      decls.push(buf);
      buf = '';
    } else buf += ch;
  }
  if (buf.trim()) decls.push(buf);
  for (const decl of decls) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const rawProp = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!rawProp || !value) continue;
    // CSS custom properties stay literal; others camelCase.
    const prop = rawProp.startsWith('--')
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[prop] = value;
  }
  const frozen = out as CSSProperties;
  CACHE.set(css, frozen);
  return frozen;
}

/**
 * a11y props that make a styled, non-semantic element (a click-through card/row) behave like a
 * button for keyboard users: focusable, announced as a button, and activated by Enter/Space. Pairs
 * with the global :focus-visible ring in theme.css. Use where a real <button> would fight the card
 * layout — spread onto the element and drop its inline onClick (this provides it).
 */
export function clickable(onActivate: () => void): {
  role: 'button';
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
} {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

// Icons now come from ready-made lucide-react glyphs via `<Icon name=… />` (see ./icons).
// The old path-`d` `Svg`/`SvgPaths` renderers were removed in that migration.

/** Render a raw SVG string (the reference stores a few icons as full markup). Safe: the
 * strings are our own literals from the design, never user input. */
export function RawSvg({ html, style }: { html: string; style?: CSSProperties }) {
  return <span style={{ display: 'inline-flex', ...style }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface BadgeVM {
  text: string;
  style: string;
}

/** The reference `badge()` pill (pre-styled view-model badge). */
export function Badge({ vm }: { vm: BadgeVM | undefined }) {
  if (!vm || !vm.text) return null;
  return <span style={s(vm.style)}>{vm.text}</span>;
}

/** A dept/code chip (`deptStyle`-styled) from the view-model. */
export function Chip({ text, style }: { text: string; style: string }) {
  return <span style={s(style)}>{text}</span>;
}

export type { CSSProperties, ReactNode };
