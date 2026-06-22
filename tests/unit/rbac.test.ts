import { describe, expect, it, vi } from 'vitest';

// Mock every DB/network boundary the dispatcher touches so the whole RBAC path
// runs offline. The retriever mock echoes ctx.tenantId so we can assert isolation.
vi.mock('../../src/repos/toolCallRepo.js', () => ({
  toolCallRepo: { record: vi.fn(async () => undefined) },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  audit: vi.fn(async () => undefined),
  auditFromContext: vi.fn(async () => undefined),
}));
vi.mock('../../src/modules/knowledge/retriever.js', () => ({
  retrieve: vi.fn(async (ctx: { tenantId: string }) => [
    { docId: `doc_${ctx.tenantId}`, chunkIndex: 0, content: 'a passage', score: 0.9 },
  ]),
}));

import { RBACError } from '../../src/lib/errors.js';
import { dispatchTool } from '../../src/modules/chat/toolDispatcher.js';
import {
  hasAllScopes,
  hasScope,
  roleAllowsAudience,
  scopesForRole,
} from '../../src/modules/auth/permissions.js';
import { toolRegistry } from '../../src/modules/tools/index.js';
import { makeContext, sampleToolArgs } from '../fixtures/seed.js';

describe('permissions', () => {
  it('derives scopes from role', () => {
    expect(scopesForRole('viewer')).toEqual(['zoho_crm:read']);
    expect(scopesForRole('admin')).toEqual(['*']);
  });

  it('wildcard scope satisfies any requirement', () => {
    expect(hasScope(['*'], 'octane_card:read')).toBe(true);
    expect(hasAllScopes(['*'], ['a', 'b', 'c'])).toBe(true);
  });

  it('non-wildcard scopes require an exact match', () => {
    expect(hasScope(['zoho_crm:read'], 'octane_card:read')).toBe(false);
    expect(hasScope(['zoho_crm:read'], 'zoho_crm:read')).toBe(true);
  });

  it('binds roles to audiences', () => {
    expect(roleAllowsAudience('driver', 'partner')).toBe(true);
    expect(roleAllowsAudience('driver', 'internal')).toBe(false);
    expect(roleAllowsAudience('ops', 'internal')).toBe(true);
  });
});

describe('tool registry access control', () => {
  it('denies internal-only tools to a partner context', () => {
    const partner = makeContext({ role: 'fleet_manager', tenantId: 'tenant-A' });
    const tool = toolRegistry.get('agent.sales_snapshot'); // internal only
    expect(tool).toBeDefined();
    expect(toolRegistry.checkAccess(tool!, partner).ok).toBe(false);
  });

  it('denies a tool when the context lacks the required scope', () => {
    const viewer = makeContext({ role: 'viewer' }); // only zoho_crm:read
    const tool = toolRegistry.get('agent.sales_snapshot'); // needs servercrm:read
    expect(toolRegistry.checkAccess(tool!, viewer).ok).toBe(false);
  });
});

describe('CRITICAL: cross-tenant isolation', () => {
  it('partner user from tenant A cannot read tenant B data via any tool', async () => {
    const ctxA = makeContext({ role: 'fleet_manager', tenantId: 'tenant-A' });

    for (const tool of toolRegistry.all()) {
      const args = sampleToolArgs[tool.name] ?? {};
      const access = toolRegistry.checkAccess(tool, ctxA);

      if (!access.ok) {
        // Mismatched audience/scope => denied before the handler runs.
        await expect(dispatchTool(tool.name, args, ctxA)).rejects.toBeInstanceOf(RBACError);
        continue;
      }

      // Allowed => output is scoped to tenant-A and never leaks another tenant.
      const output = await dispatchTool(tool.name, args, ctxA);
      const json = JSON.stringify(output);
      expect(json).toContain('tenant-A');
      expect(json).not.toContain('tenant-B');
    }
  });

  it('an internal viewer cannot reach tools it lacks the scope for', async () => {
    const viewer = makeContext({ role: 'viewer', tenantId: 'tenant-A' });
    await expect(
      dispatchTool('agent.sales_snapshot', {}, viewer), // needs servercrm:read
    ).rejects.toBeInstanceOf(RBACError);
    await expect(
      dispatchTool('zoho_people.search_employees', {}, viewer), // needs zoho_people:read
    ).rejects.toBeInstanceOf(RBACError);
  });

  it('dispatch rejects an unknown tool', async () => {
    const admin = makeContext({ role: 'admin' });
    await expect(dispatchTool('does.not_exist', {}, admin)).rejects.toThrow();
  });
});
