import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUTOMATION_ORIGIN_SOURCES, AUTOMATION_TERMINAL_PHASES } from '../../db/schema/index.js';
import { RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { automationLogRepo } from '../../repos/automationLogRepo.js';
import { buildCallerContext } from './callerIdentity.js';

const logSchema = z
  .object({
    automationType: z.string().min(1).max(200),
    runId: z.string().uuid().optional(),
    phase: z.enum(AUTOMATION_TERMINAL_PHASES).optional(),
    durationMs: z.number().int().min(0).max(86_400_000).optional(),
    errorCode: z.enum([
      'timeout',
      'network',
      'authorization',
      'validation',
      'automation_failed',
    ]).optional(),
    agentName: z.string().min(1).max(200).optional(),
    triggerTime: z.string().min(1).max(100).optional(),
    triggerDate: z.string().min(1).max(100).optional(),
    /** Legacy Zoho omits this field; Horizon sends its own fixed value. */
    originSource: z.enum(AUTOMATION_ORIGIN_SOURCES).optional(),
  })
  .superRefine((value, ctx) => {
    const lifecycle = value.runId !== undefined || value.phase !== undefined;
    if (lifecycle && (!value.runId || !value.phase)) {
      ctx.addIssue({ code: 'custom', message: 'runId and phase are required together' });
    }
    if (value.phase && value.durationMs === undefined) {
      ctx.addIssue({ code: 'custom', message: 'terminal rows require durationMs' });
    }
    if (value.phase === 'failed' && !value.errorCode) {
      ctx.addIssue({ code: 'custom', message: 'failed rows require a coarse errorCode' });
    }
    if (value.phase === 'succeeded' && value.errorCode) {
      ctx.addIssue({ code: 'custom', message: 'succeeded rows cannot contain errorCode' });
    }
  });

/**
 * Automation logging — the legacy API-key widget and verified Sales sessions post ONE row per
 * submit, once the automation has finished (`succeeded` or `failed`).
 */
export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/automation/logs', { onRequest: [app.sessionOrApiKey] }, async (request) => {
    const body = logSchema.parse(request.body);
    const ctx = await buildCallerContext(request, {});
    request.ctx = ctx;
    const trustedSystemCaller = !ctx.sessionVerified && ctx.userId === 'system';
    if (
      ctx.audience !== 'internal' ||
      (!trustedSystemCaller &&
        !ctx.allDepartmentAccess &&
        !ctx.bypassRbac &&
        !ctx.departments.includes('sales'))
    ) {
      throw new RBACError('Sales Mytrion access is required to log an automation');
    }
    const { log, inserted } = await automationLogRepo.insert(ctx, {
      ...body,
      actorUserId: ctx.userId,
      ...(ctx.impersonatorUserId ? { impersonatorUserId: ctx.impersonatorUserId } : {}),
    });
    // Audit WHO triggered WHICH automation — identity columns come from the session context.
    if (inserted) {
      await auditFromContext(ctx, {
        action: 'automation.log',
        status: log.phase === 'failed' ? 'error' : 'ok',
        resourceType: 'automation',
        resourceId: log.id,
        detail: {
          automationType: body.automationType,
          originSource: log.originSource,
          runId: log.runId,
          phase: log.phase,
          ...(log.durationMs !== null ? { durationMs: log.durationMs } : {}),
          ...(log.errorCode ? { errorCode: log.errorCode } : {}),
        },
      });
    }
    return {
      id: log.id,
      runId: log.runId,
      phase: log.phase,
      createdAt: log.createdAt,
      originSource: log.originSource,
      replayed: !inserted,
    };
  });
}
