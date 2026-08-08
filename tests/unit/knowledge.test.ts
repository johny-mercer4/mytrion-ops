import { describe, expect, it } from 'vitest';
import { chunkText, contextualizeChunk } from '../../src/modules/knowledge/chunker.js';
import { knowledgeRepo } from '../../src/repos/knowledgeRepo.js';
import { makeContext } from '../fixtures/seed.js';

describe('chunker', () => {
  it('returns no chunks for empty/whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const chunks = chunkText('hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('hello world');
  });

  it('splits long text into sequential chunks within the size bound', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence ${i} with filler words here.`).join(' ');
    const chunks = chunkText(text, { chunkSize: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      // overlap can push slightly past chunkSize; allow headroom.
      expect(chunk.content.length).toBeLessThanOrEqual(260);
    });
  });

  it('preserves structural headings and keeps contextual text separate from citation content', () => {
    const chunks = chunkText('# Billing SOP\n## Late payment\n1. Contact the carrier.\n2. Record the result.');
    expect(chunks[0]).toMatchObject({
      sectionPath: 'Billing SOP > Late payment',
      content: '1. Contact the carrier.\n2. Record the result.',
    });
    const retrievalText = contextualizeChunk(chunks[0]!, {
      title: 'Billing Manual',
      source: 'sop://billing',
      domain: 'sop',
      language: 'en',
    });
    expect(retrievalText).toContain('Document: Billing Manual');
    expect(retrievalText).toContain('Section: Billing SOP > Late payment');
    expect(chunks[0]?.content).not.toContain('Document: Billing Manual');
  });
});

describe('knowledge retrieval isolation (SQL build)', () => {
  it('scopes the kNN query by tenant_id and audience without executing it', () => {
    const ctx = makeContext({ tenantId: 'tenant-A', role: 'ops' });
    const { sql } = knowledgeRepo.buildSearchQuery(ctx, [0.1, 0.2, 0.3], 5).toSQL();
    expect(sql).toContain('tenant_id');
    expect(sql).toContain('audience');
    expect(sql.toLowerCase()).toContain('limit');
    // cosine distance operator from the HNSW index
    expect(sql).toContain('<=>');
  });
});

/**
 * Section packing. Every section used to become at least one chunk regardless of size, so a
 * heavily-subheaded document fragmented far below the budget: a 1,778-character generated automation
 * document became 6 chunks averaging 296 characters against a 1,000-character budget. That is why
 * retrieval could return the right document at rank 1 and still not carry the facts — measured,
 * document recall 97.9% against evidence coverage 76%.
 */
describe('chunker — small sections are packed, not emitted one per heading', () => {
  const doc = [
    '# Sales Mytrion Automation — Override the Card',
    '',
    'Service code(s): C-16',
    '',
    '## Where to find it',
    'Open Sales Mytrion, then Automations, then search C-16.',
    '',
    '## Result',
    'The card receives an approximately 30-minute active window.',
    '',
    '## Important',
    'An override does not lift the fraud hold.',
  ].join('\n');

  it('keeps facts from sibling sections in one passage', () => {
    const chunks = chunkText(doc, { chunkSize: 1000, overlap: 0 });
    const together = chunks.filter(
      (c) => c.content.includes('30-minute') && c.content.includes('fraud hold'),
    );
    expect(together.length).toBeGreaterThan(0);
  });

  it('produces far fewer chunks than there are headings', () => {
    const chunks = chunkText(doc, { chunkSize: 1000, overlap: 0 });
    expect(chunks.length).toBeLessThan(4);
    expect(chunks.every((c) => c.content.length <= 1000)).toBe(true);
  });

  it('inlines leaf headings when it packs, so the model can still see the structure', () => {
    const packed = chunkText(doc, { chunkSize: 1000, overlap: 0 }).find((c) =>
      c.content.includes('fraud hold'),
    );
    expect(packed?.content).toMatch(/Important/);
    expect(packed?.sectionPath).toBeTruthy();
  });

  it('never exceeds the budget, and still splits a section larger than it', () => {
    const long = ['## Big', 'x'.repeat(2_500)].join('\n');
    const chunks = chunkText(long, { chunkSize: 500, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 500)).toBe(true);
  });

  it('leaves a single-section document byte-identical (no format change for prose)', () => {
    const prose = ['# Only', 'One short body.'].join('\n');
    const chunks = chunkText(prose, { chunkSize: 1000, overlap: 0 });
    expect(chunks).toHaveLength(1);
    // No inlined heading and no reflow: packing must not alter documents it does not need to pack.
    expect(chunks[0]?.content).toBe('One short body.');
    expect(chunks[0]?.sectionPath).toBe('Only');
  });

  /**
   * Pre-existing quirk, asserted so a future change to it is deliberate: `structuralSections` indexes
   * headings by depth, so a document whose first heading is `##` leaves index 0 unset and the joined
   * path gains a leading separator. Harmless (it only ever reaches `contextualizeChunk`), and not
   * changed here because every embedding would shift.
   */
  it('records the known leading-separator artifact for docs that start at h2', () => {
    const chunks = chunkText(['## Deep', 'Body.'].join('\n'), { chunkSize: 1000, overlap: 0 });
    expect(chunks[0]?.sectionPath).toBe(' > Deep');
  });
})
