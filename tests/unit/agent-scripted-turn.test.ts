/**
 * CI-safe scripted-model turns through the REAL runAgentTurn → orchestrator/child graph —
 * no API key, no DB. This is not model-quality testing (that's scripts/evalLive.ts); it locks
 * the turn MACHINERY: delegation plumbing + agentPath attribution, the greeting short-circuit
 * shape, runtime tool binding, budget/recursion guards, and pre-model RBAC.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage } from '@langchain/core/messages';
import {
  agentResultEntry,
  ScriptedChatModel,
  toolCallMessage,
} from '../helpers/scriptedChatModel.js';

// --- model seam: the graph builds on resolve*Model; scripts are installed per test ---
let orchestratorModel: ScriptedChatModel;
const childModels = new Map<string, ScriptedChatModel>();
vi.mock('../../src/modules/agents/models.js', () => ({
  resolveOrchestratorModel: () => orchestratorModel,
  resolveAgentModel: (manifest: { key: string }) => {
    const existing = childModels.get(manifest.key);
    if (existing) return existing;
    const fresh = new ScriptedChatModel([]);
    childModels.set(manifest.key, fresh);
    return fresh;
  },
  resolveAgentModelId: () => 'scripted-model',
}));

// --- persistence/bookkeeping seams (repo pattern from chat.test.ts) ---
vi.mock('../../src/repos/conversationRepo.js', () => ({
  conversationRepo: {
    findOwned: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'conv-scripted', title: null })),
    setTitle: vi.fn(async () => undefined),
    bumpForTurn: vi.fn(async () => undefined),
  },
}));
vi.mock('../../src/modules/chat/messageStore.js', () => ({
  messageStore: {
    appendUser: vi.fn(async () => undefined),
    appendAssistant: vi.fn(async () => undefined),
    loadHistory: vi.fn(async () => []),
  },
}));
vi.mock('../../src/repos/agentRunRepo.js', () => ({
  agentRunRepo: { record: vi.fn(async () => undefined) },
}));
vi.mock('../../src/repos/toolCallRepo.js', () => ({
  toolCallRepo: { record: vi.fn(async () => undefined) },
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, auditFromContext: vi.fn(async () => undefined) };
});
vi.mock('../../src/modules/agents/memory.js', () => ({
  distillMemories: vi.fn(async () => undefined),
  recallMemories: vi.fn(async () => ''),
}));

import { env } from '../../src/config/env.js';
import { RBACError } from '../../src/lib/errors.js';
import { runAgentTurn } from '../../src/modules/agents/orchestratorService.js';
import { agentRunRepo } from '../../src/repos/agentRunRepo.js';
import { messageStore } from '../../src/modules/chat/messageStore.js';
import { makeContext } from '../fixtures/seed.js';

const salesCaller = () =>
  makeContext({ scopes: ['*'], audience: 'internal', departments: ['sales'], allDepartmentAccess: false });

const savedComposio = env.FF_COMPOSIO_ENABLED;
const savedMaxToolCalls = env.AGENT_MAX_TOOL_CALLS;
const savedChildIterations = env.AGENT_MAX_CHILD_ITERATIONS;

beforeEach(() => {
  env.FF_COMPOSIO_ENABLED = false; // no external tool construction in CI
  orchestratorModel = new ScriptedChatModel([]);
  childModels.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  env.FF_COMPOSIO_ENABLED = savedComposio;
  env.AGENT_MAX_TOOL_CALLS = savedMaxToolCalls;
  env.AGENT_MAX_CHILD_ITERATIONS = savedChildIterations;
});

describe('greeting short-circuit (orchestrator answers directly, zero delegation/tools)', () => {
  it('a plain reply yields agentKey orchestrator, empty agentPath, no tool calls', async () => {
    orchestratorModel = new ScriptedChatModel([new AIMessage('Hi! How can I help today?')]);
    const result = await runAgentTurn('hi', salesCaller());
    expect(result.agentKey).toBe('orchestrator');
    expect(result.agentPath).toEqual([]);
    expect(result.toolCalls).toEqual([]);
    expect(result.message).toBe('Hi! How can I help today?');
    expect(result.ragPassages).toBe(0);
    expect(result.citations).toEqual([]);
    expect(messageStore.appendAssistant).toHaveBeenCalledWith(
      expect.anything(),
      'conv-scripted',
      expect.objectContaining({ content: 'Hi! How can I help today?', tools: [] }),
    );
  });
});

describe('delegation round-trip (orchestrator → sales child → synthesis)', () => {
  it('records the agentPath and returns the synthesis', async () => {
    orchestratorModel = new ScriptedChatModel([
      toolCallMessage('task', { description: 'Pipeline stages after WEX approval', subagent_type: 'sales' }),
      new AIMessage('Per the Sales team: prospect → application → WEX approval → activation.'),
    ]);
    childModels.set(
      'sales',
      new ScriptedChatModel([
        agentResultEntry('prospect → application → WEX approval → activation'),
      ]),
    );

    const result = await runAgentTurn('What are the pipeline stages?', salesCaller());
    expect(result.agentPath).toEqual(['sales']);
    expect(result.message).toContain('prospect → application → WEX approval → activation');
    expect(agentRunRepo.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'ok', agentKey: 'orchestrator' }),
    );
  });

  it('runtime golden cross-check: the sales child binds knowledge_search + sales tools, never foreign tools', async () => {
    orchestratorModel = new ScriptedChatModel([
      toolCallMessage('task', { description: 'x', subagent_type: 'sales' }),
      new AIMessage('done'),
    ]);
    const sales = new ScriptedChatModel([agentResultEntry('ok')]);
    childModels.set('sales', sales);

    await runAgentTurn('sales question', salesCaller());
    expect(sales.boundToolNames).toContain('knowledge_search');
    // Structured-output handshake really happened: ToolStrategy bound its extract tool.
    expect(sales.boundToolNames.some((n) => /^extract-\d+$/.test(n))).toBe(true);
    // No cross-department leakage in what the GRAPH actually bound (registry names are
    // LangChain-normalized with __, assert both spellings).
    for (const foreign of ['agent.debtors', 'agent__debtors', 'zoho_desk.search_tickets', 'zoho_desk__search_tickets']) {
      expect(sales.boundToolNames).not.toContain(foreign);
    }
  });
});

describe('budget guard trips before any retrieval', () => {
  it('a knowledge_search call with AGENT_MAX_TOOL_CALLS=0 stops early with the friendly message', async () => {
    env.AGENT_MAX_TOOL_CALLS = 0;
    childModels.set(
      'sales',
      new ScriptedChatModel([
        toolCallMessage('knowledge_search', { query: 'late fees', limit: 6 }),
        new AIMessage('should never be reached'),
      ]),
    );

    const result = await runAgentTurn('policy question', salesCaller(), { agent: 'sales' });
    expect(result.message).toMatch(/stop early/i);
    expect(agentRunRepo.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'error', agentKey: 'sales' }),
    );
  });
});

describe('recursion backstop', () => {
  it('an endlessly-planning child aborts at the recursionLimit instead of spinning', async () => {
    env.AGENT_MAX_CHILD_ITERATIONS = 1;
    childModels.set(
      'sales',
      new ScriptedChatModel([], {
        loop: () => toolCallMessage('write_todos', { todos: [] }, `call_${Math.trunc(performance.now())}`),
      }),
    );

    const result = await runAgentTurn('loop forever', salesCaller(), { agent: 'sales' });
    expect(result.message).toMatch(/failed|stop early/i);
    expect(agentRunRepo.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'error' }),
    );
  }, 20_000);
});

describe('pre-model RBAC', () => {
  it('a sales caller requesting the finance agent is rejected before any model call', async () => {
    orchestratorModel = new ScriptedChatModel([new AIMessage('never used')]);
    await expect(
      runAgentTurn('hi', salesCaller(), { agent: 'finance' }),
    ).rejects.toThrow(RBACError);
    expect(orchestratorModel.remaining).toBe(1); // script untouched — denial happened pre-model
    expect(messageStore.appendUser).not.toHaveBeenCalled();
  });
});
