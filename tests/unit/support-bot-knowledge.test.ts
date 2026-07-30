import { describe, expect, it } from 'vitest';
import { fuseSupportBotKnowledgeHits } from '../../src/modules/carrier/supportBotKnowledge.js';
import type { SupportBotKnowledgeHit } from '../../src/repos/supportBotKnowledgeRepo.js';

function hit(
  id: string,
  slug: string,
  carrierId: string,
  score: number,
): SupportBotKnowledgeHit {
  return {
    id,
    carrierId,
    slug,
    title: slug,
    content: `${slug} content`,
    translations: {},
    serviceId: null,
    knowledgeType: 'static',
    riskClass: 'read',
    source: 'test',
    version: 1,
    score,
  };
}

describe('support bot hybrid KB fusion', () => {
  it('prefers an exact carrier overlay and deduplicates the global slug', () => {
    const global = hit('global', 'report-help', '*', 0.91);
    const overlay = hit('overlay', 'report-help', 'carrier-a', 0.9);
    const results = fuseSupportBotKnowledgeHits(
      'carrier-a',
      [global, overlay],
      [global, overlay],
      3,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('overlay');
  });

  it('drops unrelated vector-only hits below the semantic threshold', () => {
    const results = fuseSupportBotKnowledgeHits(
      'carrier-a',
      [hit('weak', 'unrelated', '*', 0.2)],
      [],
      3,
    );

    expect(results).toEqual([]);
  });

  it('keeps a full-text hit even when no embedding leg is available', () => {
    const lexical = hit('lexical', 'money-disabled', '*', 0.01);
    const results = fuseSupportBotKnowledgeHits(
      'carrier-a',
      [],
      [lexical],
      3,
    );

    expect(results.map((result) => result.id)).toEqual(['lexical']);
  });
});
