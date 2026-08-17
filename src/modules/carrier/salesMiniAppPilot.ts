/**
 * Sales mini-app pilot roster.
 *
 * The carrier mini-app is being rolled out through Sales one agent at a time: the agent's own
 * "View mini-app" launch and the client registration links they mint are both live product surfaces
 * that put a company into Telegram, so who can do it is a deliberate list rather than a role.
 *
 * This module is the AUTHORITY — the CRM hides the controls from everyone else, but hiding a button
 * is decoration; these routes are what actually says no.
 *
 * Ids, not names: a Zoho display name is editable and duplicated (there are two Charles Watson-shaped
 * rows in the directory), while the id survives a rename. The name here is a comment for reviewers.
 */
import { RBACError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';

interface PilotAgent {
  zohoUserId: string;
  /** For humans reading the diff — never matched on. */
  name: string;
}

export const SALES_MINI_APP_PILOT_AGENTS: readonly PilotAgent[] = [
  { zohoUserId: '6227679000031473048', name: 'Daniel Brown' },
];

const PILOT_IDS = new Set(SALES_MINI_APP_PILOT_AGENTS.map((a) => a.zohoUserId));

function callerZohoUserId(ctx: TenantContext): string {
  const match = /^zoho:(.+)$/.exec(ctx.userId);
  return (match?.[1] ?? '').trim();
}

/**
 * Admins keep their existing bypass (Admin Client Management onboards carriers outside the pilot).
 * "View as" is NOT a bypass: it runs as the selected agent, so an admin viewing as a non-pilot agent
 * sees exactly what that agent sees — which is the point of the feature.
 */
export function isSalesMiniAppPilotAgent(ctx: TenantContext): boolean {
  if (ctx.bypassRbac) return true;
  if (ctx.role === 'admin' && ctx.impersonatorUserId == null) return true;
  return PILOT_IDS.has(callerZohoUserId(ctx));
}

export function assertSalesMiniAppPilotAgent(ctx: TenantContext, action: string): void {
  if (isSalesMiniAppPilotAgent(ctx)) return;
  throw new RBACError(`${action} is limited to the Sales mini-app pilot agents`);
}
