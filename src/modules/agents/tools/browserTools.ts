/**
 * Browser automation via Composio toolkits (FIRECRAWL scraping; the Composio Browserbase
 * toolkit for interactive sessions — slug verified in the dashboard before enabling).
 *
 * Guardrails, all fail-closed:
 *   - FF_BROWSER_ENABLED + admin gate (isComposioAllowed) — external actions, high blast radius;
 *   - domain allowlist (BROWSER_ALLOWED_DOMAINS, suffix match) enforced in beforeExecute over
 *     every URL-ish argument; EMPTY LIST = every navigation denied;
 *   - interactive write-class actions (navigate/click/fill/…) dropped unless FF_BROWSER_WRITES;
 *   - per-toolkit rate bucket; every execution audited + output wrapped UNTRUSTED (the shared
 *     composio afterExecute hook does both).
 */
import type { StructuredTool } from '@langchain/core/tools';
import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import { buildComposioToolsFor, isComposioWriteTool } from './composio.js';

/** Interactive browser verbs = write-class (they act on live third-party sites). */
const BROWSER_WRITE_VERB =
  /(^|_)(navigate|goto|click|fill|type|press|act|drag|scroll|hover|submit|execute|run|start|stop)(_|$)/i;

export function isBrowserWriteTool(slug: string): boolean {
  return BROWSER_WRITE_VERB.test(slug) || isComposioWriteTool(slug);
}

export function allowedBrowserDomains(): string[] {
  return env.BROWSER_ALLOWED_DOMAINS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Hostname allowed iff it equals an allowlist entry or is a subdomain of one. */
export function isHostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/** Recursively collect URL-ish strings from tool arguments. */
export function extractUrls(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s"'<>]+/gi);
    if (matches) found.push(...matches);
  } else if (Array.isArray(value)) {
    for (const v of value) extractUrls(v, found);
  } else if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) extractUrls(v, found);
  }
  return found;
}

/**
 * Throws when any URL argument targets a host outside the allowlist (empty allowlist = any
 * URL is denied). Non-URL calls pass — they can't navigate anywhere.
 */
export function assertUrlsAllowed(args: unknown): void {
  const urls = extractUrls(args);
  if (urls.length === 0) return;
  const allowlist = allowedBrowserDomains();
  for (const raw of urls) {
    let hostname: string;
    try {
      hostname = new URL(raw).hostname;
    } catch {
      throw new Error(`Browser action blocked: unparseable URL '${raw.slice(0, 120)}'`);
    }
    if (allowlist.length === 0 || !isHostAllowed(hostname, allowlist)) {
      throw new Error(
        `Browser action blocked: '${hostname}' is not in BROWSER_ALLOWED_DOMAINS (fail-closed allowlist)`,
      );
    }
  }
}

function browserToolkits(): string[] {
  return env.COMPOSIO_BROWSER_TOOLKITS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Composio-backed browser tools for one agent run (empty when disabled/not allowed). */
export async function buildBrowserTools(ctx: TenantContext): Promise<StructuredTool[]> {
  if (!env.FF_BROWSER_ENABLED) return [];
  try {
    const tools = await buildComposioToolsFor(ctx, browserToolkits(), {
      beforeExecute: (context) => {
        assertUrlsAllowed(context.params.arguments);
        return context.params;
      },
    });
    if (env.FF_BROWSER_WRITES) return tools;
    return tools.filter((t) => !isBrowserWriteTool(t.name));
  } catch (err) {
    logger.warn({ err }, 'browser tools unavailable; continuing without');
    return [];
  }
}
