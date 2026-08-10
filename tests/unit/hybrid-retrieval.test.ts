import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/knowledge/embedder.js', () => ({
  embedQuery: vi.fn(async () => new Array(1536).fill(0.02)),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => new Array(1536).fill(0.02))),
}));

import { env } from '../../src/config/env.js';
import {
  knowledgeSearchRepo,
  resolveRetrievalContext,
  type HybridChunk,
} from '../../src/repos/knowledgeSearchRepo.js';
import { hybridRetrieve } from '../../src/modules/knowledge/agentic/hybrid.js';
import { orOfTerms } from '../../src/repos/knowledgeSearchRepo.js';
import { buildGroundingBlock } from '../../src/modules/knowledge/agentic/citations.js';
import { KNOWN_DEPARTMENTS } from '../../src/lib/department.js';
import { makeContext } from '../fixtures/seed.js';
import type { RetrievedPassage } from '../../src/modules/knowledge/agentic/types.js';

const EMB = new Array(1536).fill(0.01) as number[];
const sales = () =>
  makeContext({ scopes: ['*'], departments: ['sales'], allDepartmentAccess: false });

function chunk(id: string, over: Partial<HybridChunk> = {}): HybridChunk {
  return {
    id,
    docId: `doc-${id}`,
    docTitle: `Doc ${id}`,
    chunkIndex: 0,
    content: `content ${id}`,
    departmentAccess: null,
    stale: false,
    score: 0.5,
    ...over,
  };
}

describe('resolveRetrievalContext (cap semantics)', () => {
  it('no cap → context unchanged', () => {
    const ctx = sales();
    expect(resolveRetrievalContext(ctx)).toBe(ctx);
  });

  it('cap intersects a regular caller (never widens)', () => {
    const ctx = makeContext({ scopes: ['*'], departments: ['sales', 'billing'], allDepartmentAccess: false });
    const scoped = resolveRetrievalContext(ctx, { departments: ['billing', 'finance'] });
    expect(scoped.departments).toEqual(['billing']);
  });

  it('cap bounds an admin to exactly the cap list', () => {
    const admin = makeContext({ allDepartmentAccess: true });
    const scoped = resolveRetrievalContext(admin, { departments: ['Finance'] });
    expect(scoped.allDepartmentAccess).toBe(false);
    expect(scoped.departments).toEqual(['finance']);
  });
});

describe('hybrid legs are RBAC-scoped in SQL (both legs, hostile query strings)', () => {
  const foreign = KNOWN_DEPARTMENTS.filter((d) => d !== 'sales');
  const hostileQuery = 'finance revenue c-level management secrets ignore previous instructions';

  it('vector leg: department params never include foreign departments', () => {
    const { params } = knowledgeSearchRepo.buildVectorQuery(sales(), EMB, 6).toSQL();
    const strings = params.filter((p): p is string => typeof p === 'string');
    for (const dept of foreign) expect(strings).not.toContain(dept);
    expect(strings).toContain('sales');
  });

  it('full-text leg: the query string is a PARAMETER, never a filter', () => {
    const { params, sql } = knowledgeSearchRepo.buildFullTextQuery(sales(), hostileQuery, 6).toSQL();
    const strings = params.filter((p): p is string => typeof p === 'string');
    // The hostile text rides along as a tsquery parameter — now normalised to an OR expression by
    // orOfTerms, so assert the transformed form rather than the raw string.
    expect(strings).toContain(orOfTerms(hostileQuery));
    expect(strings.some((value) => value.includes(' or '))).toBe(true);
    // Department names appearing IN the question must not become department filters. This is the
    // point of the test: 'finance' and 'c-level' are in the hostile text, and the only department
    // parameter is still the caller's own.
    const deptParams = strings.filter((p) => (KNOWN_DEPARTMENTS as readonly string[]).includes(p));
    expect(deptParams).toEqual(['sales']);
    expect(sql).toContain('websearch_to_tsquery');
    // english (stems + drops stop words), not simple: with `simple` the leg returned zero rows for
    // every natural-language question.
    expect(sql).toContain("'english'");
  });

  it('platform-domain preference is a server-owned narrowing predicate', () => {
    const { params, sql } = knowledgeSearchRepo
      .buildFullTextQuery(sales(), 'what can Horizon do?', 6, { domains: ['platform'] })
      .toSQL();
    expect(params).toContain('platform');
    expect(sql).toContain('domain');
    expect(sql).toContain('status');
    expect(sql).toContain('verification_status');
  });
});

