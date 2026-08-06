/**
 * Grounding-block assembly with stable [S1]…[Sn] citation markers. The passages themselves
 * are UNTRUSTED (retrieved data) and wrapped accordingly; the citation instruction sits
 * outside the wrapper so the model always sees it as trusted guidance.
 */
import { wrapUntrusted } from '../../security/untrusted.js';
import type { Citation, RetrievedPassage } from './types.js';

export function buildGroundingBlock(passages: RetrievedPassage[]): {
  groundingBlock: string;
  citations: Citation[];
} {
  const citations: Citation[] = passages.map((p, i) => ({
    marker: `S${i + 1}`,
    docId: p.docId,
    docTitle: p.docTitle,
    chunkIndex: p.chunkIndex,
    ...(p.sourceVersion ? { sourceVersion: p.sourceVersion } : {}),
    ...(p.authorityClass ? { authorityClass: p.authorityClass } : {}),
    ...(p.verificationStatus ? { verificationStatus: p.verificationStatus } : {}),
    ...(p.lastVerifiedAt ? { lastVerifiedAt: p.lastVerifiedAt.toISOString() } : {}),
    stale: p.stale,
  }));
  const body = passages
    .map((p, i) => {
      const title = p.docTitle ? ` · ${p.docTitle}` : '';
      const staleNote = p.stale ? ' · may be outdated' : '';
      const version = p.sourceVersion ? ` · version ${p.sourceVersion}` : '';
      const authority = p.authorityClass ? ` · ${p.authorityClass}` : '';
      return `[S${i + 1}${title} · doc ${p.docId}${version}${authority}${staleNote}]\n${p.content}`;
    })
    .join('\n\n');
  const groundingBlock =
    'Retrieved knowledge passages follow. Ground your answer in them and cite the [Sn] marker ' +
    'for every claim taken from a passage. If they do not cover the question, say so.\n\n' +
    wrapUntrusted('kb', body);
  return { groundingBlock, citations };
}
