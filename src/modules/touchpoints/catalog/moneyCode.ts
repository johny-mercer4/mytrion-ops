/**
 * Money-code Data Center touchpoints — local handlers over our `money_code_requests`
 * table (the same Ops DB ledger ServerCRM draw/void write via MYTRION_OPS_DB_INTERNAL).
 *
 * Draw / preview stay on ServerCRM (`dwh.money_code` / `dwh.money_code_draw`) because
 * they need live EFS. List is pure local SQL. Void checks ownership locally, then runs
 * ServerCRM's money-safe EFS void (fail-closed) which updates this same table.
 */
import { z } from 'zod';
import { AppError, NotFoundError, RBACError } from '../../../lib/errors.js';
import { ServerCrmHttpError, serverCrmPost } from '../../../integrations/serverCrm.js';
import { moneyCodeRequestRepo } from '../../../repos/moneyCodeRequestRepo.js';
import { carrierId, shortText } from './common.js';
import type { LocalTouchpoint } from '../types.js';

const salesDept = ['sales'] as const;

interface SafeVoidResponse {
  success?: boolean;
  outcome?: string;
  record?: Record<string, unknown>;
  batch?: Array<Record<string, unknown>>;
  efs?: { amount?: number | string; numUses?: number | string };
  message?: string;
}

function requireOwnName(ctxUserName: string | null | undefined): string {
  const name = ctxUserName?.trim() ?? '';
  if (!name) {
    throw new AppError('No agent identity on the session — reload and try again', {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
    });
  }
  return name;
}

function ownsRow(requestedBy: string | null | undefined, agentName: string): boolean {
  const owner = String(requestedBy ?? '')
    .trim()
    .toLowerCase();
  return Boolean(owner) && owner === agentName.trim().toLowerCase();
}

export const moneyCodeTouchpoints: LocalTouchpoint[] = [
  {
    kind: 'local',
    key: 'money_code.list',
    title: 'List my money-code draws (Data Center)',
    riskClass: 'read',
    departments: salesDept,
    paramsSchema: z.object({
      page: z.coerce.number().int().positive().max(500).optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      search: shortText(200).optional(),
      status: z.enum(['ISSUED', 'VOIDED', 'USED']).optional(),
      carrierId: carrierId.optional(),
    }),
    handler: async (ctx, params) => {
      // Own-only for everyone (incl. admins) — same business rule as ServerCRM list.
      const requestedBy = requireOwnName(ctx.userName);
      const carrierRaw = params.carrierId;
      const carrierParsed =
        carrierRaw !== undefined && carrierRaw !== null && String(carrierRaw).trim() !== ''
          ? Number(carrierRaw)
          : undefined;
      return moneyCodeRequestRepo.listForAgent({
        requestedBy,
        page: typeof params.page === 'number' ? params.page : 1,
        limit: typeof params.limit === 'number' ? params.limit : 25,
        ...(typeof params.search === 'string' ? { search: params.search } : {}),
        ...(params.status === 'ISSUED' || params.status === 'VOIDED' || params.status === 'USED'
          ? { status: params.status }
          : {}),
        ...(carrierParsed !== undefined && Number.isFinite(carrierParsed)
          ? { carrierId: carrierParsed }
          : {}),
      });
    },
  },

  {
    kind: 'local',
    key: 'money_code.void',
    title: 'Void my money-code draw (safe EFS void)',
    riskClass: 'destructive',
    departments: salesDept,
    paramsSchema: z.object({
      requestId: z.coerce.number().int().positive(),
      reason: shortText(500).optional(),
    }),
    handler: async (ctx, params) => {
      const agentName = requireOwnName(ctx.userName);
      const requestId = Number(params.requestId);
      const row = await moneyCodeRequestRepo.findById(requestId);
      if (!row) throw new NotFoundError(`Money-code request ${requestId} not found`);
      if (!ownsRow(row.requestedBy, agentName)) {
        throw new RBACError('You can only void money codes you drew yourself');
      }

      // EFS-safe decision tree lives in ServerCRM; it writes back to this same table.
      try {
        const out = await serverCrmPost<SafeVoidResponse>('/api/agent/dwh/money-code/void', {
          requestId,
          requestedBy: agentName,
          ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
        });
        // Prefer a fresh code-stripped row from our DB after ServerCRM updates it.
        const fresh = await moneyCodeRequestRepo.findById(requestId);
        return {
          success: true,
          outcome: out.outcome,
          message: out.message,
          efs: out.efs,
          record: fresh ? moneyCodeRequestRepo.toPublicRow(fresh) : out.record,
        };
      } catch (err) {
        if (err instanceof ServerCrmHttpError && [400, 403, 404, 502].includes(err.status)) {
          throw new AppError(err.bodyText || `Could not void money code (${err.status})`, {
            statusCode: err.status,
            code: 'MONEY_CODE_VOID_FAILED',
            expose: true,
            cause: err,
          });
        }
        throw err;
      }
    },
  },
];
