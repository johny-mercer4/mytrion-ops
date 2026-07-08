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
