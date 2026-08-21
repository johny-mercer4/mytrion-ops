/**
 * Data Center first-party vendor tabs — iSoftPull (metered), Plaid Link-token (unpaid),
 * Highway HTML parse (no vendor HTTP).
 *
 * View-only: nothing here writes Phase 6 / 8 findings. Paid iSoftPull HTTP requires every
 * gate: live flag, verification reader, `confirm: true`, spend token bound to `isoftpull`,
 * and a persisted ledger row. Plaid Check report GET is not shipped.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ISOFTPULL_BUREAUS } from '../../integrations/isoftpullClient.js';
import { createPlaidLinkToken, plaidConfiguredMissing } from '../../integrations/plaidClient.js';
import { authoriseSpend } from '../../integrations/vendors/spend.js';
import { isoftpull } from '../../integrations/vendors/isoftpull.js';
import { runVendor } from '../../integrations/vendors/runVendor.js';
import { parseHighwayUpload } from '../../modules/verificationFlow/highwayHtmlParser.js';
import { ValidationError } from '../../lib/errors.js';
import { requireDepartment } from './helpers.js';

const DATA_CENTER_CASE_ID = 'data-center';
const HIGHWAY_MAX_BYTES = 8 * 1024 * 1024;

const isoftpullBody = z.object({
  confirm: z.literal(true),
  bureau: z.enum(ISOFTPULL_BUREAUS),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(2).max(40),
  zip: z.string().trim().min(5).max(10),
  ssn: z.string().trim().max(11).optional(),
  dateOfBirth: z.string().trim().max(10).optional(),
});

const plaidLinkBody = z.object({
  clientUserId: z.string().trim().max(64).optional(),
});

export async function verificationVendorsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  /**
    * One-bureau iSoftPull Full Feed. Always 200 with the vendor envelope — a killed
   * flag or a 403 is "could not read", not an HTTP failure the UI would mix with RBAC.
   */
  app.post('/verification/flow/isoftpull/pull', auth, async (request) => {
    const ctx = requireDepartment(request, 'verification', 'Verification underwriting');
    const body = isoftpullBody.parse(request.body ?? {});
    const spend = await authoriseSpend({
      ctx,
      caseId: DATA_CENTER_CASE_ID,
      vendorId: 'isoftpull',
      reason: `data-center ${body.bureau} confirm`,
    });
    if (!spend) {
      return {
        available: false,
        error: 'verification access is required to approve a billed pull',
        reason: 'unauthorised_spend',
        data: null,
      };
    }
    return runVendor(isoftpull, {
      ctx,
      spend,
      args: {
        bureau: body.bureau,
        firstName: body.firstName,
        lastName: body.lastName,
        address: body.address,
        city: body.city,
        state: body.state,
        zip: body.zip,
        ...(body.ssn ? { ssn: body.ssn } : {}),
        ...(body.dateOfBirth ? { dateOfBirth: body.dateOfBirth } : {}),
      },
    });
  });

  /**
   * Sandbox Link-token mint. Not a Check /get. No spend token.
   */
  app.post('/verification/flow/plaid/link-token', auth, async (request) => {
    requireDepartment(request, 'verification', 'Verification underwriting');
    const body = plaidLinkBody.parse(request.body ?? {});
    const missing = plaidConfiguredMissing();
    if (missing) {
      return {
        available: false,
        error: `${missing} is not configured`,
        reason: 'not_configured',
        data: null,
      };
    }
    try {
      const data = await createPlaidLinkToken(
        body.clientUserId ? { clientUserId: body.clientUserId } : {},
      );
      return { available: true, error: null, reason: null, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plaid did not answer.';
      return { available: false, error: message, reason: 'remote_error', data: null };
    }
  });

  /**
   * Highway HTML (or PDF) upload → local parse. No spend. No highway.com HTTP.
   */
  app.post('/verification/flow/highway/parse', auth, async (request) => {
    requireDepartment(request, 'verification', 'Verification underwriting');
    let part: { toBuffer: () => Promise<Buffer> } | undefined;
    try {
      part = await request.file({ limits: { fileSize: HIGHWAY_MAX_BYTES } });
    } catch (err) {
      if (err instanceof Error && /file too large|FST_REQ_FILE_TOO_LARGE|request file too large/i.test(err.message)) {
        throw new ValidationError('Highway file is too large (8 MB).');
      }
      throw err;
    }
    if (!part) throw new ValidationError('Expected a multipart file field named "file".');
    const bytes = new Uint8Array(await part.toBuffer());
    return parseHighwayUpload(bytes);
  });
}
