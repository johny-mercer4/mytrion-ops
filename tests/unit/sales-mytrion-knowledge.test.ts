import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSalesMytrionCatalog } from '../../src/modules/knowledge/salesMytrionCatalog.js';
import { SALES_AUTOMATION_KNOWLEDGE } from '../../src/modules/knowledge/salesMytrionAutomations.js';

interface FrontendAutomation {
  id: string;
  title: string;
  codes: string[];
}

function frontendAutomations(): FrontendAutomation[] {
  const source = readFileSync(
    new URL('../../apps/mytrion-crm/src/mytrions/sales/redesign/autoLive.ts', import.meta.url),
    'utf8',
  );
  const list = source.match(/export const AUTO_LIST[\s\S]*?\n\];/)?.[0] ?? '';
  return [...list.matchAll(/\{ id: '([^']+)', title: '([^']+)', codes: \[([^\]]*)\]/g)].map(
    ([, id = '', title = '', rawCodes = '']) => ({
      id,
      title,
      codes: [...rawCodes.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? ''),
    }),
  );
}

describe('Sales Mytrion governed self-knowledge', () => {
  it('covers every live Automation id, title, and service code', () => {
    const frontend = frontendAutomations();
    const governed = SALES_AUTOMATION_KNOWLEDGE.map(({ id, title, codes }) => ({
      id,
      title,
      codes: [...codes],
    }));
    expect(frontend).toHaveLength(23);
    expect(governed).toEqual(frontend);
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
