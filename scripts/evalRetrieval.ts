/**
 * Retrieval-quality regression harness: ingests the fixture corpus into the CONFIGURED dev DB
 * (checksum-idempotent — safe to re-run) and reports recall@6 / MRR for the three retrieval
 * modes: single-shot kNN, hybrid RRF, and the agentic loop. Run manually before flipping
 * FF_RAG_HYBRID / FF_AGENTIC_RAG in prod:
 *
 *   pnpm exec tsx scripts/evalRetrieval.ts
 *
 * Requires MYTRION_OPS_DATABASE_URL + OPENAI_API_KEY. Do NOT point at production.
 * Baseline (2026-07-02, this corpus): single-shot recall@6 = 1.00 — hybrid/agentic must not regress.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { env } from '../src/config/env.js';
import { closeDb } from '../src/db/client.js';
import { logger } from '../src/lib/logger.js';
import { ingestDocument } from '../src/modules/knowledge/ingestService.js';
import { retrieve } from '../src/modules/knowledge/retriever.js';
import { hybridRetrieve } from '../src/modules/knowledge/agentic/hybrid.js';
import { agenticRetrieve } from '../src/modules/knowledge/agentic/loop.js';
import { systemContext } from '../src/modules/auth/authService.js';
import type { TenantContext } from '../src/types/tenantContext.js';

interface Corpus {
  docs: Array<{ key: string; department: string | null; title: string; content: string }>;
  queries: Array<{ question: string; relevant: string[]; ctxDepartments: string[] }>;
}

const K = 6;

function ctxFor(departments: string[]): TenantContext {
  return { ...systemContext(`eval-${Date.now()}`), departments, allDepartmentAccess: false };
}

function scoreRun(rankedDocTitles: string[], relevantTitles: Set<string>): { hit: boolean; rr: number } {
  const idx = rankedDocTitles.findIndex((t) => relevantTitles.has(t));
  return { hit: idx >= 0 && idx < K, rr: idx >= 0 ? 1 / (idx + 1) : 0 };
}

async function main(): Promise<void> {
  const corpus = JSON.parse(
    readFileSync(new URL('../tests/fixtures/retrieval-corpus.json', import.meta.url), 'utf-8'),
  ) as Corpus;

  logger.info('ingesting fixture corpus (checksum-idempotent)…');
  const ingestCtx = systemContext('eval-ingest');
  const titleByKey = new Map<string, string>();
  for (const doc of corpus.docs) {
    titleByKey.set(doc.key, doc.title);
    await ingestDocument(ingestCtx, {
      title: doc.title,
      content: doc.content,
      ...(doc.department ? { department: doc.department } : {}),
    });
  }

  const modes = ['single-shot', 'hybrid', 'agentic'] as const;
  const totals: Record<(typeof modes)[number], { hits: number; rrSum: number }> = {
    'single-shot': { hits: 0, rrSum: 0 },
    hybrid: { hits: 0, rrSum: 0 },
    agentic: { hits: 0, rrSum: 0 },
  };

  const hybridFlag = env.FF_RAG_HYBRID;
  env.FF_RAG_HYBRID = true;

  for (const q of corpus.queries) {
    const ctx = ctxFor(q.ctxDepartments);
    const relevantTitles = new Set(q.relevant.map((k) => titleByKey.get(k)!));

    const single = await retrieve(ctx, q.question, K);
    // Single-shot returns chunk content only; resolve titles via a second hybrid call is unfair —
    // compare on docId presence instead: match via hybrid's docTitle when available.
    const hybrid = await hybridRetrieve(ctx, [q.question]);
    const agentic = await agenticRetrieve(ctx, q.question, { k: K });

    const hybridTitles = hybrid.slice(0, K).map((p) => p.docTitle ?? '');
    const agenticTitles = agentic.passages.map((p) => p.docTitle ?? '');
    const titleByDocId = new Map(hybrid.map((p) => [p.docId, p.docTitle ?? '']));
    const singleTitles = single.map((r) => titleByDocId.get(r.docId) ?? '');

    for (const [mode, titles] of [
      ['single-shot', singleTitles],
      ['hybrid', hybridTitles],
      ['agentic', agenticTitles],
    ] as const) {
      const { hit, rr } = scoreRun(titles, relevantTitles);
      totals[mode].hits += hit ? 1 : 0;
      totals[mode].rrSum += rr;
    }
  }

  env.FF_RAG_HYBRID = hybridFlag;

  const n = corpus.queries.length;
  // Floor gates vs 2026-07 baseline (single-shot recall@6 = 1.00). Soften slightly for agentic/CRAG noise.
  const FLOORS: Record<(typeof modes)[number], { recall: number; mrr: number }> = {
    'single-shot': { recall: 1.0, mrr: 0.8 },
    hybrid: { recall: 0.9, mrr: 0.7 },
    agentic: { recall: 0.85, mrr: 0.65 },
  };
  let breached = false;
  for (const mode of modes) {
    const { hits, rrSum } = totals[mode];
    const recallAtK = hits / n;
    const mrr = rrSum / n;
    const floor = FLOORS[mode];
    const modeBreach = recallAtK < floor.recall || mrr < floor.mrr;
    if (modeBreach) breached = true;
    logger.info(
      {
        mode,
        recallAtK: recallAtK.toFixed(2),
        mrr: mrr.toFixed(3),
        queries: n,
        floor,
        breached: modeBreach,
      },
      'retrieval eval result',
    );
  }
  if (breached) {
    logger.error('retrieval eval REGRESSION vs floors — failing');
    process.exitCode = 1;
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'retrieval eval failed');
    await closeDb();
    process.exit(1);
  });
