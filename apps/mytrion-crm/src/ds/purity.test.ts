/**
 * The purity contract for src/ds/.
 *
 * Everything here must be renderable with nothing but props. That is not a style preference — it is
 * the precondition for three things the design system exists to enable:
 *   1. a kitchen-sink route that renders every component in every state with no backend,
 *   2. a library build (vite.lib.config.ts) that produces a real dist/,
 *   3. binding that dist/ to a design tool, where there is no UserContextProvider, no router and no
 *      API to reach for.
 *
 * A component that calls useUserContext() looks fine in the app and is unusable everywhere else,
 * and the failure is invisible until someone tries. Hence a test rather than a convention.
 *
 * Workspace-aware components are NOT banned from the codebase — they belong in mytrions/_shared,
 * which is where compositions live. This rule is about the primitive layer only.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const DS = join(process.cwd(), 'src/ds');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Import specifiers that would tie a primitive to the running app. */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/from\s+['"][^'"]*\/context\/[^'"]*['"]/, 'app context (context/*)'],
  [/from\s+['"][^'"]*\/api\/[^'"]*['"]/, 'the API layer (api/*)'],
  [/from\s+['"][^'"]*\/access\/[^'"]*['"]/, 'access control (access/*)'],
  [/from\s+['"][^'"]*\/mytrions\/[^'"]*['"]/, 'a workspace (mytrions/*)'],
  [/from\s+['"][^'"]*\/features\/[^'"]*['"]/, 'a feature (features/*)'],
  [/from\s+['"]react-router[^'"]*['"]/, 'react-router'],
  [/from\s+['"]@tanstack\/react-query['"]/, 'react-query'],
  [/\buseUserContext\b/, 'useUserContext()'],
  // The icon family is Material Symbols. A stray lucide import here is a mixed-family violation,
  // which is exactly the defect the icon work exists to remove.
  [/from\s+['"]lucide-react['"]/, 'lucide-react (the icon family is Material Symbols Sharp)'],
];

describe('src/ds purity', () => {
  const files = walk(DS);

  it('has components to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never reaches into app context, routing, data or workspaces', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(src)) offenders.push(`${relative(DS, file)} imports ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('puts no colour, radius or font-size literal in a ds stylesheet', () => {
    // src/styles/theme.css is the only file allowed to name a colour. A primitive that hardcodes
    // one cannot be re-themed, which defeats the point of shipping tokens alongside it.
    const styles: string[] = [];
    const collect = (dir: string): void => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) collect(full);
        else if (e.name.endsWith('.css')) styles.push(full);
      }
    };
    collect(DS);

    const offenders: string[] = [];
    for (const file of styles) {
      const body = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [i, line] of body.split('\n').entries()) {
        if (/var\(/.test(line) || /mask(-image)?\s*:/.test(line)) continue;
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`${relative(DS, file)}:${i + 1} colour`);
        if (/border-radius:\s*[0-9]/.test(line)) offenders.push(`${relative(DS, file)}:${i + 1} radius`);
        if (/font-size:\s*[0-9]/.test(line)) offenders.push(`${relative(DS, file)}:${i + 1} font-size`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
