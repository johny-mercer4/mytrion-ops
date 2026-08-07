import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSalesMytrionCatalog } from '../../src/modules/knowledge/salesMytrionCatalog.js';
import {
  SALES_AUTOMATION_KNOWLEDGE,
  SALES_AUTOMATION_SECTIONS,
} from '../../src/modules/knowledge/salesMytrionAutomations.js';

interface FrontendAutomation {
  id: string;
  title: string;
  codes: string[];
  dept: string;
}

function frontendAutomations(): FrontendAutomation[] {
  const source = readFileSync(
    new URL('../../apps/mytrion-crm/src/mytrions/sales/redesign/autoLive.ts', import.meta.url),
    'utf8',
  );
  const list = source.match(/export const AUTO_LIST[\s\S]*?\n\];/)?.[0] ?? '';
  return [
    ...list.matchAll(
      /\{ id: '([^']+)', title: '([^']+)', codes: \[([^\]]*)\], dept: '([^']+)'/g,
    ),
  ].map(([, id = '', title = '', rawCodes = '', dept = '']) => ({
    id,
    title,
    codes: [...rawCodes.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? ''),
    dept,
  }));
}

describe('Sales Mytrion governed self-knowledge', () => {
  it('covers every live Automation id, title, service code, and catalog section', () => {
    const frontend = frontendAutomations();
    const governed = SALES_AUTOMATION_KNOWLEDGE.map(({ id, title, codes, dept }) => ({
      id,
      title,
      codes: [...codes],
      dept,
    }));
    expect(frontend).toHaveLength(23);
    expect(governed).toEqual(frontend);
  });

  it('mirrors the frontend section labels and tells the reader which section a block sits in', () => {
    const source = readFileSync(
      new URL(
        '../../apps/mytrion-crm/src/mytrions/sales/redesign/autoCatalogOrder.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const live = Object.fromEntries(
      [...source.matchAll(/\{ code: '([CQVM])', label: '([^']+)'/g)].map(([, code = '', label = '']) => [
        code,
        label,
      ]),
    );
    expect(live).toEqual(SALES_AUTOMATION_SECTIONS);

    const docs = buildSalesMytrionCatalog().filter(
      (doc) => doc.metadata['kind'] === 'sales-automation',
    );
    const activation = docs.find((doc) => doc.metadata['automationId'] === 'card-activation');
    expect(activation?.content).toMatch(/Catalog section: Customer Service/);
    expect(activation?.metadata['section']).toBe('Customer Service');
    const balance = docs.find((doc) => doc.metadata['automationId'] === 'balance');
    expect(balance?.content).toMatch(/Catalog section: Billing/);
    expect(docs.every((doc) => /Catalog section: (Customer Service|Billing)/.test(doc.content))).toBe(
      true,
    );
  });

  it('explains catalog search, section grouping, and per-device reorder', () => {
    const guide = buildSalesMytrionCatalog().find(
      (doc) => doc.metadata['kind'] === 'sales-automations-guide',
    );
    expect(guide?.content).toMatch(/matches the block title, its description text and its service codes/);
    expect(guide?.content).toMatch(/Customer Service \(C codes\) and Billing \(Q codes\)/);
    expect(guide?.content).toMatch(/an empty section is hidden/);
    expect(guide?.content).toMatch(/saved per agent on that device only/);
  });

  it('emits one deterministic, Sales-scoped document for every Automation', () => {
    const first = buildSalesMytrionCatalog();
    const second = buildSalesMytrionCatalog();
    expect(first).toEqual(second);
    const automations = first.filter((doc) => doc.metadata['kind'] === 'sales-automation');
    expect(automations).toHaveLength(SALES_AUTOMATION_KNOWLEDGE.length);
    expect(new Set(automations.map((doc) => doc.source)).size).toBe(automations.length);
    expect(automations.every((doc) => doc.department === 'sales')).toBe(true);
    expect(automations.every((doc) => doc.metadata['audience'] === 'internal')).toBe(true);
    expect(
      automations.every((doc) =>
        /Where to find it[\s\S]*Required before running[\s\S]*Run steps[\s\S]*Result/.test(
          doc.content,
        ),
      ),
    ).toBe(true);
  });

  it('answers the exact card-activation journey without claiming Horizon executed it', () => {
    const doc = buildSalesMytrionCatalog().find(
      (item) => item.metadata['automationId'] === 'card-activation',
    );
    expect(doc?.content).toMatch(/Sales Mytrion[\s\S]*Automations[\s\S]*C-1/);
    expect(doc?.content).toMatch(/Select the client[\s\S]*Select the card[\s\S]*Activate Card/);
    expect(doc?.content).toMatch(/optionally.*driver name.*unit number.*driver ID/i);
    expect(doc?.content).toMatch(/must never claim completion/i);
  });

  it('documents generated Retention cases, timers, Open Pool, and automatic Return', () => {
    const doc = buildSalesMytrionCatalog().find(
      (item) => item.metadata['kind'] === 'sales-retention',
    );
    expect(doc?.content).toMatch(/hourly Retention sync/);
    expect(doc?.content).toMatch(/high frequency 2 days, medium 5 days, low 7 days/);
    expect(doc?.content).toMatch(/five failed attempts/);
    expect(doc?.content).toMatch(/14-calendar-day/);
    expect(doc?.content).toMatch(/Maximum 2 approved claims/);
    expect(doc?.content).toMatch(/at most 3 Sales agents/);
    expect(doc?.content).toMatch(/automatically closes it as Returned/);
  });

  it('does not embed credentials or secret configuration', () => {
    const content = buildSalesMytrionCatalog()
      .map((doc) => doc.content)
      .join('\n');
    expect(content).not.toMatch(/(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*=/i);
    expect(content).not.toMatch(/\bsk-[A-Za-z0-9_-]{10,}/);
    expect(content).not.toContain('process.env');
  });
});
