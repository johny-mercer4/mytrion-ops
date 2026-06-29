/**
 * Composio client + connection helpers — the external tool-calling gateway.
 *
 * Auth model (chosen): SHARED ORG ACCOUNT. One fixed Composio user (COMPOSIO_ORG_USER_ID) owns the
 * connected accounts; connect Zoho once and every agent call uses it. This mirrors the native
 * shared-service-token model and avoids per-end-user OAuth. Access control stays in OUR layer: the
 * external-tools subagent is admin-gated (external toolkits include writes/deletes) and every remote
 * execution is audit-logged (see modules/deepagents/tools/composioTools.ts).
 *
 * This module is NOT re-exported from integrations/index.ts and is only ever lazy-imported, so the
 * Composio SDK never loads at boot when FF_COMPOSIO_ENABLED is off.
 */
import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';
import { env } from '../config/env.js';
import type { TenantContext } from '../types/tenantContext.js';

let client: Composio<LangchainProvider> | null = null;

/** Lazily build the Composio client wired to the LangChain provider (tools.get → LangChain tools). */
export function getComposio(): Composio<LangchainProvider> {
  if (!client) {
    client = new Composio({
      apiKey: env.COMPOSIO_API_KEY || 'not-configured',
      provider: new LangchainProvider(),
    });
  }
  return client;
}

/** The managed-auth toolkit slugs to expose (e.g. ZOHO, ZOHO_DESK), normalized to upper-case. */
export const COMPOSIO_TOOLKITS: string[] = env.COMPOSIO_TOOLKITS.split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

/** The fixed Composio user that owns the shared org connected accounts. */
export const COMPOSIO_ORG_USER = env.COMPOSIO_ORG_USER_ID;

/**
 * Who may use the Composio external tools. They include write/destructive actions (create/delete
 * records), so per hard-rule #7 we restrict to admins / elevated (allDepartmentAccess) callers.
 */
export function isComposioAllowed(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.allDepartmentAccess;
}

/** Generate a Connect Link to OAuth a toolkit into the shared org account. */
export async function authorizeToolkit(toolkitSlug: string): Promise<{ redirectUrl?: string; id: string }> {
  const conn = await getComposio().toolkits.authorize(COMPOSIO_ORG_USER, toolkitSlug);
  const out: { redirectUrl?: string; id: string } = { id: conn.id };
  if (conn.redirectUrl) out.redirectUrl = conn.redirectUrl;
  return out;
}

export interface ConnectionStatus {
  toolkit: string;
  status: string;
  connectedAccountId: string;
}

/** List the shared org account's connections (which toolkits are connected + their status). */
export async function listConnections(): Promise<ConnectionStatus[]> {
  const res = await getComposio().connectedAccounts.list({ userIds: [COMPOSIO_ORG_USER] });
  return res.items.map((a) => ({
    toolkit: a.toolkit?.slug ?? 'unknown',
    status: a.status,
    connectedAccountId: a.id,
  }));
}
