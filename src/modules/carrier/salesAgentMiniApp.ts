import { AppError, RBACError, ToolError } from '../../lib/errors.js';
import {
  fetchAgentClients,
  zohoIdSuffix,
  type AgentClientRow,
} from '../../integrations/dwhClientRoster.js';
import { salesAgentMiniAppRepo } from '../../repos/salesAgentMiniAppRepo.js';
import type { SalesAgentMiniAppPrincipal } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { buildInviteUrl } from './inviteService.js';

export interface SalesAgentMiniAppCompany {
  carrierId: string;
  companyName: string;
  cardCount: number;
  companyType: 'owner-operator' | 'fleet-manager' | null;
  status: 'active' | 'debtor';
  debt: number;
  debtDays: number;
  locSuspended: boolean;
}

function callerZohoUserId(ctx: TenantContext): string {
  const match = /^zoho:(.+)$/.exec(ctx.userId);
  const id = match?.[1]?.trim();
  if (!id) throw new ToolError('A verified Zoho Sales agent identity is required');
  return id;
}

function toCompany(row: AgentClientRow): SalesAgentMiniAppCompany {
  const cardCount = Math.max(0, row.activeCards);
  const debtor = row.isLocSuspended || (row.computedDebt >= 1 && row.computedDebtDays >= 2);
  return {
    carrierId: row.carrierId,
    companyName: row.companyName,
    cardCount,
    companyType: cardCount === 0 ? null : cardCount === 1 ? 'owner-operator' : 'fleet-manager',
    status: debtor ? 'debtor' : 'active',
    debt: row.computedDebt,
    debtDays: row.computedDebtDays,
    locSuspended: row.isLocSuspended,
  };
}

/** Fresh, no-stale-fallback portfolio read. Inactive companies never enter the agent mini-app. */
export async function listActiveSalesAgentCompanies(
  ctx: TenantContext,
): Promise<SalesAgentMiniAppCompany[]> {
  const zohoUserId = callerZohoUserId(ctx);
  const agentName = ctx.userName?.trim() || undefined;
  if (!zohoIdSuffix(zohoUserId) && !agentName) {
    throw new ToolError('No resolvable Sales agent identity is available');
  }
  try {
    const rows = await fetchAgentClients(zohoUserId, agentName, {
      force: true,
      allowStaleOnError: false,
    });
    return rows.filter((row) => row.computedIsActive).map(toCompany);
  } catch (error) {
    throw new AppError('Sales agent company list is unavailable (data warehouse)', {
      statusCode: 502,
      code: 'DWH_ERROR',
      expose: true,
      cause: error,
    });
  }
}

/** Carrier id is a selector only; every request resolves it inside the agent's fresh active book. */
export async function selectActiveSalesAgentCompany(
  ctx: TenantContext,
  carrierId: string,
): Promise<SalesAgentMiniAppCompany> {
  const normalized = carrierId.trim();
  const company = (await listActiveSalesAgentCompanies(ctx)).find(
    (candidate) => candidate.carrierId === normalized,
  );
  if (!company) {
    throw new RBACError(
      `Carrier ${normalized} is not an active company in your client list.`,
      { code: 'SALES_AGENT_COMPANY_DENIED' },
    );
  }
  return company;
}

export function salesAgentContextFromPrincipal(
  principal: SalesAgentMiniAppPrincipal,
  requestId: string,
): TenantContext {
  return {
    tenantId: principal.tenantId,
    userId: `zoho:${principal.zohoUserId}`,
    userName: principal.agentName,
    audience: 'internal',
    role: 'sales_agent',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId,
  };
}

export async function createSalesAgentMiniAppInvitation(
  ctx: TenantContext,
  requestedCarrierId?: string,
): Promise<{ invitationId: string; inviteUrl: string; expiresAt: string }> {
  if (ctx.allDepartmentAccess && !ctx.impersonatorUserId) {
    throw new RBACError('Choose Admin View for the Sales agent who will register this mini-app.');
  }
  const zohoUserId = callerZohoUserId(ctx);
  const agentName = ctx.userName?.trim();
  if (!agentName) throw new ToolError('The verified Sales agent has no display name');
  const selected = requestedCarrierId
    ? await selectActiveSalesAgentCompany(ctx, requestedCarrierId)
    : undefined;
  const invitation = await salesAgentMiniAppRepo.createInvitation(ctx, {
    zohoUserId,
    agentName,
    ...(selected ? { requestedCarrierId: selected.carrierId } : {}),
    ttlMinutes: 30,
  });
  return {
    invitationId: invitation.id,
    inviteUrl: buildInviteUrl(invitation.id),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}
