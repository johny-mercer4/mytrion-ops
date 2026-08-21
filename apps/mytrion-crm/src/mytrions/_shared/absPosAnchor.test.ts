/**
 * "The fall" — the app sliding up after an upload, with no scrollbar to slide it back.
 *
 * THE MECHANISM, because it is not obvious and it has now been fixed at two different layers:
 *
 *   1. A visually-hidden `<input type="file">` is `position: absolute` (kept out of `display: none`
 *      on purpose, so it stays in the focus order).
 *   2. Its label declared no `position`, and neither did anything between them and the shell — so the
 *      input's containing block was `.shell .body`, and it resolved ~990px above where it appears.
 *   3. Clicking the label FOCUSES that control, and a browser scrolls the nearest scrollport to
 *      reveal a focused element. `.body` was `overflow: hidden`, which hides the scrollbar but leaves
 *      the box scrollable — so the whole app scrolled, invisibly and irreversibly.
 *   4. Every document row rendered above the control pushed the input further down, so the drop grew
 *      by one row per upload. That is why it looked like an upload bug rather than a layout bug.
 *
 * jsdom does no layout, so no rendering test can see this. What CAN be asserted is the two CSS facts
 * that make it impossible, and that is what this file does.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Comments stripped: these rules are DESCRIBED at length in prose that quotes the old declarations. */
function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every stylesheet under src, so a new escapee anywhere is measured against the same rule. */
function styleSheets(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) styleSheets(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('the app shell cannot be scrolled by a focus it does not own', () => {
  /**
   * `clip` rather than `hidden` is the whole point: `hidden` is scrollable, `clip` is not. This is
   * the guard that holds even when the next visually-hidden absolute control forgets its anchor.
   */
  it('declares .body overflow: clip, never hidden', () => {
    const css = read('src/mytrions/_shared/MytrionShell.module.css');
    const body = /\n\.body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body, 'MytrionShell.module.css must declare a .body rule').not.toBe('');
    expect(body).toMatch(/overflow:\s*clip/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
  });

  /**
   * The source-level fix. `.va-doc-attach` is the label wrapping the Verification desk's file input;
   * without its own containing block the input escapes to the shell again.
   */
  it('anchors the Verification attach control that started this', () => {
    const css = read('src/mytrions/verification/applicants/applicantsCase.css');
    const rule = /\.va-doc-attach\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*relative/);
    // And the thing it is anchoring is really there — otherwise this test passes for nothing.
    expect(css).toMatch(/\.va-doc-attach input\s*\{[^}]*position:\s*absolute/);
  });

  /**
   * The class, stated. Any rule that hides a control by taking it out of flow must be anchored by
   * the rule immediately governing its parent — and the only way to be sure of that from CSS text is
   * to require the parent selector to appear with `position: relative` in the same file.
   *
   * Failing here does not mean "the fall is back"; `.body { overflow: clip }` stops the symptom. It
   * means a new visually-hidden absolute control has no containing block of its own, which is worth
   * knowing before it is nested inside something that CAN scroll.
   */
  it('anchors every visually-hidden absolute input in module CSS', () => {
    const offenders: string[] = [];
    for (const file of styleSheets(join(process.cwd(), 'src'))) {
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      /**
       * Rules as (selector, block) pairs, so the anchor check can EXCLUDE the offending rule.
       *
       * The first cut of this test probed the whole file with `<leaf>[^{}]*\{[^}]*position:` — which
       * `.va-doc-attach input { position: absolute }` satisfies by itself. It reported zero offenders
       * with the fix reverted, which is worse than no test.
       */
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel = '', block = '']) => ({
        sel: sel.trim().replace(/\s+/g, ' '),
        block,
      }));
      for (const rule of rules) {
        if (!/\binput$/.test(rule.sel)) continue;
        if (!/position:\s*absolute/.test(rule.block)) continue;
        // A sliver, not a real overlay: this is the visually-hidden-control shape.
        if (!/width:\s*1px/.test(rule.block)) continue;
        const parent = rule.sel.replace(/\s*>?\s*input$/, '').trim();
        if (parent === '') continue;
        /**
         * An anchor is a DIFFERENT rule inside the same scope that establishes a containing block —
         * the input's CSS parent itself, or a wrapper below it such as the `label` it really sits in.
         *
         * A PREFIX match, not an exact one, because the offending selector is usually a DESCENDANT
         * selector (`.grid input`) while the real DOM parent is a `label` inside it, and CSS text
         * cannot tell us which. So this is a guard, not a proof: it answers "is anything in this
         * component positioned to catch the input", which is what stops the escape to the shell.
         *
         * `absolute` is deliberately not accepted — an absolutely positioned ancestor that itself
         * escaped is not an anchor, it is the same bug one level up.
         */
        const anchored = rules.some(
          (other) =>
            other !== rule &&
            !/\binput$/.test(other.sel) &&
            other.sel.startsWith(parent) &&
            /position:\s*(relative|sticky|fixed)/.test(other.block),
        );
        if (!anchored) offenders.push(`${file.split('/src/')[1]} — ${rule.sel}`);
      }
    }
    expect(
      offenders,
      'A visually-hidden `position: absolute` input needs its own parent to declare ' +
        '`position: relative`. Without it the input resolves against whatever ancestor happens to be ' +
        'positioned — the app shell — and focusing it scrolls the whole page. See the docblock above.',
    ).toEqual([]);
  });
});
