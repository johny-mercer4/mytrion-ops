import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  supportBotMemoryRepo,
  type SupportBotMemoryScope,
} from '../../repos/supportBotMemoryRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { embedQuery } from '../knowledge/embedder.js';

const MAX_MEMORY_TEXT = 2_000;

/** Remove identifiers and financial/card secrets before text ever reaches an embedding API. */
export function sanitizeSupportBotMemoryText(input: string): string {
  return input
    .replace(
      /^\[(?:msg \d+ from|button tap from) .+? \(id \d+\)\]:\s*/u,
      '',
    )
    .replace(/\$\s?\d[\d,.]*/gu, '[REDACTED_AMOUNT]')
    .replace(
      /\b(pin|money[\s-]?code|manual[\s-]?code)\s*[:#=-]?\s*[A-Z0-9-]{3,}\b/giu,
      '$1 [REDACTED_SECRET]',
    )
    .replace(/(?:\d[\s-]?){4,}/gu, '[REDACTED_NUMBER]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_MEMORY_TEXT);
}

export function buildSupportBotTurnMemory(
  question: string,
  answer: string,
): string | null {
  const cleanQuestion = sanitizeSupportBotMemoryText(question);
  const cleanAnswer = sanitizeSupportBotMemoryText(answer);
  if (
    cleanQuestion.length < 3 ||
    !cleanAnswer ||
    cleanAnswer === 'SILENT' ||
    /^(hi|hello|hey|salom|rahmat|thanks|thank you)[!. ]*$/iu.test(cleanQuestion)
  ) {
    return null;
  }
  return `User asked: ${cleanQuestion}\nAssistant answered: ${cleanAnswer}`.slice(
    0,
    MAX_MEMORY_TEXT,
  );
}

export async function recallSupportBotMemory(
  ctx: TenantContext,
  scope: SupportBotMemoryScope,
  query: string,
  requestedK?: number,
) {
  if (!env.FF_SUPPORT_BOT_MEMORY) return [];
  const cleanQuery = sanitizeSupportBotMemoryText(query);
  if (cleanQuery.length < 3) return [];
  const embedding = await embedQuery(cleanQuery);
  const k = Math.min(
    requestedK ?? env.SUPPORT_BOT_MEMORY_TOP_K,
    env.SUPPORT_BOT_MEMORY_TOP_K,
  );
  const rows = await supportBotMemoryRepo.search(ctx, scope, embedding, k);
  return rows
    .filter((row) => row.score >= env.SUPPORT_BOT_MEMORY_MIN_SCORE)
    .map((row) => ({
      content: row.content,
      score: row.score,
      createdAt: row.createdAt,
    }));
}

export async function commitSupportBotMemory(
  ctx: TenantContext,
  scope: SupportBotMemoryScope,
  question: string,
  answer: string,
): Promise<boolean> {
  if (!env.FF_SUPPORT_BOT_MEMORY) return false;
  const content = buildSupportBotTurnMemory(question, answer);
  if (!content) return false;
  const embedding = await embedQuery(content);
  const sourceHash = createHash('sha256').update(content).digest('hex');
  const expiresAt = new Date(
    Date.now() + env.SUPPORT_BOT_MEMORY_TTL_DAYS * 86_400_000,
  );
  const inserted = await supportBotMemoryRepo.insert(ctx, scope, {
    content,
    embedding,
    sourceHash,
    expiresAt,
  });
  await supportBotMemoryRepo.evictBeyondCap(
    ctx,
    scope,
    env.SUPPORT_BOT_MEMORY_MAX_PER_USER,
  );
  return inserted !== null;
}
