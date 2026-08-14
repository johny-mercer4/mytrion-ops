import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUTOMATION_ORIGIN_SOURCES } from '../../db/schema/index.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { automationLogRepo } from '../../repos/automationLogRepo.js';
import { requireContext } from './helpers.js';

const logSchema = z.object({
  automationType: z.string().min(1).max(200),
  agentName: z.string().min(1).max(200).optional(),
  triggerTime: z.string().min(1).max(100).optional(),
  triggerDate: z.string().min(1).max(100).optional(),
  /**
   * Which surface fired it. OPTIONAL on purpose — the legacy Zoho widget posts here and will never
   * send this field, so an absent value falling back to 'Mytrion Zoho' is the correct reading of
   * an old caller, not a default papering over a new one. Horizon sends 'Mytrion Horizon'.
   */
  originSource: z.enum(AUTOMATION_ORIGIN_SOURCES).optional(),
});

/** Automation logging — front-end posts a trigger record; we insert it. Auth: API_KEY. */
export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/automation/logs', { onRequest: [app.sessionOrApiKey] }, async (request) => {
    const ctx = requireContext(request);
    const body = logSchema.parse(request.body);
    const log = await automationLogRepo.insert(ctx, body);
    // Audit WHO triggered WHICH automation — identity columns come from the session context.
    await auditFromContext(ctx, {
      action: 'automation.log',
      status: 'ok',
      resourceType: 'automation',
      resourceId: log.id,
      detail: {
        automationType: body.automationType,
        originSource: log.originSource,
        ...(body.agentName ? { agentName: body.agentName } : {}),
        ...(body.triggerTime ? { triggerTime: body.triggerTime } : {}),
        ...(body.triggerDate ? { triggerDate: body.triggerDate } : {}),
      },
    });
    return { id: log.id, createdAt: log.createdAt, originSource: log.originSource };
  });
}
