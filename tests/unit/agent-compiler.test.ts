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
    expect(agentKeys.sort()).toEqual(['marketing', 'sales']);
  });

  it("admin caller's orchestrator contains all 10 agents", async () => {
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
