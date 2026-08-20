/**
 * Agent self-service (/v1/comms/me) — the signed-in worker's own presence controls.
 *
 * Availability is DECLARED, durable, and already governs the round-robin: `assignment.ts` filters the
 * roster to agents whose availability is 'available', so setting 'away' or 'do_not_assign' here stops
 * new tickets landing on you without taking you off the roster. Always keyed to the caller's own Zoho
 * id from the verified session — there is no path to set someone else's status.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { readerOf } from '../../modules/comms/dto.js';
import { RBACError } from '../../lib/errors.js';
import { agentPresenceRepo } from '../../repos/agentPresenceRepo.js';
import { requireInternal } from './helpers.js';

const setBody = z.object({
  availability: z.enum(['available', 'away', 'do_not_assign']),
  note: z.string().max(200).optional(),
});

export async function commsAgentRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/comms/me/availability', guard, async (request) => {
    const ctx = requireInternal(request, 'Agent availability');
    const me = readerOf(ctx).actorZohoUserId;
    if (!me) throw new RBACError('Availability requires a signed-in worker identity.');
    return { availability: await agentPresenceRepo.getAvailability(ctx, me) };
  });

  app.post('/comms/me/availability', guard, async (request) => {
    const ctx = requireInternal(request, 'Agent availability');
    const me = readerOf(ctx).actorZohoUserId;
    if (!me) throw new RBACError('Availability requires a signed-in worker identity.');
    const body = setBody.parse(request.body);

    // A caller-initiated change always clears auto-away — this is the agent opting back in.
    const updated = await agentPresenceRepo.setAvailability(ctx, me, {
      availability: body.availability,
      note: body.note ?? null,
      autoAway: false,
    });

    await auditFromContext(ctx, {
      action: 'comms.agent.availability',
      status: 'ok',
      resourceType: 'comms_agent',
      resourceId: me,
      detail: { availability: body.availability },
    });

    return { availability: updated };
  });
}
