/**
 * Maintenance workers: checkpoint TTL sweep (delete LangGraph threads idle longer than
 * AGENT_CHECKPOINT_TTL_DAYS) and the dead-letter sink (audit + mark the linked task failed).
 */
import type { Job } from 'pg-boss';
import { env } from '../../../config/env.js';
import { pg } from '../../../db/client.js';
import { logger } from '../../../lib/logger.js';
import { agentTaskRepo } from '../../../repos/agentTaskRepo.js';
import { audit } from '../../audit/auditLogger.js';
import { CHECKPOINT_SCHEMA } from '../../agents/checkpointer.js';
import { DEFAULT_TENANT_ID } from '../../../config/constants.js';
import { buildSystemContext } from '../systemContext.js';

/**
 * The checkpointer tables carry no created_at column; each checkpoint's payload has an ISO
 * `ts`. A thread is stale when its NEWEST checkpoint is older than the TTL — all three
 * checkpoint tables are purged for those threads.
 */
export async function sweepStaleCheckpoints(): Promise<void> {
  if (!env.FF_AGENT_CHECKPOINTS) return;
  const ttlDays = env.AGENT_CHECKPOINT_TTL_DAYS;
  try {
    const stale = await pg<{ thread_id: string }[]>`
      SELECT thread_id
      FROM ${pg(CHECKPOINT_SCHEMA)}.checkpoints
      GROUP BY thread_id
      HAVING max((checkpoint->>'ts')::timestamptz) < now() - make_interval(days => ${ttlDays})
    `;
    if (stale.length === 0) return;
    const ids = stale.map((r) => r.thread_id);
    await pg`DELETE FROM ${pg(CHECKPOINT_SCHEMA)}.checkpoint_writes WHERE thread_id = ANY(${ids})`;
    await pg`DELETE FROM ${pg(CHECKPOINT_SCHEMA)}.checkpoint_blobs WHERE thread_id = ANY(${ids})`;
    await pg`DELETE FROM ${pg(CHECKPOINT_SCHEMA)}.checkpoints WHERE thread_id = ANY(${ids})`;
    logger.info({ threads: ids.length, ttlDays }, 'checkpoint TTL sweep: purged stale threads');
  } catch (err) {
    // The schema may not exist yet (flag flipped without a release migration) — log, don't fail.
    logger.warn({ err }, 'checkpoint TTL sweep failed');
  }
}

/** Hourly: expire pending approvals past their TTL (audited count only). */
export async function sweepExpiredApprovals(): Promise<void> {
  const { approvalRepo } = await import('../../../repos/approvalRepo.js');
  const expired = await approvalRepo.expireStale();
  if (expired > 0) logger.info({ expired }, 'expired stale write-approvals');
}

/** Nightly agent-memory decay/eviction (no-op when the flag is off). */
export async function decayAgentMemories(): Promise<void> {
  if (!env.FF_AGENT_MEMORY) return;
  const { memoryRepo } = await import('../../../repos/memoryRepo.js');
  const removed = await memoryRepo.decayAndEvict(env.AGENT_MEMORY_HALFLIFE_DAYS);
  if (removed > 0) logger.info({ removed }, 'agent-memory decay evicted rows');
}

export async function handleDeadLetterJobs(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const data = (job.data ?? {}) as { taskId?: string; ctx?: { tenantId?: string } };
    logger.error({ deadJob: job.id, data }, 'job dead-lettered');
    await audit({
      tenantId: data.ctx?.tenantId ?? DEFAULT_TENANT_ID,
      action: 'job.dead',
      status: 'error',
      detail: { jobId: job.id, taskId: data.taskId ?? null },
    });
    if (data.taskId && data.ctx?.tenantId) {
      const ctx = { ...buildSystemContext([]), tenantId: data.ctx.tenantId };
      await agentTaskRepo.fail(ctx, data.taskId, 'job dead-lettered after retries');
    }
  }
}
