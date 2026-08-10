/**
 * The responsive contract.
 *
 * Sibling to `tokens.test.ts`, and for the same reason: this app has no stylelint (`apps/mytrion-crm`
 * sits in `.eslintrc.cjs` `ignorePatterns` and ships no lint script of its own) and `tsc` never reads
 * a `.css` file, so a text-level assertion is the ONLY mechanism available to hold a CSS convention.
 *
 * Every number below is a BUDGET SEEDED AT THE MEASURED VALUE, not a target. It lands green on the
 * day it is written and can only ever be lowered. That shape is deliberate — `FOUNDATIONS.md`
 * documented a breakpoint ladder for two whole phases while the tree grew to 32 distinct values, so
 * we already know prose does not hold this line. A budget that starts where reality is, and a review
 * that refuses to raise it, does.
 *
 * When you fix some, lower the number in the same commit. When a budget reaches 0, delete it and
 * replace it with a flat `toEqual([])`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BREAKPOINT } from '../hooks/useMediaQuery';

const SRC = join(process.cwd(), 'src');
const DOCS = join(process.cwd(), '..', '..', 'docs', 'design');

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * Blanks comments while preserving line numbers, so a breakpoint named in prose is not counted and
 * a reported line still points at the real one.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const CSS_FILES = walk(SRC, ['.css']);
const TS_FILES = walk(SRC, ['.tsx', '.ts']).filter((f) => !/\.test\.tsx?$/.test(f));

const at = (file: string, index: number, text: string): string =>
  `${relative(SRC, file)}:${text.slice(0, index).split('\n').length}`;

/** Every `@media` line, with its origin, comments already blanked. */
function mediaLines(): { file: string; line: string; where: string }[] {
  const out: { file: string; line: string; where: string }[] = [];
  for (const file of CSS_FILES) {
    code(file)
      .split('\n')
      .forEach((line, i) => {
        if (line.includes('@media')) {
          out.push({ file, line, where: `${relative(SRC, file)}:${i + 1}` });
        }
      });
  }
  return out;
}

/** Collect every px width threshold a media condition mentions, in either syntax. */
function widthThresholds(line: string): string[] {
  const values: string[] = [];
  for (const m of line.matchAll(/(?:max-width|min-width)\s*:\s*(\d+)px/g)) values.push(m[1]!);
  for (const m of line.matchAll(/(\d+)px\s*<=?\s*width|width\s*<=?\s*(\d+)px/g)) {
    values.push((m[1] ?? m[2])!);
  }
  return values;
}

const LADDER = new Set(Object.values(BREAKPOINT).map(String));

/** Count matches across a file set, returning `file:line` for the first few offenders. */
function census(files: readonly string[], re: RegExp): { count: number; sample: string[] } {
  let count = 0;
  const sample: string[] = [];
  for (const file of files) {
    const text = code(file);
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      count += 1;
      if (sample.length < 8) sample.push(at(file, m.index, text));
    }
  }
  return { count, sample };
}

/**
 * EXACT equality, in both directions, and that is the whole mechanism.
 *
 * `<=` would let a budget go stale: someone fixes twenty sites, the number stays at the old value,
 * and twenty regressions can now land silently under the same green test. Requiring the count to
 * MATCH means fixing something forces you to lower the number in the same commit, which is what
 * turns a budget into a ratchet rather than a ceiling.
 */
function expectBudget(label: string, actual: { count: number; sample: string[] }, budget: number): void {
  expect(
    actual.count,
    actual.count > budget
      ? `${label}: ${actual.count} found, budget ${budget}. This number only goes DOWN.\n` +
        `First offenders:\n  ${actual.sample.join('\n  ')}`
      : `${label}: ${actual.count} found, budget ${budget} — you fixed some. Lower the budget to ` +
        `${actual.count} in this commit so the ground you gained cannot be given back.`,
  ).toBe(budget);
}

