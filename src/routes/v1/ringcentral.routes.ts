/**
 * RingCentral Embeddable bootstrap for the desk-phone Mytrions.
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
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { collectionActivityRepo } from '../../repos/collectionActivityRepo.js';
import { mytrionCallRepo } from '../../repos/mytrionCallRepo.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { updateRecordAsUser, zohoActorId } from '../../integrations/zohoUserAuth.js';
import type { MytrionCallSourceType } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildCallerContext } from './callerIdentity.js';

/**
 * Departments whose agents get a softphone.
 *
 * KEEP IN STEP with `RC_ALLOWED_MYTRIONS` in
 * `apps/mytrion-crm/src/components/ringcentral/rcRouteGate.ts` — these two lists are the client and
 * server halves of one decision, and they drifted: `collection` was added to the client set but not
 * here, so a Collection agent passed the route gate, booted the widget, and got an RBAC refusal on
 * `/embed-config` that the caller swallows silently. The symptom was "the phone just doesn't work in
 * Collection", with nothing in the console.
 */
const RC_SOFTPHONE_DEPARTMENTS = ['sales', 'customer-service', 'collection'] as const;

/**
 * Softphone is used from the Sales, Customer Service and Collection Mytrions.
 * Applies View-as (x-act-as-*) so call-log rows attribute to the desk agent, not the admin.
 */
async function requireSoftphoneAccess(request: FastifyRequest): Promise<TenantContext> {
  const ctx = await buildCallerContext(request, {});
  request.ctx = ctx;
  if (ctx.audience !== 'internal') throw new RBACError('RingCentral phone is internal-only');
  const ok =
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    RC_SOFTPHONE_DEPARTMENTS.some((department) => ctx.departments.includes(department));
  if (!ok) {
    throw new RBACError(
      `RingCentral phone requires ${RC_SOFTPHONE_DEPARTMENTS.join(', ')} department access`,
    );
  }
  return ctx;
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
  collectionCaseId: z.string().max(80).optional(),
});

type CallEventBody = z.infer<typeof callEventSchema>;

/** Map a finished outbound call's dial context to its source record. Most specific owner first:
 *  a collection or retention call to a deal carries both ids, and the case is what the agent was
 *  actually working. Then lead, then deal. */
function callSource(
  body: CallEventBody,
): { sourceType: MytrionCallSourceType; sourceId: string } | null {
  if (body.collectionCaseId)
    return { sourceType: 'collection_case', sourceId: body.collectionCaseId };
  if (body.retentionCaseId) return { sourceType: 'retention_case', sourceId: body.retentionCaseId };
  if (body.leadId) return { sourceType: 'lead', sourceId: body.leadId };
  if (body.dealId) return { sourceType: 'deal', sourceId: body.dealId };
  return null;
}

/**
 * Effective agent on the request (View-as target when impersonating). Call Hub is agent-scoped,
 * so dials made while viewing as a rep must land on that rep's `mytrion_calls` rows.
 */
function callerZohoUserId(ctx: TenantContext): string {
  if (!ctx.userId.startsWith('zoho:')) {
    throw new RBACError('A verified Zoho worker session is required to log calls');
  }
  return ctx.userId.slice('zoho:'.length);
}

/**
 * The Zoho record whose `Mytrion_Call_Attempts` counter this call increments — the dialed Lead
 * (preferred) or Deal. Retention calls carry the deal id, so they count under the Deal. The Lead's
 * First/Second/Third-Call *Status* is set by Zoho's own Calls workflow (fed by the native RingCentral
 * → Zoho call log), not here.
 */
function callAttemptsTarget(body: CallEventBody): { module: 'Leads' | 'Deals'; id: string } | null {
  if (body.leadId) return { module: 'Leads', id: body.leadId };
  if (body.dealId) return { module: 'Deals', id: body.dealId };
  return null;
}

