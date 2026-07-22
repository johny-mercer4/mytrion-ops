/**
 * Pipeline provider seam. The Sales Verification tab reads a PipelineSnapshot through this
 * interface; today it's a deterministic MOCK (no DB), so we can ship the UX without touching the
 * credit_platform verification DB. When live access is approved, add a `creditPlatformPipelineProvider`
 * (queries kxd.<stage>_reports by request_id via the tested join key) and select it in
 * getPipelineProvider() behind FF_VERIFICATION_PIPELINE_LIVE — the snapshot shape is identical, so
 * nothing downstream changes.
 */
import {
  STAGE_CATALOG,
  type PipelineDecision,
  type PipelineSnapshot,
  type PipelineStage,
  type PipelineStageStatus,
} from './types.js';

export interface PipelineKey {
  dealId?: string | null;
  carrierId?: string | null;
  applicationId?: string | null;
  dot?: string | null;
}

export interface PipelineProvider {
  /** Returns the pipeline snapshot for a client, or null when no verification record exists. */
  getPipeline(key: PipelineKey): Promise<PipelineSnapshot | null>;
}

/** Small deterministic PRNG (mulberry32) seeded from the client key — stable state per client. */
function seededRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic mock: derives a realistic pipeline from the client key. A "progress" value places
 * the client somewhere along the 9 stages; stages before it are resolved (mostly done, some
 * skipped, occasionally failed), the current stage is pending, later stages are not_started. The
 * final decision is coherent with progress (fully-through → LOC/Prepaid/rejected; mid → undecided).
 */
export const mockPipelineProvider: PipelineProvider = {
  async getPipeline(key: PipelineKey): Promise<PipelineSnapshot | null> {
    const seed = String(key.dealId ?? key.carrierId ?? key.applicationId ?? key.dot ?? '').trim();
    if (!seed) return null;
    const rng = seededRng(`vp:${seed}`);

    const total = STAGE_CATALOG.length; // 9
    // progressIdx = how many stages are resolved (0..total). Bias toward mid/late so the UI is lively.
    const progressIdx = Math.floor(rng() * (total + 1));

    const stages: PipelineStage[] = STAGE_CATALOG.map((def) => {
      let status: PipelineStageStatus;
      if (def.order <= progressIdx) {
        const r = rng();
        status = r < 0.12 ? 'failed' : r < 0.24 ? 'skipped' : 'done';
      } else if (def.order === progressIdx + 1) {
        status = 'pending';
      } else {
        status = 'not_started';
      }
      const stage: PipelineStage = { id: def.id, order: def.order, label: def.label, status };
      // Illustrative per-stage detail for resolved stages (mock values).
      if (status !== 'not_started' && status !== 'pending') {
        if (def.id === 'isoftpull' && status === 'done') stage.detail = `Score ${580 + Math.floor(rng() * 240)}`;
        else if (def.id === 'blacklist') stage.detail = status === 'done' ? 'No match' : `${Math.floor(rng() * 3)} match(es)`;
        else if (def.id === 'antifraud') stage.detail = ['Low', 'Medium', 'High'][Math.floor(rng() * 3)] + ' risk';
        else if (def.id === 'crosscheck' && status === 'done') stage.detail = 'Consistent';
      }
      return stage;
    });

    const complete = progressIdx >= total;
    const anyFailed = stages.some((s) => s.status === 'failed');
    let decision: PipelineDecision;
    if (!complete) {
      decision = { outcome: 'undecided', reason: 'Pipeline in progress' };
    } else if (anyFailed || rng() < 0.2) {
      decision = { outcome: 'rejected', reason: 'Did not pass compliance checks' };
    } else if (rng() < 0.55) {
      const score = 600 + Math.floor(rng() * 220);
      decision = {
        outcome: 'loc',
        creditScore: score,
        approvedLimit: (5 + Math.floor(rng() * 45)) * 1000,
        billingCycle: rng() < 0.5 ? 'Weekly' : 'Bi-Weekly',
      };
    } else {
      decision = { outcome: 'prepaid', reason: 'Approved for prepaid' };
    }

    return { stages, decision, source: 'mock' };
  },
};

/**
 * Select the active provider. Mock this phase (verification DB not queried). A future live provider
 * would be chosen here behind env.FF_VERIFICATION_PIPELINE_LIVE.
 */
export function getPipelineProvider(): PipelineProvider {
  return mockPipelineProvider;
}
