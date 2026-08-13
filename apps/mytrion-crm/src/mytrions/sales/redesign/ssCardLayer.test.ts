/**
 * Contract: scrolling Sales cards must not be their own blurred compositor layer.
 *
 * Automations catalog buttons and Verification roster buttons went empty after focus →
 * scroll away → scroll back because `.ss-card-h` (and the Automations picklist scroller)
 * carried `backdrop-filter`. jsdom cannot paint, so this locks the CSS/source contract.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REDESIGN = join(process.cwd(), 'src/mytrions/sales/redesign');

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
  return /(?:^|[^-])backdrop-filter\s*:/.test(body);
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
