/**
 * Design-canvas helpers for the Sales Mytrion redesign. The reference prototype uses
 * inline CSS-var STRING styles ("display:flex;color:var(--accent)") throughout; `s()` parses
 * those verbatim into React.CSSProperties so the port keeps pixel fidelity with zero
 * hand-conversion. `Svg` renders a stroked-icon path; `Chip`/`Badge` render the reference's
 * badge shapes. Everything lives under the `.ss-root` theme scope (see theme.css).
 */
import type { CSSProperties, ReactNode } from 'react';

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

/** A stroked (outline) SVG icon from a path `d`. Supports multi-subpath icons
 * (space-separated movetos after `z`) by splitting into separate <path> nodes. */
export function Svg({
  d,
  size = 18,
  stroke = 'currentColor',
  strokeWidth = 2,
  fill = 'none',
  style,
}: {
  d: string;
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  style?: CSSProperties;
}) {
  const parts = d.includes('z M') || d.includes('zM')
    ? d.split(/\s*(?=M)/).map((p) => p.trim()).filter(Boolean)
    : [d];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {parts.map((pathD, i) => (
        <path key={i} d={pathD} />
      ))}
    </svg>
  );
}

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
