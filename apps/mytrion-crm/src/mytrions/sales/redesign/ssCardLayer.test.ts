/**
 * Contract: scrolling glass must not be its own blurred compositor layer.
 *
 * Automations catalog buttons and Verification roster buttons went empty after focus →
 * scroll away → scroll back because `.ss-card-h` (and the Automations picklist scroller)
 * carried `backdrop-filter`. The same trap exists on every other roster / jump / picklist
 * tile in the CRM. jsdom cannot paint, so this locks the CSS/source contract.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const REDESIGN = join(SRC, 'mytrions/sales/redesign');

function walkCss(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCss(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Comments naming the property must not count as a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function cssRules(css: string): Array<{ selectors: string[]; body: string }> {
  const rules: Array<{ selectors: string[]; body: string }> = [];
  for (const match of css.matchAll(/([^{]+)\{([^}]+)\}/g)) {
    const selectorsSrc = match[1];
    const body = match[2];
    if (selectorsSrc === undefined || body === undefined) continue;
    rules.push({
      selectors: selectorsSrc.split(',').map((part) => part.trim()).filter(Boolean),
      body,
    });
  }
  return rules;
}

function hasBackdropFilter(body: string): boolean {
  return /(?:^|[^-])backdrop-filter\s*:(?!\s*none\b)/.test(body);
}

function selectorHits(selectors: string[], needle: string): boolean {
  return selectors.some((sel) => sel === needle || sel.endsWith(needle));
}

describe('scrolling Sales cards stay paintable after scroll', () => {
  const horizon = readFileSync(join(REDESIGN, 'ss-horizon.css'), 'utf8');
  const verification = readFileSync(join(REDESIGN, 'verification.css'), 'utf8');
  const catalog = readFileSync(join(REDESIGN, 'AutoCatalog.tsx'), 'utf8');
  const drop = readFileSync(join(REDESIGN, 'AutoFloatingDrop.tsx'), 'utf8');

  it('does not put backdrop-filter on .ss-card-h or the picklist scroller', () => {
    const blurred = cssRules(horizon).filter((rule) => hasBackdropFilter(rule.body));
    for (const rule of blurred) {
      expect(selectorHits(rule.selectors, '.ss-card-h')).toBe(false);
      expect(selectorHits(rule.selectors, '.ss-float-drop')).toBe(false);
      expect(selectorHits(rule.selectors, '.ss-verification-card')).toBe(false);
    }
    expect(blurred.some((rule) => selectorHits(rule.selectors, '.ss-modal-box'))).toBe(true);
  });

  it('keeps Verification roster cards free of compositor traps', () => {
    const card = cssRules(verification).find((rule) =>
      selectorHits(rule.selectors, '.ss-verification-card'),
    );
    expect(card).toBeTruthy();
    expect(hasBackdropFilter(card!.body)).toBe(false);
    expect(card!.body).not.toMatch(/transform\s*:/);
    expect(card!.body).not.toMatch(/overflow\s*:\s*hidden/);
    expect(card!.body).not.toMatch(/content-visibility\s*:/);
    expect(card!.body).not.toMatch(/will-change\s*:/);
  });

  it('emits catalog transform only while dragging, never overflow:hidden or transition:all', () => {
    const cardFn = catalog.match(/const catalogCard[\s\S]*?`;/)?.[0] ?? '';
    expect(cardFn).toMatch(/\$\{dragging \? 'transform:scale\(1\.02\);' : ''\}/);
    expect(cardFn).not.toMatch(/overflow:hidden/);
    expect(cardFn).not.toMatch(/transition:all/);
    expect(cardFn).not.toMatch(/transform:scale\(1(?!\.02)/);
  });

  it('does not clip the Automations picklist with overflow:hidden on a blurred pane', () => {
    const panel = drop.match(/const panelBase =\s*'[^']+'/)?.[0] ?? '';
    expect(panel).not.toMatch(/overflow:hidden/);
    expect(panel).toMatch(/overflow-y:auto/);
  });
});

/**
 * Classes that are scrolling card lists, roster tiles, or picklist scrollports.
 * Blur on these is the empty-after-scroll bug. Floating chrome (modals, headers,
 * empty panes, DS popovers) is allowed and is not on this list.
 */
const SCROLLING_GLASS = [
  '.ss-card-h',
  '.ss-float-drop',
  '.ss-verification-card',
  '.mg-card',
  '.mg-dept',
  '.mg-acc',
  '.mg-lty-c',
  '.ms-jump',
  '.co-jump',
  '.hr-jump',
  '.hr-empc',
  '.hr-deptc',
  '.hr-req',
  '.hr-stat',
  '.vf-cardc',
  '.recruit-job-card',
  '.recruit-candidate',
  '.recruit-metric',
  '.an-rep',
  '.an-kpi',
  '.an-card',
  '.fi-row',
  '.fi-stat',
  '.cs-card',
  '.cs-ret-row',
  '.cs-mt-card',
  '.cs-home-qa-card',
  '.cs-home-stat-card',
  '.cs-pool-metric',
  '.cs-stat-card',
  '.cs-metric-card',
  '.bm-summary-item',
  '.db-kpi-card',
  '.db-danger-card',
  '.rt-kpi',
  '.dc-deals-table',
  '.readyTile',
  '.pickerPanel',
  '.statTile',
  '.userBubble',
] as const;

const DS_CHROME = '/ds/';

describe('repo-wide: scrolling cards stay paintable after scroll', () => {
  const cssFiles = walkCss(SRC);

  it('does not put backdrop-filter on scrolling roster / jump / picklist classes', () => {
    const hits: string[] = [];
    for (const file of cssFiles) {
      const rules = cssRules(stripComments(readFileSync(file, 'utf8'))).filter((rule) =>
        hasBackdropFilter(rule.body),
      );
      for (const rule of rules) {
        for (const cls of SCROLLING_GLASS) {
          if (selectorHits(rule.selectors, cls)) {
            hits.push(`${relative(SRC, file)} :: ${cls}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps launcher workspace/stat tiles free of backdrop-filter', () => {
    for (const rel of ['app/launcher/WorkspaceCard.module.css', 'app/launcher/StatCard.module.css']) {
      const rules = cssRules(stripComments(readFileSync(join(SRC, rel), 'utf8')));
      const card = rules.find((rule) => selectorHits(rule.selectors, '.card'));
      expect(card, rel).toBeTruthy();
      expect(hasBackdropFilter(card!.body), rel).toBe(false);
    }
  });

  it('does not put backdrop-filter on a scrollport outside design-system chrome', () => {
    const hits: string[] = [];
    for (const file of cssFiles) {
      if (file.includes(DS_CHROME)) continue;
      const rules = cssRules(stripComments(readFileSync(file, 'utf8')));
      for (const rule of rules) {
        if (rule.selectors.some((sel) => sel.includes('}'))) continue;
        if (!hasBackdropFilter(rule.body)) continue;
        if (!/overflow-y\s*:\s*(auto|scroll)/.test(rule.body)) continue;
        hits.push(`${relative(SRC, file)} :: ${rule.selectors.join(', ')}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