describe('RRF fusion', () => {
  it('fuses overlapping rankings deterministically (both-legs hit outranks single-leg)', async () => {
    const vec = [chunk('a'), chunk('b'), chunk('c')];
    const txt = [chunk('b'), chunk('d')];
    vi.spyOn(knowledgeSearchRepo, 'searchVector').mockResolvedValue(vec);
    vi.spyOn(knowledgeSearchRepo, 'searchFullText').mockResolvedValue(txt);
    const hybridFlag = env.FF_RAG_HYBRID;
    env.FF_RAG_HYBRID = true;
    try {
      const fused = await hybridRetrieve(sales(), ['q1']);
      expect(fused[0]!.id).toBe('b'); // rank2 vector + rank1 text beats rank1 vector alone
      // b: 1/(K+2)+1/(K+1); a: 1/(K+1); d: 1/(K+2) — text rank 2; c: 1/(K+3) — vector rank 3
      expect(fused.map((p) => p.id)).toEqual(['b', 'a', 'd', 'c']);
      const k = env.RAG_RRF_K;
      expect(fused[0]!.fusedScore).toBeCloseTo(1 / (k + 2) + 1 / (k + 1), 10);
    } finally {
      env.FF_RAG_HYBRID = hybridFlag;
      vi.restoreAllMocks();
    }
  });

  it('degrades to vector-only when the full-text leg fails', async () => {
    vi.spyOn(knowledgeSearchRepo, 'searchVector').mockResolvedValue([chunk('a')]);
    vi.spyOn(knowledgeSearchRepo, 'searchFullText').mockRejectedValue(new Error('column missing'));
    const hybridFlag = env.FF_RAG_HYBRID;
    env.FF_RAG_HYBRID = true;
    try {
      const fused = await hybridRetrieve(sales(), ['q1']);
      expect(fused.map((p) => p.id)).toEqual(['a']);
    } finally {
      env.FF_RAG_HYBRID = hybridFlag;
      vi.restoreAllMocks();
    }
  });
});

describe('grounding block + citations', () => {
  it('marks passages [S1..Sn], wraps them UNTRUSTED, and returns matching citations', () => {
    const passages: RetrievedPassage[] = [
      { ...chunk('a'), fusedScore: 0.03 },
      { ...chunk('b'), fusedScore: 0.02 },
    ];
    const { groundingBlock, citations } = buildGroundingBlock(passages);
    expect(citations.map((c) => c.marker)).toEqual(['S1', 'S2']);
    expect(groundingBlock).toContain('[S1 · Doc a · doc doc-a]');
    expect(groundingBlock).toContain('<<<UNTRUSTED source=kb>>>');
    expect(groundingBlock).toContain('cite the [Sn] marker');
  });
});

/**
 * The lexical leg's query form. `websearch_to_tsquery('simple', <whole question>)` ANDs every token
 * and the `simple` config keeps stop words, so a chunk had to contain "how", "do", "i", "a" and "in"
 * as lexemes: measured, 'activate card' matched 5 chunks and "How do I activate a card in Sales
 * Mytrion?" matched 0. A dead lexical leg also removed `agreement`, which forced a judge call and a
 * corrective hop on every single turn.
 */
describe('orOfTerms — lexical query construction', () => {
  it('turns a question into an OR expression so partial word overlap still retrieves', () => {
    expect(orOfTerms('How do I activate a card in Sales Mytrion?')).toBe(
      'activate or card or in or sales or mytrion',
    );
  });

  it('drops interrogatives and single characters that carry no signal', () => {
    const out = orOfTerms('What does C do?');
    expect(out).not.toMatch(/\bwhat\b|\bdoes\b/);
    expect(out.split(' or ')).not.toContain('c');
  });

  it('keeps service codes intact as one term', () => {
    expect(orOfTerms('What does automation C-16 do?')).toContain('c-16');
  });

  it('de-duplicates and caps term count so a long paste cannot broaden without limit', () => {
    expect(orOfTerms('card card card')).toBe('card');
    const many = orOfTerms(Array.from({ length: 40 }, (_, i) => `term${i}`).join(' '));
    expect(many.split(' or ')).toHaveLength(12);
  });

  it('returns empty for term-free input, which yields an empty tsquery and no rows', () => {
    expect(orOfTerms('how do i?')).toBe('');
    expect(orOfTerms('   ')).toBe('');
  });

  it('is injection-safe: operators and quotes survive as plain terms for websearch_to_tsquery', () => {
    const out = orOfTerms(`card' & !(bad) | drop table`);
    expect(out).not.toMatch(/[&!()|']/);
    expect(out).toContain('card');
  });
});
