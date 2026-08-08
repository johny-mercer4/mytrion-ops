/**
 * pass@k for RETRIEVAL, measured offline against the local corpus.
 *
 * Why retrieval-level and not answer-level. `benchSalesChat.ts` measures whether the model *cited*
 * the expected document, and that number is unstable: expected-doc coverage read 8/10 and 9/10 on
 * identical configurations, with the multi-document cases flipping while every single-document case
 * stayed put. Measured cause — `citationCheck` narrows `citations` to the model's chosen subset when
 * the answer writes `[Sn]` markers and silently widens it to everything retrieved when it does not
 * (its own comment calls that "a stylistic accident"). So the answer-level denominator is chosen by
 * the model, and no amount of k repairs a metric like that.
 *
 * This harness removes the orchestrator, the answer model and the citation filter, and asks the only
 * question a retrieval gate should ask: **did the right document come back in the top k?** That is
 * what actually moves when you change FF_RAG_HYBRID, FF_RAG_RERANK, RAG_MIN_COSINE_SCORE,
 * RAG_CANDIDATES_PER_LEG or RAG_MULTIQUERY_MAX. Answer-level quality stays with the bench, where it
 * belongs, and should be read as a prompt/model signal rather than a retrieval one.
 *
 * Usage:
 *   MYTRION_OPS_DATABASE_URL=postgresql://octane:octane@localhost:5433/octane_assistant \
 *   pnpm tsx scripts/evalRetrievalPassK.ts [--attempts 3] [--k 5] [--lang en|all] [--json]
 *
 * Exit code is 1 when any selected case fails the preflight, so a fixture bug cannot masquerade as a
 * retrieval regression.
 */