export async function ringcentralRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/ringcentral/embed-config', guard, async (request) => {
    const ctx = await requireSoftphoneAccess(request);
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
    const ctx = await requireSoftphoneAccess(request);
    const body = callEventSchema.parse(request.body ?? {});
    await auditFromContext(ctx, {
      action: 'ringcentral.call_event',
      status: 'ok',
      resourceType: 'ringcentral_call',
      ...(body.sessionId ? { resourceId: body.sessionId } : {}),
      detail: { ...body },
    });

    // For a FINISHED OUTBOUND call (the only ones agents initiate): (1) keep our own accurate call
    // log — Zoho's native RingCentral call log is unreliable on duration; (2) bump the dialed
    // Lead/Deal's Mytrion_Call_Attempts counter in Zoho. We no longer create the Zoho Call record
    // (the native RC→Zoho integration does) nor advance the First/Second/Third-Call Status (Zoho's
    // Calls workflow owns that). Every step is best-effort — a failure must not fail the event POST.
    if (body.kind === 'ended' && body.direction === 'Outbound') {
      const source = callSource(body);
      const durationMs = body.durationMs ?? 0;
      // No explicit answered flag in RC events — derive: talk time or a "connected" result.
      const pickedUp = durationMs > 0 || /connect/i.test(body.result ?? '');

      try {
        await mytrionCallRepo.create(ctx, {
          callerZohoUserId: callerZohoUserId(ctx),
          phoneNumber: body.to ?? null,
          ...(body.startTime && !Number.isNaN(Date.parse(body.startTime))
            ? { callTime: new Date(body.startTime) }
            : {}),
          durationSeconds: Math.round(durationMs / 1000),
          callStatus: pickedUp ? 'picked_up' : 'missed',
          sourceType: source?.sourceType ?? null,
          sourceId: source?.sourceId ?? null,
          sessionId: body.sessionId ?? null,
          direction: body.direction,
          result: body.result ?? null,
        });
      } catch (err) {
        request.log.warn({ err }, 'mytrion_calls insert failed (call event still audited)');
      }

      /**
       * A collection call writes itself onto the case timeline.
       *
       * Everywhere else in the desk a contact entry is typed by hand, and it still can be — the Log
       * contact dialog is how a call placed on a mobile, or one that needs an outcome more precise
       * than "answered", gets recorded. But a collector who dials from the desk should not then have
       * to tell the desk they dialled. This entry carries the two things only the softphone knows:
       * how long it lasted, and whether anyone picked up.
       *
       * `reached` vs `no_answer` is the honest limit of what a call event can tell us — voicemail,
       * wrong number and refusal are judgements, and they stay with the human.
       */
      if (body.collectionCaseId) {
        try {
          const minutes = Math.floor(durationMs / 60_000);
          const seconds = Math.round((durationMs % 60_000) / 1000);
          const spoken = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          await collectionActivityRepo.insert({
            caseId: body.collectionCaseId,
            kind: 'contact',
            channel: 'call',
            outcome: pickedUp ? 'reached' : 'no_answer',
            summary: pickedUp
              ? `Called ${body.to ?? 'the debtor'} — answered, ${spoken}`
              : `Called ${body.to ?? 'the debtor'} — no answer`,
            meta: { via: 'ringcentral', sessionId: body.sessionId, durationMs },
            ...(ctx.userId !== undefined ? { actorUserId: ctx.userId } : {}),
            ...(ctx.userName !== undefined ? { actorName: ctx.userName } : {}),
          });
        } catch (err) {
          request.log.warn({ err }, 'collection activity insert failed (call still logged)');
        }
      }

      // Increment the dialed Lead/Deal's "calls from Mytrion" counter (read current + 1). This field
      // is ours-only, so the read-modify-write race is negligible for one agent's sequential calls.
      const target = callAttemptsTarget(body);
      if (target) {
        try {
          const rec = await zohoCrmRecords.getRecord(target.module, target.id);
          const cur = rec ? Number(rec.Mytrion_Call_Attempts) : 0;
          const next = (Number.isFinite(cur) ? cur : 0) + 1;
          await updateRecordAsUser(ctx.tenantId, zohoActorId(ctx), target.module, target.id, {
            Mytrion_Call_Attempts: next,
          });
        } catch (err) {
          request.log.warn({ err }, 'Mytrion_Call_Attempts increment failed (call still logged)');
        }
      }
    }

    reply.code(202);
    return { ok: true };
  });
}
