export interface RagEvalObservation {
  expectedRoute: string;
  actualRoute: string;
  expectedEvidence: string[];
  retrievedEvidence: string[];
  expectedAbstain: boolean;
  actualAbstain: boolean;
  citationClaims: number;
  citedClaims: number;
  validCitations: number;
  totalCitations: number;
  faithfulClaims: number;
  latencyMs: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

export function reciprocalRank(expected: string[], retrieved: string[]): number {
  const wanted = new Set(expected);
  const rank = retrieved.findIndex((value) => wanted.has(value));
  return rank < 0 ? 0 : 1 / (rank + 1);
}

export function ndcg(expected: string[], retrieved: string[], k = 8): number {
  const wanted = new Set(expected);
  const seen = new Set<string>();
  const dcg = retrieved.slice(0, k).reduce((sum, value, index) => {
    const isNewRelevantResult = wanted.has(value) && !seen.has(value);
    seen.add(value);
    return sum + (isNewRelevantResult ? 1 / Math.log2(index + 2) : 0);
  }, 0);
  const ideal = Array.from({ length: Math.min(k, wanted.size) }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((sum, value) => sum + value, 0);
  return ideal === 0 ? 1 : dcg / ideal;
}

export function summarizeRagEval(rows: RagEvalObservation[]) {
  const total = Math.max(1, rows.length);
  const evidenceRows = rows.filter((row) => row.expectedEvidence.length > 0);
  const recallAt8 = evidenceRows.length === 0 ? 1 : evidenceRows.reduce((sum, row) => {
    const retrieved = new Set(row.retrievedEvidence.slice(0, 8));
    const hits = row.expectedEvidence.filter((value) => retrieved.has(value)).length;
    return sum + hits / row.expectedEvidence.length;
  }, 0) / evidenceRows.length;
  const abstainRows = rows.filter((row) => row.expectedAbstain);
  const citationClaims = rows.reduce((sum, row) => sum + row.citationClaims, 0);
  const totalCitations = rows.reduce((sum, row) => sum + row.totalCitations, 0);
  return {
    cases: rows.length,
    routingAccuracy: rows.filter((row) => row.expectedRoute === row.actualRoute).length / total,
    recallAt8,
    mrr: evidenceRows.length === 0 ? 1 : evidenceRows.reduce((sum, row) => sum + reciprocalRank(row.expectedEvidence, row.retrievedEvidence), 0) / evidenceRows.length,
    ndcgAt8: evidenceRows.length === 0 ? 1 : evidenceRows.reduce((sum, row) => sum + ndcg(row.expectedEvidence, row.retrievedEvidence), 0) / evidenceRows.length,
    abstentionAccuracy: abstainRows.length === 0 ? 1 : abstainRows.filter((row) => row.actualAbstain).length / abstainRows.length,
    citationCoverage: citationClaims === 0 ? 1 : rows.reduce((sum, row) => sum + row.citedClaims, 0) / citationClaims,
    citationPrecision: totalCitations === 0 ? 1 : rows.reduce((sum, row) => sum + row.validCitations, 0) / totalCitations,
    faithfulness: citationClaims === 0 ? 1 : rows.reduce((sum, row) => sum + row.faithfulClaims, 0) / citationClaims,
    p50LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.5),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.95),
  };
}
