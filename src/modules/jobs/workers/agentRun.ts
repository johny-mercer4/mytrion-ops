/**
 * Worker for `agent.run`: executes an async agent turn under EXACTLY the requester's context
 * (embedded in the payload — never widened here). Task-row transitions guard re-delivery:
 * a completed/cancelled task acks without re-running.
 */
import type { Job } from 'pg-boss';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { agentTaskRepo } from '../../../repos/agentTaskRepo.js';
import { runAgentTurn } from '../../agents/orchestratorService.js';
import { agentRunJob, payloadToContext } from '../catalog.js';

export async function handleAgentRunJobs(jobs: Job<unknown>[]): Promise<void> {
  for (const job of jobs) {
    const payload = agentRunJob.schema.parse(job.data);
    const ctx = payloadToContext(payload.ctx);
    const { taskId } = payload;
    const claimed = await agentTaskRepo.markRunning(ctx, taskId);
    if (!claimed) {
      logger.info({ taskId }, 'agent.run: task already finished/cancelled — acking re-delivery');
      continue;
    }
    try {
      const result = await runAgentTurn(payload.message, ctx, {
        ...(payload.agent ? { agent: payload.agent } : {}),
        ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
        ...(ctx.userName ? { userName: ctx.userName } : {}),
      });
      await agentTaskRepo.complete(ctx, taskId, {
        answer: result.message,
        conversationId: result.conversationId,
        agentKey: result.agentKey,
        agentPath: result.agentPath,
        toolCalls: result.toolCalls,
        usage: result.usage,
      });
    } catch (err) {
      const message = errorMessage(err);
      await agentTaskRepo.fail(ctx, taskId, message);
      logger.warn({ taskId, err: message }, 'agent.run task failed');
      throw err; // let pg-boss retry / dead-letter; markRunning re-claims from 'failed'
    }
  }
}
