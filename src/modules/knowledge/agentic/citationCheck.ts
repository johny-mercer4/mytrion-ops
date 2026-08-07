/**
 * Post-hoc citation validation. Grounding is prompt-enforced during the run; this is the
 * verification half: after the final answer is assembled, [Sn] markers that don't map to a
 * passage actually retrieved this run are stripped (a hallucinated citation is worse than
 * none), and the cited subset is returned for the UI's sources list.
 */

/** Wire shape for citations on SSE events / turn results (UI sources list). */
export interface WireCitation {
  /** Knowledge doc id. */
  id: string;
  title: string;
  /** [Sn] marker when the passage came from an agentic grounding block. */
  marker?: string;
  chunkId?: string;
  chunkIndex?: number;
  sourceVersion?: string;
  authorityClass?: string;
  verificationStatus?: string;
  lastVerifiedAt?: string;
  freshness?: 'fresh' | 'stale' | 'unknown';
}

export interface CitationValidation {
  /** The answer with unsupported [Sn] markers removed. */
  text: string;
  /** Citations backing the answer — marker-cited subset, or all retrieved when unmarked. */
  usedCitations: WireCitation[];
  strippedMarkers: string[];
}

const MARKER_RE = /\[S(\d+)\]/g;

function dedupeById(citations: WireCitation[]): WireCitation[] {
  const seen = new Set<string>();
  return citations.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

export function validateCitations(text: string, citations: WireCitation[]): CitationValidation {
  const markerNumbers = new Set(
    citations
      .map((c) => (c.marker ? Number(c.marker.replace(/^S/, '')) : NaN))
      .filter((n) => Number.isInteger(n) && n > 0),
  );

  const usedNumbers = new Set<number>();
  const strippedMarkers: string[] = [];
  const cleaned = text.replace(MARKER_RE, (whole, digits: string) => {
    const n = Number(digits);
    if (markerNumbers.has(n)) {
      usedNumbers.add(n);
      return whole;
    }
    strippedMarkers.push(`S${digits}`);
    return '';
  });

  /**
   * Marker-based grounding: sources = the markers actually cited. Classic (unmarked) retrieval:
   * sources = everything retrieved this run — same semantics as the passage count the widget shows.
   *
   * The third case is the one that bit us. When markers were AVAILABLE but the answer used none, the
   * filter returned an empty list and Admin showed **no sources at all** on an answer with
   * `grade: sufficient / 0.928` — observed directly on the orchestrator path. Whether the model
   * chooses to write `[S1]` is a stylistic accident; it says nothing about whether the answer was
   * grounded, and an answer that looks ungrounded costs more trust than a slightly broad source list.
   * So an unmarked answer falls back to the retrieved set, exactly like the classic path.
   */
  const marked = citations.filter(
    (c) => c.marker && usedNumbers.has(Number(c.marker.replace(/^S/, ''))),
  );
  const used = markerNumbers.size > 0 && marked.length > 0 ? marked : citations;

  return {
    // Collapse doubled spaces left by removed markers, but keep newlines intact.
    text: strippedMarkers.length > 0 ? cleaned.replace(/[ \t]{2,}/g, ' ') : cleaned,
    usedCitations: dedupeById(used),
    strippedMarkers,
  };
}