import 'dotenv/config';
import { and, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { closeDb, db } from '../src/db/client.js';
import { knowledgeChunks, knowledgeDocs } from '../src/db/schema/index.js';
import { effectiveRetrievalContext } from '../src/modules/agents/authority.js';
import { salesAgent } from '../src/modules/agents/manifests/sales.js';
import { buildSystemContext } from '../src/modules/jobs/systemContext.js';
import { agenticRetrieve } from '../src/modules/knowledge/agentic/loop.js';
import { HORIZON_RAG_GOLDEN_V1 } from '../tests/fixtures/horizon-rag-golden.js';

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const ATTEMPTS = Math.max(1, Number(arg('attempts', '3')) || 3);
const K = Math.max(1, Number(arg('k', '5')) || 5);
const LANG = arg('lang', 'en');
const AS_JSON = process.argv.includes('--json');

/**
 * Only the sales-mytrion categories are scored by default. An audit of the fixture found that 7 of
 * its 21 evidence-bearing seeds cannot be satisfied by the corpus at all — wrong department scope, or
 * a `requiredTerms` word that appears nowhere — so including them would report a permanent ~33%
 * failure floor that is a fixture bug. Those need repairing separately; the preflight below refuses to
 * run rather than quietly averaging them in.
 */
const CATEGORIES = new Set([
  'sales-mytrion-automation',
  'sales-mytrion-retention',
  'sales-mytrion-availability',
]);

interface Target {
  titlePattern: string;
  requiredTerms: string[];
}
interface Case {
  id: string;
  category: string;
  language: string;
  request: string;
  departments: string[];
  targets: Target[];
}

function selectCases(): Case[] {
  const chosen = HORIZON_RAG_GOLDEN_V1.filter(
    (c) =>
      CATEGORIES.has(c.category) &&
      c.targetEvidence.length > 0 &&
      (LANG === 'all' || c.language === LANG),
  );
  return chosen.map((c) => ({
    id: c.id,
    category: c.category,
    language: c.language,
    request: c.request,
    departments: [...c.allowedDepartments],
    targets: c.targetEvidence.map((t) => ({ titlePattern: t.titlePattern, requiredTerms: [...t.requiredTerms] })),
  }));
}

/**
 * Can the corpus satisfy this expectation AT ALL? Title regex against a visible document, and every
 * required term present in that document's chunk text.
 *
 * `section_path` is searched alongside `content` because the chunker lifts markdown headings out of
 * the body into `section_path` (`chunker.ts` headingText). Measured on this corpus: the word "tool"
 * appears in 29 chunk bodies and **56 section paths**, and "freshness" appears in 0 bodies and 1
 * section path — so checking `content` alone reports false negatives on any heading-only term.
 */
async function satisfiable(target: Target, departments: string[]): Promise<boolean> {
  // inArray, not a raw `= any(${array})`: the sql template flattens a JS array into one scalar
  // parameter, which silently compared department_access against the string "sales".
  const deptFilter = departments.length
    ? or(isNull(knowledgeDocs.departmentAccess), inArray(knowledgeDocs.departmentAccess, departments))
    : isNull(knowledgeDocs.departmentAccess);
  const termFilters = target.requiredTerms.map((term) =>
    or(ilike(knowledgeChunks.content, `%${term}%`), ilike(knowledgeChunks.sectionPath, `%${term}%`)),
  );
  const rows = await db
    .select({ docId: knowledgeDocs.id })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocs, eq(knowledgeDocs.id, knowledgeChunks.docId))
    .where(
      and(
        eq(knowledgeDocs.verificationStatus, 'verified'),
        sql`${knowledgeDocs.title} ~* ${target.titlePattern}`,
        deptFilter,
        ...termFilters,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

interface Attempt {
  /** The expected DOCUMENT came back — classic retrieval recall. */
  docHit: boolean;
  /** The expected document came back AND the returned chunks contain every required fact. */
  evidenceHit: boolean;
  /** 1-based rank of the first passage from the expected document, 0 when absent. */
  rank: number;
}

/** One attempt: one real agentic retrieval, scored per target. */
async function runAttempt(
  ctx: ReturnType<typeof effectiveRetrievalContext>,
  testCase: Case,
): Promise<Attempt[]> {
  const result = await agenticRetrieve(ctx, testCase.request, {
    k: K,
    // The agent's knowledge_search sets this; without it the intent router can abstain to 'tool' on a
    // keyword-shaped query and the attempt would score 0 for the wrong reason.
    explicitKnowledgeRequest: true,
    allowExternalSearch: false,
  });
  const passages = result.passages.map((p, index) => ({
    rank: index + 1,
    title: p.docTitle ?? '',
    text: `${p.content}\n${p.sectionPath ?? ''}`.toLowerCase(),
  }));

  return testCase.targets.map((target) => {
    const re = new RegExp(target.titlePattern, 'i');
    const matching = passages.filter((p) => re.test(p.title));
    if (matching.length === 0) return { docHit: false, evidenceHit: false, rank: 0 };
    const rank = Math.min(...matching.map((p) => p.rank));

    /**
     * Two levels, reported separately, because they fail for different reasons and want different
     * fixes. Measured example: "What does Automation C-16 do?" returns the Override document at
     * rank 1, but that chunk holds neither "30" nor "fraud hold" — those sit in a chunk top-5 did not
     * return. Retrieval was right; chunk coverage was not. Collapsing the two would have read as a
     * 79% retrieval problem and sent someone tuning similarity thresholds that are working fine.
     *
     * Terms may legitimately spread across several chunks of the same document, so the evidence check
     * unions the returned chunks of that document rather than demanding one chunk hold everything.
     */
    const byTitle = new Map<string, typeof matching>();
    for (const p of matching) {
      byTitle.set(p.title, [...(byTitle.get(p.title) ?? []), p]);
    }
    for (const group of byTitle.values()) {
      const joined = group.map((p) => p.text).join('\n');
      if (target.requiredTerms.every((term) => joined.includes(term.toLowerCase()))) {
        return { docHit: true, evidenceHit: true, rank };
      }
    }
    return { docHit: true, evidenceHit: false, rank };
  });
}

async function main(): Promise<void> {
  const cases = selectCases();
  if (cases.length === 0) throw new Error('no cases selected — check --lang and the category filter');

  const ctx = effectiveRetrievalContext(
    buildSystemContext([], { allDepartmentAccess: true }),
    salesAgent,
  );

  // ── preflight: refuse to score an expectation the corpus cannot meet ──
  const unsatisfiable: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    for (const t of c.targets) {
      const key = `${t.titlePattern}::${t.requiredTerms.join('|')}::${c.departments.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!(await satisfiable(t, c.departments))) {
        unsatisfiable.push(`${c.category} · /${t.titlePattern}/ · [${t.requiredTerms.join(', ')}]`);
      }
    }
  }
  if (unsatisfiable.length > 0) {
    process.stderr.write(
      `\nPREFLIGHT FAILED — ${unsatisfiable.length} expectation(s) cannot be satisfied by this corpus.\n` +
        `These are fixture or corpus bugs, not retrieval failures. Scoring them would report a\n` +
        `permanent failure floor and send the next reader tuning retrieval against a typo.\n\n` +
        unsatisfiable.map((u) => `  - ${u}`).join('\n') +
        '\n\nFix the expectation or sync the corpus, then re-run.\n\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `\nretrieval pass@k · ${cases.length} cases · ${ATTEMPTS} attempts · k=${K} · lang=${LANG}\n` +
      `preflight: all ${seen.size} distinct expectations are satisfiable\n\n`,
  );

  const rows: Array<{
    id: string; category: string; language: string;
    hits: number; docHits: number; ranks: number[];
  }> = [];
  for (const c of cases) {
    let hits = 0;
    let docHits = 0;
    const ranks: number[] = [];
    for (let a = 0; a < ATTEMPTS; a += 1) {
      const scored = await runAttempt(ctx, c);
      // A multi-target case counts only when EVERY target is satisfied.
      if (scored.every((s) => s.evidenceHit)) hits += 1;
      if (scored.every((s) => s.docHit)) docHits += 1;
      for (const s of scored) if (s.rank > 0) ranks.push(s.rank);
    }
    rows.push({ id: c.id, category: c.category, language: c.language, hits, docHits, ranks });
  }

  const total = rows.length;
  /** pass@k — the case succeeded on at least one of ATTEMPTS tries. */
  const passAtK = rows.filter((r) => r.hits >= 1).length;
  const hitAttempts = rows.reduce((sum, r) => sum + r.hits, 0);
  /** pass@1 — the expected rate for a single try, i.e. what one bench run samples. */
  const passAt1 = hitAttempts / (total * ATTEMPTS);
  const docAttempts = rows.reduce((sum, r) => sum + r.docHits, 0);
  const docPassAt1 = docAttempts / (total * ATTEMPTS);
  const docPassAtK = rows.filter((r) => r.docHits >= 1).length;
  /** Mean reciprocal rank of the best-ranked satisfying passage; 0 for a case never retrieved. */
  const mrr =
    rows.reduce((sum, r) => sum + (r.ranks.length > 0 ? 1 / Math.min(...r.ranks) : 0), 0) / total;

  if (AS_JSON) {
    process.stdout.write(
      `${JSON.stringify({ total, attempts: ATTEMPTS, k: K, docPassAtK, docPassAt1, passAtK, passAt1, mrr, rows }, null, 2)}\n`,
    );
    return;
  }

  const unstable = rows.filter((r) => r.hits > 0 && r.hits < ATTEMPTS);
  process.stdout.write(
    `DOCUMENT recall — did the expected document come back\n` +
      `  pass@${ATTEMPTS}  ${docPassAtK}/${total}      pass@1  ${(docPassAt1 * 100).toFixed(1)}%      MRR ${mrr.toFixed(3)}\n\n` +
      `EVIDENCE coverage — and did the returned chunks carry every required fact\n` +
      `  pass@${ATTEMPTS}  ${passAtK}/${total}      pass@1  ${(passAt1 * 100).toFixed(1)}%  (${hitAttempts}/${total * ATTEMPTS} attempts)\n\n` +
      `flaky cases    ${unstable.length}  (hit on some attempts, missed on others)\n` +
      `A gap between the two lines is a CHUNKING / k problem, not a retrieval one.\n\n`,
  );
  const noDoc = rows.filter((r) => r.docHits === 0);
  if (noDoc.length > 0) {
    process.stdout.write('document never retrieved (a real retrieval miss):\n');
    for (const r of noDoc) process.stdout.write(`  ${r.id}  ${r.category}  [${r.language}]\n`);
    process.stdout.write('\n');
  }
  const docNoEvidence = rows.filter((r) => r.docHits > 0 && r.hits === 0);
  if (docNoEvidence.length > 0) {
    process.stdout.write('document retrieved but required facts never in the returned chunks:\n');
    for (const r of docNoEvidence) process.stdout.write(`  ${r.id}  ${r.category}  [${r.language}]\n`);
    process.stdout.write('\n');
  }
  if (unstable.length > 0) {
    process.stdout.write('flaky:\n');
    for (const r of unstable) {
      process.stdout.write(`  ${r.id}  ${r.category}  [${r.language}]  ${r.hits}/${ATTEMPTS}\n`);
    }
    process.stdout.write('\n');
  }
  const byLang = new Map<string, { hits: number; attempts: number }>();
  for (const r of rows) {
    const slot = byLang.get(r.language) ?? { hits: 0, attempts: 0 };
    slot.hits += r.hits;
    slot.attempts += ATTEMPTS;
    byLang.set(r.language, slot);
  }
  if (byLang.size > 1) {
    process.stdout.write('by language:\n');
    for (const [lang, s] of [...byLang.entries()].sort()) {
      process.stdout.write(`  ${lang}  ${((s.hits / s.attempts) * 100).toFixed(1)}%  (${s.hits}/${s.attempts})\n`);
    }
    process.stdout.write('\n');
  }
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    await closeDb().catch(() => undefined);
    process.exitCode = 1;
  });
