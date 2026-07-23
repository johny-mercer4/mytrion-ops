import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { buildOrchestrator, buildSingleAgent } from '../../src/modules/agents/orchestrator.js';
import { agentRegistry } from '../../src/modules/agents/agentRegistry.js';
import { AGENT_KEYS } from '../../src/modules/agents/types.js';
import { makeContext } from '../fixtures/seed.js';

const composioFlag = env.FF_COMPOSIO_ENABLED;
afterEach(() => {
  env.FF_COMPOSIO_ENABLED = composioFlag;
});

// Building the graphs is pure construction — no network. Hermetic: Composio disabled.
describe('orchestrator compiler', () => {
  it("sales caller's orchestrator contains ONLY the agents they may select", async () => {
    env.FF_COMPOSIO_ENABLED = false;
    const ctx = makeContext({ scopes: ['*'], departments: ['sales'], allDepartmentAccess: false });
    const { agent, agentKeys } = await buildOrchestrator(ctx);
    expect(agent).toBeTruthy();
    expect(agentKeys.sort()).toEqual(['data-center', 'marketing', 'sales']);
  });

  it("admin caller's orchestrator contains all registered agents", async () => {
    env.FF_COMPOSIO_ENABLED = false;
    const admin = makeContext({ allDepartmentAccess: true });
    const { agentKeys } = await buildOrchestrator(admin);
    expect(agentKeys.sort()).toEqual([...AGENT_KEYS].sort());
  });

  it('no-department caller gets an orchestrator with zero specialists', async () => {
    env.FF_COMPOSIO_ENABLED = false;
    const ctx = makeContext({ scopes: ['*'], departments: [], allDepartmentAccess: false });
    const { agentKeys } = await buildOrchestrator(ctx);
    expect(agentKeys).toEqual([]);
  });

  it('direct-to-child compiles a runnable single agent', async () => {
    env.FF_COMPOSIO_ENABLED = false;
    const ctx = makeContext({ scopes: ['*'], departments: ['billing'], allDepartmentAccess: false });
    const agent = await buildSingleAgent(agentRegistry.get('billing')!, ctx);
    expect(agent).toBeTruthy();
    expect(typeof agent.streamEvents).toBe('function');
  });
});

describe('warehouse access via dbt MCP (no direct DWH pool on agents)', () => {
  it('no agent binds analytics.snapshot (dashboard/direct-pool path stays off the agent surface)', () => {
    for (const m of agentRegistry.all()) {
      expect(m.tools).not.toContain('analytics.snapshot');
    }
  });

  it('sales reps keep self-scoped warehouse.my_gallons + dbt_mcp wildcard', () => {
    const tools = agentRegistry.get('sales')!.tools;
    expect(tools).toContain('warehouse.my_gallons');
    expect(tools).toContain('dbt_mcp.*');
  });

  it('leadership agents (manager/analyst) use dbt MCP for warehouse metrics', () => {
    expect(agentRegistry.get('manager')!.tools).toContain('dbt_mcp.*');
    expect(agentRegistry.get('analyst')!.tools).toContain('dbt_mcp.*');
  });
});
