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

export interface CitationValidationOptions {
  /**
   * Answers from delegated specialists, used ONLY to recover a marker set when the final answer has
   * none. See `StreamOutcome.childTexts`: the orchestrator rewrites the child's answer and drops its
   * [Sn] markers in most runs, which would otherwise force the all-passages fallback and list 4
   * sources for an answer that rested on 1. The returned `text` is never taken from here.
   */
  markerFallbackTexts?: string[];
}

/** Marker numbers actually written in `text` that correspond to a real citation. */
function usedMarkerNumbers(text: string, known: Set<number>): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(MARKER_RE)) {
    const n = Number(m[1]);
    if (known.has(n)) out.add(n);
  }
  return out;
}

export function validateCitations(
  text: string,
  citations: WireCitation[],
  options: CitationValidationOptions = {},
): CitationValidation {
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
  const byNumbers = (numbers: Set<number>): WireCitation[] =>
    citations.filter((c) => c.marker && numbers.has(Number(c.marker.replace(/^S/, ''))));

  const marked = byNumbers(usedNumbers);
  /**
   * Before falling back to "everything retrieved", ask the specialists. If the final answer carries
   * no markers but a delegated child's answer did, those markers describe the same claims — the
   * orchestrator paraphrased them away. Narrowing to that set is strictly more precise than listing
   * every passage, and costs nothing when no child ran (the array is empty).
   */
  const inherited =
    markerNumbers.size > 0 && marked.length === 0
      ? (options.markerFallbackTexts ?? [])
          .map((childText) => byNumbers(usedMarkerNumbers(childText, markerNumbers)))
          .find((set) => set.length > 0)
      : undefined;

  const used =
    markerNumbers.size === 0 ? citations : (marked.length > 0 ? marked : (inherited ?? citations));

  return {
    // Collapse doubled spaces left by removed markers, but keep newlines intact.
    text: strippedMarkers.length > 0 ? cleaned.replace(/[ \t]{2,}/g, ' ') : cleaned,
    usedCitations: dedupeById(used),
    strippedMarkers,
  };
}
