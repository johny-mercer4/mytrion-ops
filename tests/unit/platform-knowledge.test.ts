import { describe, expect, it } from 'vitest';
import { buildPlatformCatalog } from '../../src/modules/knowledge/platformCatalog.js';

describe('governed platform self-awareness catalog', () => {
  it('is deterministic, versioned, and contains the required canonical topics', () => {
    const first = buildPlatformCatalog();
    const second = buildPlatformCatalog();
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(3);
    expect(first.map((doc) => doc.title).join('\n')).toMatch(/Overview|User Guide/i);
    expect(first.map((doc) => doc.title).join('\n')).toMatch(/Data Sources/i);
    expect(first.every((doc) => /^[a-f0-9]{16}$/.test(doc.sourceVersion))).toBe(true);
  });

  it('never emits credentials, raw environment keys, or unrestricted schemas', () => {
    const content = buildPlatformCatalog().map((doc) => doc.content).join('\n');
    expect(content).not.toMatch(/(?:OPENAI|DATABASE|PASSWORD|SECRET|TOKEN|API_KEY)\s*=/i);
    expect(content).not.toMatch(/\bsk-[A-Za-z0-9_-]{10,}/);
    expect(content).not.toContain('process.env');
    expect(content).not.toContain('information_schema');
  });

  it('department-tags generated agent capabilities so retrieval can hide them', () => {
    const agentDocs = buildPlatformCatalog().filter((doc) => doc.metadata['kind'] === 'agent');
    expect(agentDocs.length).toBeGreaterThan(0);
    expect(agentDocs.every((doc) => doc.department !== null)).toBe(true);
    expect(agentDocs.some((doc) => doc.department === '__admin__')).toBe(true);
    const marketing = agentDocs.filter((doc) => doc.metadata['agentKey'] === 'marketing');
    expect(marketing.map((doc) => doc.department).sort()).toEqual(['marketing', 'sales']);
  });
});
