/**
 * Phase 4's authority lookup — its own route plugin, deliberately.
 *
 * `verificationFlow.routes.ts` is already 631 lines against the house 600-line cap, so it cannot take
 * another endpoint without making a failing CI gate worse. This is one route with one guard and one
 * audit line; a sibling file is the honest place for it, and it keeps the FMCSA/Socrata surface
 * findable rather than buried at line 600 of the desk's route table.
 *
 * WRITE-GATED even though the lookup itself only reads. It spends an outbound call to a federal
 * register and it writes the phase's findings row, so `requireMytrionWrite` is the right door — and
 * `auditFromContext` records it, which `/screening/run` still does not.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { deskService } from '../../modules/verificationFlow/deskService.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireMytrionWrite } from './helpers.js';

const idParams = z.object({ id: z.string().min(1) });

function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification underwriting');
}

export async function verificationAuthorityRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  /**
   * Read the register for this case and store what it said.
   *
   * Returns the whole desk detail, like every other desk write, because `CaseView.run` replaces the
   * detail wholesale — a partial response would blank the pane around the answer.
   */
  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/authority/run',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const detail = await deskService.runAuthorityLookup(ctx, id);
      // The audit detail names WHICH sources answered, because "the lookup ran" is not the useful
      // fact — off-Render the FMCSA half is denied at the edge and only Socrata replies, and a month
      // later nobody will remember which deployment a given case was screened from.
      const findings = detail.rail.find((phase) => phase.code === 'p4_authority')?.findings ?? {};
      const source = (key: string): boolean => {
        const block = (findings as Record<string, unknown>)[key];
        return typeof block === 'object' && block !== null
          ? (block as { available?: unknown }).available === true
          : false;
      };
      await auditFromContext(ctx, {
        action: 'verification.flow.authority_lookup',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: {
          register: source('register'),
          operatingAuthority: source('operatingAuthority'),
          census: source('census'),
          insurance: source('insurance'),
        },
      });
      return detail;
    },
  );
}
