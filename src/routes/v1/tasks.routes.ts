/**
 * Async agent tasks: enqueue an agent run as a background job, poll or stream its progress,
 * cancel it. Same caller-identity RBAC as /v1/agent; agent selection is checked at enqueue
 * time (fail fast) AND re-checked inside the run.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { sseCorsHeaders } from '../../lib/cors.js';
import { AppError, NotFoundError, RBACError } from '../../lib/errors.js';
import { agentRegistry } from '../../modules/agents/agentRegistry.js';
import { AGENT_KEYS, isAgentKey } from '../../modules/agents/types.js';
import { startSSE } from '../../modules/chat/streaming.js';
import { jobsEnabled } from '../../modules/jobs/boss.js';
import { agentRunJob } from '../../modules/jobs/catalog.js';
import { enqueue } from '../../modules/jobs/queue.js';
import { jobCounts, recentFailures } from '../../modules/jobs/status.js';
import { agentTaskRepo } from '../../repos/agentTaskRepo.js';
import type { AgentTask } from '../../db/schema/index.js';
import { buildCallerContext, callerIdentitySchema } from './callerIdentity.js';

const createTaskSchema = callerIdentitySchema.extend({
  message: z.string().min(1).max(8000),
  agent: z.enum(AGENT_KEYS).optional(),
  conversationId: z.string().min(1).max(100).optional(),
});

const STREAM_POLL_MS = 1500;
const STREAM_MAX_MS = 10 * 60 * 1000;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function taskDto(t: AgentTask) {
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    progress: t.progress,
    result: t.result ?? null,
    error: t.error ?? null,
    conversationId: t.conversationId ?? null,
    createdAt: t.createdAt.toISOString(),
    startedAt: t.startedAt ? t.startedAt.toISOString() : null,
    finishedAt: t.finishedAt ? t.finishedAt.toISOString() : null,
  };
}

function requireJobs(): void {
  if (!jobsEnabled()) {
    throw new AppError('Background tasks are disabled (set FF_JOBS_ENABLED).', {
      statusCode: 503,
      code: 'FEATURE_DISABLED',
    });
  }
}

/** Async agent runs are still ORCHESTRATOR runs — gate them on the orchestrator flag too. */
function requireOrchestrator(): void {
  if (!env.FF_ORCHESTRATOR_ENABLED && !env.FF_DEEP_AGENTS_ENABLED) {
    throw new AppError('Agent runs are disabled (set FF_ORCHESTRATOR_ENABLED).', {
      statusCode: 503,
      code: 'FEATURE_DISABLED',
    });
  }
}

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.post('/agent/tasks', guard, async (request, reply) => {
    requireJobs();
    requireOrchestrator();
    const body = createTaskSchema.parse(request.body);
    const ctx = buildCallerContext(request, body);
    if (body.agent) {
      const manifest = isAgentKey(body.agent) ? agentRegistry.get(body.agent) : undefined;
      const access = manifest ? agentRegistry.checkAccess(manifest, ctx) : { ok: false as const };
      if (!manifest || !access.ok) {
        throw new RBACError(('reason' in access ? access.reason : undefined) ?? `Access to agent '${body.agent}' denied`);
      }
    }
    const task = await agentTaskRepo.create(ctx, {
      userId: ctx.userId,
      kind: 'agent.run',
      queue: agentRunJob.name,
      request: { message: body.message, ...(body.agent ? { agent: body.agent } : {}) },
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
    });
    const jobId = await enqueue(
      agentRunJob,
      {
        taskId: task.id,
        ctx,
        message: body.message,
        ...(body.agent ? { agent: body.agent } : {}),
        ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      },
      { singletonKey: task.id },
    );
    await agentTaskRepo.setJobId(ctx, task.id, jobId);
    void reply.code(202);
    return { taskId: task.id, status: 'queued' };
  });

  app.get('/agent/tasks', guard, async (request) => {
    requireJobs();
    const q = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    const tasks = await agentTaskRepo.listForRequester(ctx, q.limit ?? 30);
    return { tasks: tasks.map(taskDto) };
  });

  app.get<{ Params: { id: string } }>('/agent/tasks/:id', guard, async (request) => {
    requireJobs();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    const task = await agentTaskRepo.findById(ctx, request.params.id);
    if (!task) throw new NotFoundError('Task not found');
    return { task: taskDto(task) };
  });

  // SSE progress: polls the (indexed) task row — works across multiple instances.
  app.get<{ Params: { id: string } }>('/agent/tasks/:id/stream', guard, async (request, reply) => {
    requireJobs();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    const first = await agentTaskRepo.findById(ctx, request.params.id);
    if (!first) throw new NotFoundError('Task not found');

    const sse = startSSE(reply, sseCorsHeaders(request.headers.origin));
    try {
      sse.send('task', taskDto(first));
      const deadline = Date.now() + STREAM_MAX_MS;
      let last = first;
      while (!TERMINAL.has(last.status) && Date.now() < deadline && !request.raw.destroyed) {
        await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
        const current = await agentTaskRepo.findById(ctx, request.params.id);
        if (!current) break;
        if (current.status !== last.status || current.updatedAt.getTime() !== last.updatedAt.getTime()) {
          sse.send(TERMINAL.has(current.status) ? 'done' : 'progress', taskDto(current));
        } else {
          sse.comment('keep-alive');
        }
        last = current;
      }
      if (!TERMINAL.has(last.status)) sse.send('timeout', { taskId: last.id, status: last.status });
    } finally {
      sse.close();
    }
    return reply;
  });

  app.post<{ Params: { id: string } }>('/agent/tasks/:id/cancel', guard, async (request) => {
    requireJobs();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.body ?? {}));
    const cancelled = await agentTaskRepo.cancel(ctx, request.params.id);
    if (!cancelled) throw new NotFoundError('Task not found or not cancellable');
    if (cancelled.jobId) {
      const { getBoss } = await import('../../modules/jobs/boss.js');
      try {
        await getBoss().cancel(cancelled.queue, cancelled.jobId);
      } catch {
        // Job may already be active/finished — the task row's cancelled state is authoritative
        // for the re-delivery guard.
      }
    }
    return { cancelled: true, task: taskDto(cancelled) };
  });

  // Queue/state counts + recent failures — admin (allDepartmentAccess) only.
  app.get('/agent/jobs/stats', guard, async (request) => {
    requireJobs();
    const ctx = buildCallerContext(request, callerIdentitySchema.parse(request.query));
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      throw new RBACError('Job stats require all-department (admin) access');
    }
    const [counts, failures] = await Promise.all([jobCounts(), recentFailures()]);
    return { counts, failures };
  });
}
