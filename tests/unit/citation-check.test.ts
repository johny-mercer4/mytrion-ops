import { describe, expect, it } from 'vitest';
import {
  validateCitations,
  type WireCitation,
} from '../../src/modules/knowledge/agentic/citationCheck.js';

const marked: WireCitation[] = [
  { id: 'doc_a', title: 'Billing Terms', marker: 'S1' },
  { id: 'doc_b', title: 'Late Fees', marker: 'S2' },
  { id: 'doc_a', title: 'Billing Terms', marker: 'S3' }, // second chunk, same doc
];

describe('validateCitations (agentic, marker-based)', () => {
  it('keeps markers that map to retrieved passages and returns the cited subset', () => {
    const v = validateCitations('Late fees start at day 30 [S2].', marked);
    expect(v.text).toBe('Late fees start at day 30 [S2].');
    expect(v.strippedMarkers).toEqual([]);
    expect(v.usedCitations).toEqual([{ id: 'doc_b', title: 'Late Fees', marker: 'S2' }]);
  });

  it('strips hallucinated markers beyond the retrieved set', () => {
    const v = validateCitations('Fees apply [S2] per policy [S9].', marked);
    expect(v.text).toBe('Fees apply [S2] per policy .');
    expect(v.strippedMarkers).toEqual(['S9']);
    expect(v.usedCitations.map((c) => c.id)).toEqual(['doc_b']);
  });

  it('dedupes cited sources by doc id', () => {
    const v = validateCitations('See [S1] and [S3].', marked);
    expect(v.usedCitations).toHaveLength(1);
    expect(v.usedCitations[0]?.id).toBe('doc_a');
  });

  it('strips every marker when nothing was retrieved this run', () => {
    const v = validateCitations('Documented in [S1].', []);
    expect(v.text).not.toContain('[S1]');
    expect(v.strippedMarkers).toEqual(['S1']);
    expect(v.usedCitations).toEqual([]);
  });
});

describe('validateCitations (classic, unmarked retrieval)', () => {
  const unmarked: WireCitation[] = [
    { id: 'doc_a', title: 'Billing Terms' },
    { id: 'doc_b', title: 'Late Fees' },
  ];

  it('reports all retrieved docs as sources and strips stray [Sn] text', () => {
    const v = validateCitations('Per doc_a the fee is $25 [S1].', unmarked);
    expect(v.text).not.toContain('[S1]');
    expect(v.usedCitations.map((c) => c.id)).toEqual(['doc_a', 'doc_b']);
  });

  it('passes clean text through untouched', () => {
    const v = validateCitations('Plain answer, no markers.', unmarked);
    expect(v.text).toBe('Plain answer, no markers.');
    expect(v.strippedMarkers).toEqual([]);
  });
});

/**
 * The gap between the two describes above: markers were AVAILABLE but the answer used none.
 * The filter returned [] and Admin showed **no sources** on an answer graded
 * `sufficient / 0.928` — observed on the orchestrator path. Whether the model writes `[S1]` is a
 * stylistic accident and says nothing about whether the answer was grounded, so an unmarked answer
 * now falls back to the retrieved set, exactly like the classic path.
 */
describe('validateCitations — grounded answer that omitted its markers', () => {
  it('falls back to the retrieved passages instead of reporting no sources', () => {
    const v = validateCitations('Open Automations, search C-1, then click Card Activation.', marked);
    expect(v.strippedMarkers).toEqual([]);
    expect(v.usedCitations.length).toBeGreaterThan(0);
    // Deduped by doc: doc_a (S1/S3) and doc_b (S2).
    expect(v.usedCitations.map((c) => c.id)).toEqual(['doc_a', 'doc_b']);
  });

  it('still prefers the cited subset when the answer DID cite', () => {
    const v = validateCitations('Only this one matters [S2].', marked);
    expect(v.usedCitations.map((c) => c.id)).toEqual(['doc_b']);
  });

  it('falls back when every marker the answer used was hallucinated', () => {
    // S9 does not exist, so it is stripped and nothing valid remains cited — but the answer was
    // still built on retrieved passages, so the reader should see them.
    const v = validateCitations('Per policy [S9].', marked);
    expect(v.strippedMarkers).toEqual(['S9']);
    expect(v.usedCitations.map((c) => c.id)).toEqual(['doc_a', 'doc_b']);
  });

  it('reports nothing when nothing was retrieved — the fallback cannot invent sources', () => {
    const v = validateCitations('An answer with no retrieval behind it.', []);
    expect(v.usedCitations).toEqual([]);
  });
});

/**
 * The orchestrator rewrites a specialist's answer before the user sees it, and measured on the
 * routed path it used to drop the child's [Sn] markers on every run — which forced the fallback
 * above to list 4 retrieved passages for an answer that actually rested on 1. Prompting the
 * orchestrator to carry markers through fixed the common case (4/4 runs), so these cover the
 * remaining ones: the child's own answer is the authority on which passages were used.
 */
describe('validateCitations — inheriting markers from a specialist answer', () => {
  const childAnswer = 'Search Automations for C-1, then pick the client and card [S1].';

  it('narrows to the specialist-cited subset when the final answer carries no markers', () => {
    const out = validateCitations('Open Automations and search for C-1.', marked, {
      markerFallbackTexts: [childAnswer],
    });
    expect(out.usedCitations.map((c) => c.id)).toEqual(['doc_a']);
    expect(out.strippedMarkers).toEqual([]);
  });

  it('prefers the final answer\'s own markers over the specialist\'s', () => {
    const out = validateCitations('Late fees apply after 30 days [S2].', marked, {
      markerFallbackTexts: [childAnswer],
    });
    expect(out.usedCitations.map((c) => c.id)).toEqual(['doc_b']);
  });

  it('uses the first specialist that cited anything, ignoring silent ones', () => {
    const out = validateCitations('Combined answer with no markers.', marked, {
      markerFallbackTexts: ['I could not find anything.', childAnswer],
    });
    expect(out.usedCitations.map((c) => c.id)).toEqual(['doc_a']);
  });

  it('keeps the all-passages fallback when no specialist cited anything either', () => {
    const out = validateCitations('No markers anywhere.', marked, {
      markerFallbackTexts: ['Nothing relevant found.'],
    });
    expect(out.usedCitations).toHaveLength(2); // doc_a + doc_b, deduped
  });

  it('ignores specialist markers that are not backed by a retrieved passage', () => {
    const out = validateCitations('No markers here.', marked, {
      markerFallbackTexts: ['Invented source [S9].'],
    });
    expect(out.usedCitations).toHaveLength(2); // falls back, does not invent S9
  });

  it('behaves exactly as before when no specialist ran', () => {
    const out = validateCitations('No markers here.', marked, { markerFallbackTexts: [] });
    expect(out.usedCitations).toHaveLength(2);
  });
});
