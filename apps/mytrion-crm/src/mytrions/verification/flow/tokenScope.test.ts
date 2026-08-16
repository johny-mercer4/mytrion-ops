/**
 * Guards a bug class the existing suites cannot see.
 *
 * `sales/redesign/theme.css` declares `--text`, `--text2`, `--muted`, `--faint`, `--alt`, `--ok`,
 * `--warn` and `--accent-rgb` under `.ss-root`. The Verification Mytrion renders through
 * ModuleShell and never enters that scope, so any of those names used here resolves to nothing and
 * CSS silently drops the whole declaration — text loses its colour, a tinted panel loses its
 * background, and nothing errors.
 *
 * `styles/tokens.test.ts` cannot catch it: it asserts a token is declared SOMEWHERE under src, and
 * these all are — just not in a scope this tree can reach. So the check has to be by location.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Declared under `.ss-root` only — see the de-forking note in sales/redesign/theme.css. */
const SALES_SCOPED = [
  '--text',
  '--text2',
  '--muted',
  '--faint',
  '--alt',
  '--ok',
  '--warn',
  '--bg2',
  '--raised',
  '--brand',
  '--accent-rgb',
  '--violet-rgb',
  '--border2',
  '--card-grad',
];

const ROOTS = [
  join(process.cwd(), 'src/mytrions/verification/flow'),
  join(process.cwd(), 'src/mytrions/verification/tabs'),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(path);
    }
  }
  return out;
}

describe('verification flow uses only globally-scoped tokens', () => {
  const files = ROOTS.flatMap(walk);

  it('finds the flow sources', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(SALES_SCOPED)('never reads the .ss-root-scoped %s', (token) => {
    // `var(--text)` must not match `var(--text-primary)`, so the boundary is explicit.
    const pattern = new RegExp(`var\\(\\s*${token}\\s*[,)]`);
    const offenders = files.filter((file) => pattern.test(readFileSync(file, 'utf8')));
    expect(
      offenders.map((f) => f.replace(process.cwd(), '')),
      `${token} is declared under .ss-root and resolves to nothing in the Verification Mytrion`,
    ).toEqual([]);
  });

  it('does not import the Sales style helper, whose tokens assume .ss-root', () => {
    const offenders = files.filter((file) => /from '.*sales\/redesign\/dc'/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });

  it('keeps every interactive control at a 44px touch target', () => {
    // WCAG 2.5.5. A fixed `height:` under 44 on a control is the shape this regressed as before.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/height:(\d+)px;padding:0 /g)) {
        if (Number(match[1]) < 44) offenders.push(`${file.replace(process.cwd(), '')} → ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