describe('breakpoint ladder', () => {
  it('is the same four numbers in the hook and in FOUNDATIONS.md', () => {
    // The two copies exist because CSS cannot read a custom property inside an @media condition.
    // This is the only thing keeping them honest.
    expect(Object.values(BREAKPOINT)).toEqual([480, 640, 900, 1200]);

    const doc = readFileSync(join(DOCS, 'FOUNDATIONS.md'), 'utf8');
    for (const [name, px] of Object.entries(BREAKPOINT)) {
      expect(doc, `FOUNDATIONS.md must document the \`${name}\` rung as (width < ${px}px)`).toContain(
        `(width < ${px}px)`,
      );
    }
    // 640 is where the page changes shape and 900 is where it only gets tighter. Reversing them is
    // the single most expensive mistake available here, so the doc has to say which is which.
    expect(doc).toMatch(/\(width < 640px\)`?\s*\|\s*\*\*STRUCTURE\*\*/);
    expect(doc).toMatch(/\(width < 900px\)`?\s*\|\s*\*\*DENSITY\*\*/);
  });

  it('does not add a fifth breakpoint value', () => {
    const offenders: string[] = [];
    for (const { line, where } of mediaLines()) {
      for (const value of widthThresholds(line)) {
        if (!LADDER.has(value)) offenders.push(`${where}  ${value}px`);
      }
    }
    expectBudget(
      'off-ladder breakpoint values',
      { count: offenders.length, sample: offenders.slice(0, 8) },
      79,
    );
  });

  it('prefers range syntax over max-width/min-width', () => {
    // `(width < 640px)` excludes 640; `(max-width: 640px)` includes it. Mixing the two spellings is
    // how the shell ended up switching at 768 while ds/* guarded at 767, leaving a viewport exactly
    // 768px wide with the mobile shell and 13px inputs — which iOS answers by zooming the page.
    const offenders: string[] = [];
    for (const { line, where } of mediaLines()) {
      if (/(?:max-width|min-width)\s*:\s*\d+px/.test(line)) offenders.push(where);
    }
    expectBudget(
      'legacy max-width/min-width media conditions',
      { count: offenders.length, sample: offenders.slice(0, 8) },
      100,
    );
  });
});

describe('fixed tracks — the things that cannot fit a phone', () => {
  // A width the layout cannot go below is what actually produces a horizontal page scrollbar. These
  // three budgets are the whole "make it fit" backlog, counted rather than listed.
  it('does not add a CSS min-width in px', () => {
    expectBudget('CSS `min-width: Npx`', census(CSS_FILES, /min-width\s*:\s*\d+px/g), 74);
  });

  it('does not add an inline minWidth in TSX', () => {
    // 49 of these are in customer-service/ApplicationsTable.tsx alone, which is why that file is the
    // first table migration rather than a late one.
    expectBudget('inline `minWidth: N`', census(TS_FILES, /minWidth\s*:\s*\d+\b/g), 64);
  });

  /**
   * `repeat(3, 1fr)` is not the same as `repeat(3, minmax(0, 1fr))`, and the difference is the whole
   * bug. A bare `1fr` is `minmax(auto, 1fr)`, whose MINIMUM is min-content — so a track holding a
   * wide number refuses to shrink, the grid grows past its container, and the PAGE scrolls sideways.
   * `minmax(0, 1fr)` lets the track shrink and the content truncate instead.
   *
   * Identical on a desktop where the content fits, which is why all 29 were converted mechanically
   * and why this is a flat ban rather than a budget: there is no legitimate bare `1fr` repeat.
   */
  it('never uses a bare 1fr repeat', () => {
    const offenders: string[] = [];
    for (const file of [...CSS_FILES, ...TS_FILES]) {
      const text = code(file);
      for (const m of text.matchAll(/repeat\(\s*\d+\s*,\s*1fr\s*\)/g)) {
        offenders.push(at(file, m.index, text));
      }
    }
    expect(
      offenders,
      'Use repeat(N, minmax(0, 1fr)). A bare 1fr floors at min-content and overflows the page.',
    ).toEqual([]);
  });

  it('does not add a px track to a grid template', () => {
    // `minmax(280px, 1fr)` and `repeat(auto-fit, ...)` are fine and are the majority here; the ones
    // that hurt are fixed tracks summing past the viewport, e.g. the nine-track pool row in
    // sales/redesign/theme.css which is ~430px of fixed column before anything flexible.
    expectBudget(
      'px track in `grid-template-columns`',
      census(CSS_FILES, /grid-template-columns\s*:[^;}]*\d+px/g),
      89,
    );
  });
});

