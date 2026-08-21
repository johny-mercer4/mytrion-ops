/**
 * The two CARRIER-ONLY phase surfaces — Phase 4's authority lookup and Phase 8's Highway review —
 * plus the Data Center FMCSA (QCMobile), Motus (Socrata), and Broker Snapshot (DWH)
 * searches, which read the same sources without writing findings.
 *
 * Both writes belong to the phases that apply to carriers alone, and both were kept out of
 * `verificationFlow.routes.ts` because that file already sits over the house 600-line cap and cannot
 * take another endpoint without making a failing gate worse. Grouping them here also keeps the carrier
 * surface findable rather than buried at line 600 of the desk's route table.
 *
 * Phase 4 spends an outbound call to a federal register; Phase 8 writes the findings the underwriting
 * summary reads. Either way `requireMytrionWrite` is the right door — and `auditFromContext` records
 * it, which `/screening/run` still does not. The Data Center search is read-only: department gate,
 * no audit, no case write-back.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { lookupFmcsaCarrier } from '../../integrations/fmcsaQcMobile.js';
import { searchBrokerSnapshot } from '../../modules/verificationFlow/brokerSnapshotSearch.js';
import { searchMotus } from '../../modules/verificationFlow/motusSearch.js';
import { deskService } from '../../modules/verificationFlow/deskService.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

const idParams = z.object({ id: z.string().min(1) });

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification underwriting');
}
function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification underwriting');
}

/**
 * QCMobile's own keys, not a fuzzy box. `/carriers/{dot}`, `/carriers/docket-number/{mc}` and
 * `/carriers/name/{name}` are three endpoints; `lookupFmcsaCarrier` already talks to each when
 * given only that key.
 */
const fmcsaSearchQuery = z.object({
  by: z.enum(['dot', 'mc', 'name']),
  q: z.string().trim().min(1).max(160),
});

/** USDOT and legal name only — insurance / BOC-3 have no MC or name client. */
const motusSearchQuery = z.object({
  by: z.enum(['dot', 'name']),
  q: z.string().trim().min(1).max(160),
});

/** USDOT and owner name only — `stg_broker_snapshot` has no MC column. */
const brokerSnapshotSearchQuery = z.object({
  by: z.enum(['dot', 'name']),
  q: z.string().trim().min(1).max(160),
});

/**
 * Phase 8's review, typed by hand off Highway. Optional and nullable throughout: it is filled over
 * more than one sitting, and a figure Highway does not show has to be storable as absent rather than
 * as zero. `passthrough` is deliberate — the field set mirrors the warehouse Highway snapshot's
 * columns and will grow when a parser lands, and a strict object would reject the pane the day it does.
 */
const highwayBody = z
  .object({
    safetyRating: z.string().trim().max(120).nullable().optional(),
    safetyCsaPercentile: z.coerce.number().min(0).max(100).nullable().optional(),
    safetyTotalViolations: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    safetyTrend: z.enum(['improving', 'stable', 'deteriorating']).nullable().optional(),
    bluewireScore: z.coerce.number().min(0).max(1000).nullable().optional(),
    observedPowerUnits: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    reportedPowerUnits: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    connectedTrucks: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
    eldStatus: z.enum(['connected', 'not_connected', 'unknown']).nullable().optional(),
    insuranceLimit: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
    insuranceExpiry: z.string().trim().max(40).nullable().optional(),
    authorityAgeMonths: z.coerce.number().int().min(0).max(2400).nullable().optional(),
    operatingStatus: z.string().trim().max(160).nullable().optional(),
    currentActivity: z.enum(['active', 'limited', 'none']).nullable().optional(),
    checks: z.record(z.enum(['ok', 'concern', 'missing'])).nullable().optional(),
    verdict: z.enum(['consistent', 'discrepancy']).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .passthrough();

export async function verificationAuthorityRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  /**
   * Live QCMobile lookup for the Data Center tab.
   *
   * READ-ONLY: it does not write Phase 4 findings (that is `POST .../authority/run`). Always 200
   * with the client's `{ available, error, ... }` shape — a denied egress IP or a missing webKey
   * is "could not read", not an HTTP failure the UI would confuse with RBAC.
   */
  app.get('/verification/flow/fmcsa/search', auth, async (request) => {
    requireVerificationRead(request);
    const { by, q } = fmcsaSearchQuery.parse(request.query);
    return lookupFmcsaCarrier(
      by === 'dot' ? { dot: q } : by === 'mc' ? { mc: q } : { name: q },
    );
  });

  /**
   * Live Socrata lookup for the Motus Data Center tab.
   *
   * READ-ONLY. USDOT fans out census + insurance + process agents; name is census only.
   * Always 200 with `{ available, error, ... }` — a missing base URL is "could not read".
   */
  app.get('/verification/flow/motus/search', auth, async (request) => {
    requireVerificationRead(request);
    return searchMotus(motusSearchQuery.parse(request.query));
  });

  /**
   * Live DWH lookup for the Broker Snapshot Data Center tab.
   *
   * READ-ONLY. USDOT is exact `dot_number`; name is a prefix on `owner_full_name`.
   * Always 200 with `{ available, error, ... }` — a missing DWH URL is "could not read".
   */
  app.get('/verification/flow/broker-snapshot/search', auth, async (request) => {
    requireVerificationRead(request);
    return searchBrokerSnapshot(brokerSnapshotSearchQuery.parse(request.query));
  });

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

  /**
   * Phase 8 — store the Highway operational review.
   *
   * The underwriting summary the SOP enumerates already reads this phase's `findings` for its
   * "Highway findings" line, and nothing has ever written it. This is the writer.
   */
  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/highway-review',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = highwayBody.parse(request.body ?? {});
      const detail = await deskService.saveHighwayReview(ctx, id, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.highway_review_saved',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        // The verdict is the load-bearing part: it decides pass versus manager review.
        detail: { verdict: body.verdict ?? null, fields: Object.keys(body).length },
      });
      return detail;
    },
  );
}
