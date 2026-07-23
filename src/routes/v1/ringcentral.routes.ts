/**
 * RingCentral Embeddable bootstrap for Sales Mytrion.
 *
 * GET /v1/ringcentral/embed-config — returns the config needed to load the Embeddable adapter.
 * By default the shared client secret + org JWT are NOT included (the adapter loads; agents
 * sign in via RingCentral's own login). RINGCENTRAL_BROWSER_CREDS_ACK=1 restores the Phase-1
 * JWT auto-login — a deliberate, audited ops decision to ship shared credentials to every
 * sales browser. Secrets must never be baked into the Vite bundle either way.
 *
 * Auth note: JWT login makes every agent the same RingCentral extension (experimental for
 * Embeddable). Switch to per-agent OAuth/PKCE before multi-extension prod.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ringcentral } from '../../integrations/ringcentral.js';
import { NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { mytrionCallRepo } from '../../repos/mytrionCallRepo.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import type { MytrionCallSourceType } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'RingCentral phone');
}

/**
 * A single call-lifecycle event forwarded from the Sales softphone. The Embeddable widget streams
 * these over postMessage (ringing → connected → ended, plus sign-in status); the browser normalizes
 * each into this shape so the backend can audit "which number, when, how it ended".
 */
const callEventSchema = z.object({
  kind: z.enum(['ringing', 'connected', 'ended', 'login', 'logout']),
  sessionId: z.string().max(128).optional(),
  direction: z.enum(['Inbound', 'Outbound']).optional(),
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
  telephonyStatus: z.string().max(48).optional(),
  result: z.string().max(64).optional(),
  startTime: z.string().max(48).optional(),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  leadId: z.string().max(64).optional(),
  dealId: z.string().max(64).optional(),
  retentionCaseId: z.string().max(64).optional(),
});

type CallEventBody = z.infer<typeof callEventSchema>;

/** Map a finished outbound call's dial context to its source record. Lead first, then deal, then
 *  retention case (a retention call to a deal carries both — the case is the more specific owner). */
function callSource(body: CallEventBody): { sourceType: MytrionCallSourceType; sourceId: string } | null {
  if (body.retentionCaseId) return { sourceType: 'retention_case', sourceId: body.retentionCaseId };
  if (body.leadId) return { sourceType: 'lead', sourceId: body.leadId };
  if (body.dealId) return { sourceType: 'deal', sourceId: body.dealId };
  return null;
}

/** Zoho user id of the caller from the session principal (`zoho:<id>`), else the raw userId. */
function callerZohoUserId(ctx: TenantContext): string {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : ctx.userId;
}

/** Statuses a call must NOT overwrite — a categorized lead is left alone (never un-categorized). */
const LEAD_TERMINAL_STATUSES = new Set([
  'Interested',
  'Not Interested',
  'Follow-up',
  'Email Follow-Up',
  'Unqualified',
  'Application Filled',
]);

/** Call-log count → the Zoho Lead call-number status (capped at Third Call). */
function callStatusForCount(count: number): string {
  if (count <= 1) return 'First Call';
  if (count === 2) return 'Second Call';
  return 'Third Call';
}

export async function ringcentralRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/ringcentral/embed-config', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    if (!ringcentral.isConfigured()) {
      throw new NotFoundError(
        'RingCentral is not configured (set FF_RINGCENTRAL_ENABLED=1 and RINGCENTRAL_CLIENT_ID).',
      );
    }

    const { browserCreds, ...config } = ringcentral.embedConfig();
    if (browserCreds) {
      // Shared org credentials leave the server — keep an audit trail of who fetched them.
      await auditFromContext(ctx, {
        action: 'ringcentral.embed_config',
        status: 'ok',
        resourceType: 'ringcentral',
        detail: { browserCreds: true },
      });
    } else {
      request.log.warn(
        'ringcentral embed-config served WITHOUT browser credentials (JWT auto-login off); ' +
          'set RINGCENTRAL_BROWSER_CREDS_ACK=1 to knowingly restore the Phase-1 behavior',
      );
    }
    return config;
  });

  // Capture call-lifecycle events from the Sales softphone (ringing/connected/ended + sign-in) into
  // the audit trail. Best-effort, sales-guarded; the widget forwards each postMessage event here so
  // there is a server-side record of who called which number and when it ended.
  app.post('/ringcentral/call-events', guard, async (request, reply) => {
    const ctx = requireSalesAccess(request);
    const body = callEventSchema.parse(request.body ?? {});
    await auditFromContext(ctx, {
      action: 'ringcentral.call_event',
      status: 'ok',
      resourceType: 'ringcentral_call',
      ...(body.sessionId ? { resourceId: body.sessionId } : {}),
      detail: { ...body },
    });

    // Persist one mytrion_calls row per FINISHED OUTBOUND call (the only ones agents initiate).
    // Best-effort: a logging failure must never fail the event POST (the client swallows errors).
    if (body.kind === 'ended' && body.direction === 'Outbound') {
      const source = callSource(body);
      if (source) {
        try {
          const durationMs = body.durationMs ?? 0;
          // No explicit answered flag in RC events — derive: talk time or a "connected" result.
          const pickedUp = durationMs > 0 || /connect/i.test(body.result ?? '');
          await mytrionCallRepo.create(ctx, {
            callerZohoUserId: callerZohoUserId(ctx),
            phoneNumber: body.to ?? null,
            ...(body.startTime && !Number.isNaN(Date.parse(body.startTime))
              ? { callTime: new Date(body.startTime) }
              : {}),
            durationSeconds: Math.round(durationMs / 1000),
            callStatus: pickedUp ? 'picked_up' : 'missed',
            sourceType: source.sourceType,
            sourceId: source.sourceId,
            sessionId: body.sessionId ?? null,
            direction: body.direction,
            result: body.result ?? null,
          });
        } catch (err) {
          request.log.warn({ err }, 'mytrion_calls insert failed (call event still audited)');
        }

        // Auto-advance the Lead's call number (First/Second/Third) from the call-log count. Call
        // statuses are never set by hand — here they follow the logs. Skip a categorized lead
        // (outcome / Application Filled) so a later call never un-categorizes it.
        if (source.sourceType === 'lead') {
          try {
            const callCount = await mytrionCallRepo.countForSource(ctx, 'lead', source.sourceId);
            const target = callStatusForCount(callCount);
            const rec = await zohoCrmRecords.getRecord('Leads', source.sourceId);
            const cur = rec && typeof rec.Status === 'string' ? rec.Status : '';
            if (!LEAD_TERMINAL_STATUSES.has(cur) && cur !== target) {
              await zohoCrmRecords.updateRecord('Leads', source.sourceId, { Status: target });
            }
          } catch (err) {
            request.log.warn({ err }, 'lead call-status auto-advance failed (call still logged)');
          }
        }
      }
    }

    reply.code(202);
    return { ok: true };
  });
}