describe('viewport units', () => {
  // `100vh` is wrong on every mobile browser: it is the height with the URL bar HIDDEN, so a fixed
  // footer sits below the fold until the user scrolls. `dvh` for the app root, `svh` for containers
  // that must not be covered. Not a blind codemod — `dvh` re-lays-out on every URL-bar frame, which
  // is the wrong trade for a 400-row table.
  it('does not add a bare vh', () => {
    expectBudget('bare `vh`', census(CSS_FILES, /\b\d+(?:\.\d+)?vh\b/g), 27);
  });

  /**
   * A CLAMP is not the defect. `width: 100vw` is — it ignores the scrollbar and overflows by its
   * width — but `min(300px, calc(100vw - 1rem))` on an overlay is the correct way to say "never
   * wider than the screen", and there is no viewport-free way to express it.
   *
   * So this counts vw only where it sizes something directly. Narrowed after the budget flagged a
   * legitimate clamp on the view-as panel: a heuristic that fires on the right answer needs fixing,
   * not working around.
   */
  it('does not add a bare vw', () => {
    let count = 0;
    const sample: string[] = [];
    for (const file of CSS_FILES) {
      const text = code(file);
      for (const m of text.matchAll(/[^;{}]*\b\d+(?:\.\d+)?vw\b[^;{}]*/g)) {
        if (/\b(?:min|max|clamp)\(/.test(m[0])) continue;
        count += 1;
        if (sample.length < 8) sample.push(at(file, m.index, text));
      }
    }
    expectBudget('bare `vw` (clamps excluded)', { count, sample }, 5);
  });
});

describe('touch', () => {
  it('does not add a hover rule that reveals a control', () => {
    // A colour or background change on :hover is harmless on touch — it never fires, or flashes once
    // on tap. What breaks is REVEAL-on-hover: a control at opacity 0 until hover is simply not
    // reachable with a finger. So this counts only the blocks that change whether something can be
    // seen or hit, not all 581 :hover rules.
    let count = 0;
    const sample: string[] = [];
    for (const file of CSS_FILES) {
      const text = code(file);
      for (const m of text.matchAll(/([^{}]*:hover[^{}]*)\{([^{}]*)\}/g)) {
        if (!/(?:^|[;\s])(?:opacity|visibility|display|pointer-events|transform)\s*:/.test(m[2]!)) {
          continue;
        }
        count += 1;
        if (sample.length < 8) sample.push(at(file, m.index, text));
      }
    }
    expectBudget('reveal-on-hover rules without a `(hover: none)` reset', { count, sample }, 148);
  });

  it('does not add a font-size to an input outside the style layer', () => {
    // iOS zooms the whole page when a focused input renders below 16px, and does not zoom back.
    // The guard in styles/global.css now carries `!important` precisely BECAUSE these 43 rules
    // out-specify it — an audit found every field in three workspaces still at 12-15px. So this is
    // no longer counting a live defect; it is counting how much specificity the guard is having to
    // fight, and every one removed is a rule that no longer has to be beaten.
    // ds/ is exempt: it already guards every field with --text-input-mobile.
    const scoped = CSS_FILES.filter((f) => {
      const rel = relative(SRC, f);
      return !rel.startsWith('styles/') && !rel.startsWith('ds/');
    });
    const ELEMENT = /(?<![\w-])(?:input|textarea|select)(?![\w-])/;
    let count = 0;
    const sample: string[] = [];
    for (const file of scoped) {
      const text = code(file);
      for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
        if (!ELEMENT.test(m[1]!)) continue;
        if (!/(?:^|[;\s])font-size\s*:/.test(m[2]!)) continue;
        count += 1;
        if (sample.length < 8) sample.push(at(file, m.index, text));
      }
    }
    expectBudget('`font-size` on an input outside styles/ and ds/', { count, sample }, 43);
  });
});

describe('responsive-tables.css', () => {
  /**
   * A stylesheet that targets a class nobody writes is worse than no stylesheet: it reads as
   * covered in review, and the next person to add that class inherits rules authored for something
   * else. This app has already shipped that — `.bm-table-desktop-only` / `.bm-list-mobile-only`
   * were styled for a card fallback no `.tsx` ever rendered, and sat dead through two phases until
   * Phase 0 deleted them.
   *
   * So every class this file names has to exist in the app it claims to cover.
   */
  it('only targets classes that some component actually renders', () => {
    const css = code(join(SRC, 'styles/responsive-tables.css'));
    const classes = new Set(
      [...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]!),
    );

    const markup = TS_FILES.filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    const missing = [...classes].filter((name) => !markup.includes(name));
    expect(
      missing,
      'These classes are styled in responsive-tables.css but rendered by nothing. Either the ' +
        'class was renamed, or the rule was written for a component that does not exist.',
    ).toEqual([]);
  });
});

describe('the stacking-context trap', () => {
  /**
   * `MytrionShell.module.css` carries a long comment explaining that a `z-index` on `.shell .body`
   * creates a stacking context, which traps every legacy `position: fixed` modal BELOW the header —
   * they stay in the DOM and simply stop being visible. `transform`, `filter` and `contain` do the
   * same thing. The comment has held so far; this makes it enforceable.
   *
   * `.shell` itself is exempt and already carries `isolation: isolate` deliberately: it is the
   * outermost element, so nothing it needs to sit above lives outside it.
   */
  it('keeps .body free of anything that creates one', () => {
    const file = join(SRC, 'mytrions/_shared/MytrionShell.module.css');
    const text = code(file);
    const offenders: string[] = [];

    for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selectors = m[1]!.split(',').map((s) => s.trim());
      // Only rules that TARGET .body — `.body .navBtn` is a descendant and is not the hazard.
      if (!selectors.some((s) => /\.body(?:\[[^\]]*\])?$/.test(s))) continue;
      for (const prop of ['z-index', 'transform', 'filter', 'contain', 'isolation'] as const) {
        if (new RegExp(`(?:^|[;\\s])${prop}\\s*:`).test(m[2]!)) {
          offenders.push(`${at(file, m.index, text)}  ${m[1]!.trim()} { ${prop} }`);
        }
      }
    }

    expect(
      offenders,
      'Adding any of these to .body puts every position:fixed modal behind the header.\n' +
        'The mobile tab bar is a flow sibling of .body precisely so it never needs one.',
    ).toEqual([]);
  });
});
