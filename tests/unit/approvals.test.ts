import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/toolCallRepo.js', () => ({
  toolCallRepo: { record: vi.fn(async () => undefined) },
}));
vi.mock('../../src/repos/auditRepo.js', () => ({
  auditRepo: { insert: vi.fn(async () => undefined) },
}));
vi.mock('../../src/repos/approvalRepo.js', () => ({
  approvalRepo: {
    create: vi.fn(async (_ctx: unknown, input: Record<string, unknown>) => ({
      id: 'appr-1',
      ...input,
    })),
    markOutcome: vi.fn(async () => undefined),
  },
}));

import { env } from '../../src/config/env.js';
import { dispatchTool } from '../../src/modules/chat/toolDispatcher.js';
import { executeApproval } from '../../src/modules/agents/approvalExecutor.js';
import { approvalRepo } from '../../src/repos/approvalRepo.js';
import type { Approval } from '../../src/db/schema/index.js';
import { makeContext } from '../fixtures/seed.js';

const flag = env.FF_WRITE_APPROVALS;
afterEach(() => {
  env.FF_WRITE_APPROVALS = flag;
  vi.clearAllMocks();
});

describe('write-approval gate in dispatchTool', () => {
  it('parks an agent-proposed write instead of executing (handler never runs)', async () => {
    env.FF_WRITE_APPROVALS = true;
    const admin = makeContext({ role: 'admin', allDepartmentAccess: true, userName: 'Alice' });
    const out = (await dispatchTool(
      'telegram.send_message',
      { text: 'pay reminder' },
      { ...admin, actingAgent: 'collection' },
      { viaAgent: true, agentRunId: 'run-9', conversationId: 'conv-1' },
    )) as { status: string; pendingApprovalId: string };
    // If the handler had run it would have hit the Telegram API and thrown — parking returns instead.
    expect(out.status).toBe('pending_approval');
    expect(out.pendingApprovalId).toBe('appr-1');
    const created = vi.mocked(approvalRepo.create).mock.calls[0]![1];
    expect(created).toMatchObject({
      toolName: 'telegram.send_message',
      riskClass: 'write',
      actingAgent: 'collection',
      agentRunId: 'run-9',
      conversationId: 'conv-1',
    });
    // The snapshot carries the proposer's authority for later re-check.
    expect(created['ctxSnapshot']).toMatchObject({ userId: admin.userId, allDepartmentAccess: true });
  });

  it('an unauthorized proposer is denied BEFORE parking (approval adds a gate, not authority)', async () => {
    env.FF_WRITE_APPROVALS = true;
    const nonAdmin = makeContext({ role: 'ops', allDepartmentAccess: false, departments: ['collection'] });
    await expect(
      dispatchTool('telegram.send_message', { text: 'x' }, nonAdmin, { viaAgent: true }),
    ).rejects.toThrow(/scope|admin/i); // denied at checkAccess (scope gate fires first for ops)
    expect(approvalRepo.create).not.toHaveBeenCalled();
  });

  it('flag off → viaAgent writes are NOT parked (byte-identical legacy behavior)', async () => {
    env.FF_WRITE_APPROVALS = false;
    const admin = makeContext({ role: 'admin', allDepartmentAccess: true });
    // Reaches the real handler, which fails on the unconfigured Telegram token — proving
    // execution was attempted rather than parked.
    await expect(
      dispatchTool('telegram.send_message', { text: 'x' }, admin, { viaAgent: true }),
    ).rejects.toThrow();
    expect(approvalRepo.create).not.toHaveBeenCalled();
  });
});

describe('executeApproval', () => {
  it('re-executes under the PROPOSER snapshot and records the outcome', async () => {
    const admin = makeContext({ role: 'admin', allDepartmentAccess: true, userName: 'Approver' });
    const proposer = makeContext({
      role: 'admin',
      scopes: ['*'],
      departments: ['collection'],
      allDepartmentAccess: false,
      userName: 'Collector',
    });
    const approval = {
      id: 'appr-2',
      tenantId: proposer.tenantId,
      conversationId: null,
      requestedBy: proposer.userId,
      actingAgent: 'collection',
      agentRunId: null,
      toolName: 'telegram.send_message',
      riskClass: 'write',
      arguments: { text: 'hello' },
      ctxSnapshot: { ...proposer },
      status: 'approved',
      approvedBy: 'Approver',
      decidedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      result: null,
      createdAt: new Date(),
    } as unknown as Approval; // test fixture: shape matches the drizzle row at runtime

    // Execution itself fails (no Telegram token in tests) — the outcome must be recorded as failed.
    const outcome = await executeApproval(admin, approval);
    expect(outcome.status).toBe('failed');
    expect(vi.mocked(approvalRepo.markOutcome).mock.calls[0]).toMatchObject([
      expect.anything(),
      'appr-2',
      'failed',
      expect.anything(),
    ]);
  });
});
