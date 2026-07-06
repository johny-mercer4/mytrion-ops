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

  // Marker-based grounding: sources = the markers actually cited. Classic (unmarked)
  // retrieval: sources = everything retrieved this run — same semantics as the passage
  // count the widget shows today.
  const used =
    markerNumbers.size > 0
      ? citations.filter((c) => c.marker && usedNumbers.has(Number(c.marker.replace(/^S/, ''))))
      : citations;

  return {
    // Collapse doubled spaces left by removed markers, but keep newlines intact.
    text: strippedMarkers.length > 0 ? cleaned.replace(/[ \t]{2,}/g, ' ') : cleaned,
    usedCitations: dedupeById(used),
    strippedMarkers,
  };
}
