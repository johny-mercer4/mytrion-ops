/**
 * The token contract.
 *
 * This app has no stylelint, no visual-regression harness, and `tsc --noEmit` never reads a `.css`
 * file — so nothing else in the suite can see a broken token. These are text-level assertions over
 * the stylesheets themselves, and they are the only automated net the design system has.
 *
 * Each `it` below pins an invariant that was violated in `main` at some point:
 *   - four tokens were consumed but never declared, silently invalidating 18 declarations
 *   - three modules forked the radius scale, so `--radius-md` rendered at 6 / 8 / 12px at once
 *   - eleven `[data-mytrion]` blocks redefined `--accent`, giving every hover, focus ring and chip
 *     eleven variants to keep in sync
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs with the app directory as cwd (vitest.config.ts sits beside package.json).
const SRC = join(process.cwd(), 'src');
const THEME = join(SRC, 'styles/theme.css');
const HORIZON = join(SRC, 'styles/horizon.css');
const GLOBAL = join(SRC, 'styles/global.css');

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

const CSS_FILES = walk(SRC, ['.css']);
const STYLE_FILES = [...CSS_FILES, ...walk(SRC, ['.tsx', '.ts'])].filter(
  (f) => !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'),
);

/** `--x: value` in CSS, and `'--x':` / `"--x":` in a TSX inline style object. */
const DECL = /(?:^|[;{\s'"])(--[a-zA-Z0-9-]+)\s*['"]?\s*:/gm;
/**
 * `style={{ ['--tk-col' as string]: tone }}` — a computed key, which is how every per-item tone in
 * this app is set (TasksBlock, efsPanels, ClientModal, MytrionShell's --nav-tone). These ARE
 * declarations; missing them would report a live token as undefined.
 */
const DECL_COMPUTED = /\[\s*['"](--[a-zA-Z0-9-]+)['"](?:\s+as\s+\w+)?\s*\]\s*:/g;
/** `var(--x)` with NO fallback. A fallback is a deliberate opt-out and is never asserted on. */
const USE_NO_FALLBACK = /var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g;

function matchAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => m[1]!);
}

function declaredIn(file: string): Set<string> {
  const text = readFileSync(file, 'utf8');
  return new Set([...matchAll(text, DECL), ...matchAll(text, DECL_COMPUTED)]);
}

/** Strips comments so a token named inside prose is neither a declaration nor a use. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('token contract', () => {
  it('declares every token that is consumed without a fallback', () => {
    const declared = new Set<string>();
    for (const file of STYLE_FILES) {
      const text = code(file);
      for (const t of [...matchAll(text, DECL), ...matchAll(text, DECL_COMPUTED)]) declared.add(t);
    }

    const missing = new Map<string, string[]>();
    for (const file of STYLE_FILES) {
      for (const token of matchAll(code(file), USE_NO_FALLBACK)) {
        if (declared.has(token)) continue;
        const at = relative(SRC, file);
        missing.set(token, [...(missing.get(token) ?? []), at].slice(0, 3));
      }
    }

    // `var(--x)` against an undeclared token makes the WHOLE declaration invalid-at-computed-value
    // time — the property silently inherits instead of erroring, so this never shows up as a bug
    // report, only as "that label has the wrong colour".
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it('never declares the same token in both theme.css and horizon.css', () => {
    // Both files' `[data-theme='light']` blocks have identical specificity, so a duplicate resolves
    // by import order — which makes the winner an accident of the @import list in global.css.
    const overlap = [...declaredIn(THEME)].filter((t) => declaredIn(HORIZON).has(t));
    expect(overlap).toEqual([]);
  });

  it('gives the light theme the same raw-palette keys as the dark default', () => {
    const css = code(THEME);
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const light = /\[data-theme='light'\]\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(root).not.toBe('');
    expect(light).not.toBe('');

    // Only the RAW palette must be paired. Semantic aliases (--surface, --accent, --border …) are
    // `var()` of a raw token, so they re-derive in light and must NOT be restated — restating one
    // is exactly how the two themes drift apart on a single name.
    const RAW = /^--(page|surface-base|container|container-low|container-high|container-highest|on-surface|on-surface-variant|outline|outline-variant|primary|primary-container|tint|secondary|secondary-container|on-primary|error)$/;
    const raw = (block: string): string[] =>
      matchAll(block, DECL).filter((t) => RAW.test(t)).sort();

    expect(raw(light)).toEqual(raw(root));
  });

  it('keeps hex literals out of component CSS', () => {
    // src/styles/* is where colour is allowed to be named; everywhere else reads a token, so a
    // palette change reaches the whole app by editing one block.
    const ALLOWED = new Set([
      // Deleted by the launcher rebuild — 65 literals that become var(--badge-tone) derivations.
      // Remove this entry with the file; it is a countdown, not an exemption.
      'app/MytrionPicker.module.css',
      // Ink on the fixed --gem brand gradient, which is identical in both themes.
      'components/Gem.module.css',
    ]);
    const offenders = CSS_FILES.filter((f) => !f.includes('/styles/'))
      .filter((f) => !f.includes('/mytrions/')) // module CSS is de-forked per phase, not here
      .filter((f) => !ALLOWED.has(relative(SRC, f)))
      .filter((f) =>
        code(f)
          .split('\n')
          // A hex inside a var() fallback chain is defensive, and a hex in a mask is a stencil
          // rather than a colour. Neither is someone picking a brand value in a component.
          .filter((l) => !/var\(/.test(l) && !/mask(-image)?\s*:/.test(l))
          .some((l) => /#[0-9a-fA-F]{3,8}\b/.test(l)),
      )
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('never lets a [data-mytrion] block declare an accent', () => {
    // Workspace identity is the launcher card and the header badge — never --accent. Eleven accent
    // blocks meant eleven versions of every hover, focus ring and chip.
    const blocks = code(GLOBAL).match(/\[data-mytrion[^{]*\{[^}]*\}/g) ?? [];
    const offenders = blocks.filter((b) => /--accent[a-z-]*\s*:/.test(b));
    expect(offenders).toEqual([]);
  });

  it('puts a number on a radius only in theme.css', () => {
    // Every other radius scale (--ms-r-*, --mg-r-*, --an-r-*, --co-r-*, CS's --r-*) must be a
    // `var(--radius-*)` alias, or the app grows a second corner language per module.
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      if (file === THEME) continue;
      for (const line of code(file).split('\n')) {
        if (/^\s*--(?:[a-z]+-)?r(?:adius)?-[a-z0-9]+\s*:\s*[0-9]/.test(line)) {
          offenders.push(`${relative(SRC, file)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
