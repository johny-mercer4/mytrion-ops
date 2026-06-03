import { describe, expect, it } from 'vitest';
import { chunkText } from '../../src/modules/knowledge/chunker.js';
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
