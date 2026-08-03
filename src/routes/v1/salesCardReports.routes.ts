import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  listCardLookupRows,
  renderCardLookupReport,
} from '../../modules/carrier/cardLookupReport.js';
import { assertCarrierOwned } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const listSchema = z.object({
  carrierId: z.string().regex(/^\d+$/, 'carrierId must be a positive integer'),
});

const reportSchema = listSchema.extend({
  companyName: z.string().trim().min(1).max(200).optional(),
  format: z.enum(['pdf', 'xlsx']),
});

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Card Lookup reports');
}

/** Sales Mytrion live Card Lookup list and browser downloads. */
export async function salesCardReportsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { preHandler: app.authenticate };

  app.get('/sales/cards', guard, async (request, reply) => {
    const ctx = requireSalesAccess(request);
    const { carrierId } = listSchema.parse(request.query);
    await assertCarrierOwned(ctx, carrierId);
    const rows = await listCardLookupRows(carrierId);
    return reply.header('Cache-Control', 'no-store').send({ rows });
  });

  app.get('/sales/cards/report', guard, async (request, reply) => {
    const ctx = requireSalesAccess(request);
    const { carrierId, companyName, format } = reportSchema.parse(request.query);
    await assertCarrierOwned(ctx, carrierId);
    const rows = await listCardLookupRows(carrierId);
    if (rows.length === 0) {
      throw new AppError('No cards found for this carrier.', {
        statusCode: 404,
        code: 'CARD_LOOKUP_EMPTY',
        expose: true,
      });
    }
    const report = await renderCardLookupReport(
      rows,
      companyName ?? `Carrier ${carrierId}`,
      format,
    );
    await auditFromContext(ctx, {
      action: 'sales.card_lookup_report.download',
      status: 'ok',
      resourceType: 'card_lookup_report',
      resourceId: carrierId,
      detail: { format, rows: rows.length, bytes: report.bytes.length },
    });
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Type', report.contentType)
      .header('Content-Length', report.bytes.length)
      .header('Content-Disposition', `attachment; filename="${report.fileName}"`)
      .send(report.bytes);
  });
}
