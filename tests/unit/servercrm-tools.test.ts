import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postMock, getMock } = vi.hoisted(() => ({ postMock: vi.fn(), getMock: vi.fn() }));

vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrmPost: postMock,
  serverCrmGet: getMock,
}));

import { agentActivityTool } from '../../src/modules/tools/definitions/agent_activity.js';
import { agentDebtorsTool } from '../../src/modules/tools/definitions/agent_debtors.js';
import { agentSalesSnapshotTool } from '../../src/modules/tools/definitions/agent_sales_snapshot.js';
import { ToolError } from '../../src/lib/errors.js';
import { makeContext } from '../fixtures/seed.js';

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ ok: true });
  getMock.mockReset();
  getMock.mockResolvedValue({ ok: true });
});

describe('servercrm agent-proxy tools (owner scoping)', () => {
  it('sales_snapshot scopes a non-admin to their own name', async () => {
    await agentSalesSnapshotTool.handler({}, makeContext({ role: 'ops', userName: 'Jane Operator' }));
    expect(postMock).toHaveBeenCalledWith('/api/agent/dwh/snapshot', { agentName: 'Jane Operator' });
  });

  it('non-admin cannot override agentName (locked to self)', async () => {
    await agentSalesSnapshotTool.handler(
      { agentName: 'Someone Else' },
      makeContext({ role: 'ops', userName: 'Jane Operator' }),
    );
    expect(postMock).toHaveBeenCalledWith('/api/agent/dwh/snapshot', { agentName: 'Jane Operator' });
  });

  it('admin may override agentName', async () => {
    await agentSalesSnapshotTool.handler(
      { agentName: 'Bob Boss' },
      makeContext({ role: 'admin', userName: 'Admin', allDepartmentAccess: true }),
    );
    expect(postMock).toHaveBeenCalledWith('/api/agent/dwh/snapshot', { agentName: 'Bob Boss' });
  });

  it('non-admin with no caller name is rejected (no owner scope possible)', async () => {
    await expect(agentSalesSnapshotTool.handler({}, makeContext({ role: 'ops' }))).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('debtors posts to the debtors endpoint scoped to the caller', async () => {
    await agentDebtorsTool.handler({}, makeContext({ role: 'ops', userName: 'Jane' }));
    expect(postMock).toHaveBeenCalledWith('/api/agent/dwh/debtors', { agentName: 'Jane' });
  });

  it('activity resolves the caller zoho user id from ctx.userId', async () => {
    await agentActivityTool.handler(
      { range: 'weekly' },
      makeContext({ role: 'ops', userId: 'zoho:1520000041001', userName: 'Jane' }),
    );
    expect(getMock).toHaveBeenCalledWith('/api/agent/activity/1520000041001', { range: 'weekly' });
  });
});
