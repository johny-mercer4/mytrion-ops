/** Design-canvas helpers for Finance Mytrion redesign (see sales/redesign/dc.tsx). */
import type { CSSProperties, ReactNode } from 'react';

const CACHE = new Map<string, CSSProperties>();

export function s(css: string | undefined): CSSProperties {
  if (!css) return {};
  const hit = CACHE.get(css);
  if (hit) return hit;
  const out: Record<string, string> = {};
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
    const prop = rawProp.startsWith('--')
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[prop] = value;
  }
  const frozen = out as CSSProperties;
  CACHE.set(css, frozen);
  return frozen;
}

export function Svg({
  d,
  size = 18,
  stroke = 'currentColor',
  strokeWidth = 2,
  fill = 'none',
  style,
  className,
}: {
  d: string;
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const parts =
    d.includes('z M') || d.includes('zM') ? d.split(/\s*(?=M)/).map((p) => p.trim()).filter(Boolean) : [d];
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
      className={className}
      aria-hidden="true"
    >
      {parts.map((pathD, i) => (
        <path key={i} d={pathD} />
      ))}
    </svg>
  );
}

export interface BadgeVM {
  text: string;
  style: string;
}

export function Badge({ vm }: { vm: BadgeVM | undefined }) {
  if (!vm?.text) return null;
  return <span style={s(vm.style)}>{vm.text}</span>;
}

export type { CSSProperties, ReactNode };
