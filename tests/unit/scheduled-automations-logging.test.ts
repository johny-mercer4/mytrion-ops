/**
 * Scheduled department automations must NOT write to `automation_logs`.
 *
 * That table means "a catalog block a person triggered, and from where". A cron-run agent job is
 * neither Horizon nor Zoho, so it had no honest `origin_source`, and it surfaced in the Automation
 * Logs tab as a type (`automation.collection.debtor-sweep`) that appears in no catalog — which is
 * how it got noticed. Removing the row loses nothing: the run is still recorded by the agent_tasks
 * row and by the `agent.turn` audit row.
 *
 * This is a test rather than a comment because the insert is one line and re-adding it would look
 * like an improvement.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const automationLogMocks = vi.hoisted(() => ({ insert: vi.fn(), list: vi.fn(), count: vi.fn(), facets: vi.fn() }));
// Signatures given explicitly: a bare `vi.fn(async () => …)` infers a zero-arg tuple, so
// `mock.calls[0][1]` is a type error even though the call is made with three arguments.
const agentTaskMocks = vi.hoisted(() => ({
  create: vi.fn(async (_ctx: unknown, _input: Record<string, unknown>) => ({ id: 'task_1' })),
  complete: vi.fn(
    async (_ctx: unknown, _id: string, _patch: Record<string, unknown>) => undefined,
  ),
  fail: vi.fn(async (_ctx: unknown, _id: string, _message: string) => undefined),
}));
const runAgentTurnMock = vi.hoisted(() => vi.fn());
const dispatchToolMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../src/repos/automationLogRepo.js', () => ({
  automationLogRepo: automationLogMocks,
  AUTOMATION_EXPORT_MAX: 10_000,
}));
vi.mock('../../src/repos/agentTaskRepo.js', () => ({ agentTaskRepo: agentTaskMocks }));
vi.mock('../../src/modules/agents/orchestratorService.js', () => ({ runAgentTurn: runAgentTurnMock }));
vi.mock('../../src/modules/chat/toolDispatcher.js', () => ({ dispatchTool: dispatchToolMock }));

import { AUTOMATIONS, makeAutomationHandler } from '../../src/modules/jobs/workers/automations.js';

beforeEach(() => {
  automationLogMocks.insert.mockReset();
  agentTaskMocks.create.mockReset().mockResolvedValue({ id: 'task_1' });
  agentTaskMocks.complete.mockReset().mockResolvedValue(undefined);
  agentTaskMocks.fail.mockReset().mockResolvedValue(undefined);
  runAgentTurnMock.mockReset().mockResolvedValue({
    message: 'done',
    conversationId: 'c1',
    usage: { totalTokens: 10 },
  });
  dispatchToolMock.mockReset().mockResolvedValue(undefined);
});

describe('scheduled automations', () => {
  it('does not write an automation_logs row on success', async () => {
    const spec = AUTOMATIONS[0]!;
    await makeAutomationHandler(spec)();

    expect(automationLogMocks.insert).not.toHaveBeenCalled();
  });

  it('still records the run as an agent task', async () => {
    const spec = AUTOMATIONS[0]!;
    await makeAutomationHandler(spec)();

    expect(agentTaskMocks.create).toHaveBeenCalledTimes(1);
    expect(agentTaskMocks.create.mock.calls[0]![1]).toMatchObject({
      kind: spec.queue,
      queue: spec.queue,
      status: 'running',
    });
    expect(agentTaskMocks.complete).toHaveBeenCalledTimes(1);
    expect(agentTaskMocks.complete.mock.calls[0]![2]).toMatchObject({ answer: 'done' });
  });

  it('records a failure on the task and does not log an automation row either', async () => {
    runAgentTurnMock.mockRejectedValueOnce(new Error('agent exploded'));
    const spec = AUTOMATIONS[0]!;

    await expect(makeAutomationHandler(spec)()).rejects.toThrow('agent exploded');
    expect(agentTaskMocks.fail).toHaveBeenCalledTimes(1);
    expect(automationLogMocks.insert).not.toHaveBeenCalled();
  });

  it('holds for every declared automation, not just the first', async () => {
    for (const spec of AUTOMATIONS) {
      await makeAutomationHandler(spec)();
    }
    expect(AUTOMATIONS.length).toBeGreaterThan(0);
    expect(automationLogMocks.insert).not.toHaveBeenCalled();
    expect(agentTaskMocks.create).toHaveBeenCalledTimes(AUTOMATIONS.length);
  });
});
