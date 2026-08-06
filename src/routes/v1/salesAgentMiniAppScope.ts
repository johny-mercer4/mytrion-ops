import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';
import { salesAgentMiniAppRepo } from '../../repos/salesAgentMiniAppRepo.js';
import {
  salesAgentContextFromPrincipal,
  selectActiveSalesAgentCompany,
} from '../../modules/carrier/salesAgentMiniApp.js';
import { lookupCtx, verifyTelegramUser } from '../../modules/carrier/miniAppAuth.js';
import { setCurrentContext } from '../../plugins/requestContext.js';

function firstString(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const clean = raw?.trim();
  return clean || undefined;
}

function initDataFrom(request: FastifyRequest): string {
  const body = request.body;
  if (body && typeof body === 'object' && 'initData' in body) {
    const value = (body as { initData?: unknown }).initData;
    if (typeof value === 'string') return value;
  }
  const query = request.query;
  if (query && typeof query === 'object' && 'initData' in query) {
    const value = (query as { initData?: unknown }).initData;
    if (typeof value === 'string') return value;
  }
  return '';
}

/**
 * Install the selected-company scope for Telegram-authenticated Sales agents.
 *
 * The carrier header is only a selector. Before the route handler sees the request, this hook:
 * verifies Telegram's HMAC, resolves the persisted Telegram↔Zoho principal, and re-fetches the
 * agent's live active DWH portfolio. Client carrier registrations do not send the header and stay
 * on the existing path unchanged.
 */
export function registerSalesAgentMiniAppScopeHook(app: FastifyInstance): void {
  app.addHook('preHandler', async (request) => {
    const selectedCarrierId =
      firstString(request.headers['x-mini-app-carrier-id']) ??
      (request.query && typeof request.query === 'object'
        ? firstString((request.query as { agentCarrierId?: string | string[] }).agentCarrierId)
        : undefined);
    if (!selectedCarrierId) return;
    if (selectedCarrierId.length > 120) {
      throw new AppError('Invalid selected company', {
        statusCode: 400,
        code: 'SALES_AGENT_COMPANY_INVALID',
        expose: true,
      });
    }

    const { telegramUserId } = verifyTelegramUser(initDataFrom(request));
    const principal = await salesAgentMiniAppRepo.findPrincipalByTelegramUserId(
      lookupCtx(),
      telegramUserId,
    );
    if (!principal || principal.status !== 'active') {
      throw new AppError('This Telegram account is not registered as a Sales agent', {
        statusCode: 403,
        code: 'SALES_AGENT_NOT_REGISTERED',
        expose: true,
      });
    }
    const ctx = salesAgentContextFromPrincipal(principal, request.requestId);
    const company = await selectActiveSalesAgentCompany(ctx, selectedCarrierId);
    ctx.miniAppAgent = {
      principalId: principal.id,
      telegramUserId,
      zohoUserId: principal.zohoUserId,
      selectedCarrierId: company.carrierId,
      companyName: company.companyName,
      cardCount: company.cardCount,
      companyType: company.companyType,
    };
    request.ctx = ctx;
    setCurrentContext(ctx);
  });
}
