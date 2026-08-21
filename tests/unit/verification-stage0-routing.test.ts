/**
 * Stage-0 routing — which credit agent a new application goes to.
 *
 * WHY THIS EXISTS. `VERIFICATION_CASE_OWNER_ZOHO_USER_IDS` has held a LIST since the desk grew a
 * second credit agent, but the ingest called `resolveVerificationCaseOwnerId()` — the singular
 * accessor — so `ids[0]` was notified about every application in the company and everyone else was
 * told nothing.
 *
 * The rule under test is LEAST RECENTLY ASSIGNED WINS, with declaration order as the tie-break. There
 * is deliberately no stored cursor: fairness is derived from the assignments that actually happened,
 * so adding, removing or reordering an agent cannot leave a counter pointing at the wrong person.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lastAssignedAt, resolveActAsTarget } = vi.hoisted(() => ({
  lastAssignedAt: vi.fn(),
  resolveActAsTarget: vi.fn(),
}));

vi.mock('../../src/repos/verificationCaseAssignmentRepo.js', () => ({
  verificationCaseAssignmentRepo: { lastAssignedAt },
}));
vi.mock('../../src/modules/auth/actAsDirectory.js', () => ({ resolveActAsTarget }));

import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { pickStage0Assignee } from '../../src/modules/verification/stage0Routing.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'system',
  audience: 'internal',
  role: 'admin',
} as TenantContext;

const at = (iso: string): Date => new Date(iso);

beforeEach(() => {
  lastAssignedAt.mockReset().mockResolvedValue(new Map());
  resolveActAsTarget.mockReset().mockImplementation(async (id: string) => ({
    zohoUserId: id,
    name: `Agent ${id}`,
  }));
});

describe('pickStage0Assignee', () => {
  it('assigns nobody when no credit agent is configured', async () => {
    // Loudly unassigned beats quietly parked on whoever happened to be first in an env var.
    expect(await pickStage0Assignee(ctx, [])).toBeNull();
    expect(lastAssignedAt).not.toHaveBeenCalled();
  });

  it('does not query history for a single-agent desk', async () => {
    const picked = await pickStage0Assignee(ctx, ['9001']);
    expect(picked).toEqual({ zohoUserId: '9001', name: 'Agent 9001' });
    // One agent means one answer; a round trip to prove it would be a round trip per Deal polled.
    expect(lastAssignedAt).not.toHaveBeenCalled();
  });

  it('gives the case to whoever was assigned LEAST recently', async () => {
    lastAssignedAt.mockResolvedValue(
      new Map([
        ['9001', at('2026-08-18T10:00:00Z')],
        ['9002', at('2026-08-17T10:00:00Z')],
      ]),
    );
    const picked = await pickStage0Assignee(ctx, ['9001', '9002']);
    expect(picked?.zohoUserId).toBe('9002');
  });

  it('sends the first case to an agent who has NEVER been assigned', async () => {
    // Absent from the map = never assigned = has waited longest of all. This is what makes a new
    // joiner start receiving work immediately rather than after the incumbents catch up.
    lastAssignedAt.mockResolvedValue(new Map([['9001', at('2026-08-18T10:00:00Z')]]));
    const picked = await pickStage0Assignee(ctx, ['9001', '9002', '9003']);
    expect(picked?.zohoUserId).toBe('9002');
  });

  it('breaks a tie on DECLARATION ORDER, so a fresh desk behaves like the old single owner', async () => {
    // Nobody assigned yet: with no history, the configured order decides — which is the documented
    // meaning of that order, and it makes the first case land where it always used to.
    const picked = await pickStage0Assignee(ctx, ['9001', '9002']);
    expect(picked?.zohoUserId).toBe('9001');
  });

  it('keeps the incumbent when two agents were assigned at the same instant', async () => {
    const same = at('2026-08-18T10:00:00Z');
    lastAssignedAt.mockResolvedValue(
      new Map([
        ['9002', same],
        ['9001', same],
      ]),
    );
    expect((await pickStage0Assignee(ctx, ['9001', '9002']))?.zohoUserId).toBe('9001');
    expect((await pickStage0Assignee(ctx, ['9002', '9001']))?.zohoUserId).toBe('9002');
  });

  it('rotates: assigning the winner makes the other one next', async () => {
    lastAssignedAt.mockResolvedValue(new Map());
    const first = await pickStage0Assignee(ctx, ['9001', '9002']);
    expect(first?.zohoUserId).toBe('9001');

    // Simulate the assignment the ingest records for that pick.
    lastAssignedAt.mockResolvedValue(new Map([['9001', at('2026-08-18T10:00:00Z')]]));
    expect((await pickStage0Assignee(ctx, ['9001', '9002']))?.zohoUserId).toBe('9002');

    lastAssignedAt.mockResolvedValue(
      new Map([
        ['9001', at('2026-08-18T10:00:00Z')],
        ['9002', at('2026-08-18T10:05:00Z')],
      ]),
    );
    expect((await pickStage0Assignee(ctx, ['9001', '9002']))?.zohoUserId).toBe('9001');
  });

  /** A directory outage must not stop an application being assigned — the id is what joins. */
  it('still assigns when the directory cannot name the agent', async () => {
    resolveActAsTarget.mockRejectedValue(new Error('zoho users 500'));
    const picked = await pickStage0Assignee(ctx, ['9001']);
    expect(picked).toEqual({ zohoUserId: '9001', name: null });
  });

  it('reports a blank directory name as absent rather than as an empty label', async () => {
    resolveActAsTarget.mockResolvedValue({ zohoUserId: '9001', name: '   ' });
    expect((await pickStage0Assignee(ctx, ['9001']))?.name).toBeNull();
  });
});
