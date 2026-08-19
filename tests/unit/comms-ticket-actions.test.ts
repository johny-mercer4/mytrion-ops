/**
 * `modules/comms/ticketActions.ts` — the manual ticket status transition, with every collaborator
 * mocked at the module boundary. Asserts the two properties that matter: the transition carries the
 * version the agent saw (so the repo's WHERE settles a race), and a stale version returns null
 * WITHOUT journaling or broadcasting a change that did not happen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MytrionTicket } from '../../src/db/schema/index.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const state = vi.hoisted(() => ({ transitionStatus: vi.fn(), setPriority: vi.fn(), setTags: vi.fn() }));
const events = vi.hoisted(() => ({ append: vi.fn(async () => undefined) }));
const publish = vi.hoisted(() => ({
  publishSafely: vi.fn((_label: string, fn: () => void) => fn()),
  publishThreadEvent: vi.fn(() => ({ thread: 0, lanes: 0 })),
}));

vi.mock('../../src/repos/commsThreadRepo.js', () => ({
  actorZohoUserIdOf: (ctx: { userId?: string }) =>
    ctx.userId?.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null,
}));
vi.mock('../../src/repos/commsTicketStateRepo.js', () => ({ commsTicketStateRepo: state }));
vi.mock('../../src/repos/commsTicketEventRepo.js', () => ({ commsTicketEventRepo: events }));
vi.mock('../../src/modules/comms/publish.js', () => publish);

import {
  changeTicketPriority,
  changeTicketStatus,
  normalizeTags,
  setTicketTags,
} from '../../src/modules/comms/ticketActions.js';

// Test doubles — only the fields the service reads are populated.
const ctx = { tenantId: 'octane', userId: 'zoho:42', userName: 'Ali', audience: 'internal' } as unknown as TenantContext;
const ticket = {
  id: 'mtk_1',
  threadId: 'mth_1',
  number: 'T-000001',
  status: 'open',
  priority: 'medium',
  targetDepartment: 'customer-service',
  version: 3,
} as unknown as MytrionTicket;

beforeEach(() => vi.clearAllMocks());

describe('changeTicketStatus', () => {
  it('transitions under the seen version, journals it, and returns the updated ticket', async () => {
    state.transitionStatus.mockResolvedValue({ id: 'mtk_1', status: 'resolved', version: 4 });

    const result = await changeTicketStatus(ctx, ticket, { toStatus: 'resolved', expectedVersion: 3 });

    expect(result).not.toBeNull();
    expect(state.transitionStatus).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        ticketId: 'mtk_1',
        expectedVersion: 3,
        toStatus: 'resolved',
        actorZohoUserId: '42',
      }),
    );
    expect(events.append).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        ticketId: 'mtk_1',
        eventType: 'status_changed',
        fromStatus: 'open',
        toStatus: 'resolved',
      }),
    );
    expect(publish.publishThreadEvent).toHaveBeenCalled();
  });

  it('returns null on a stale version and does NOT journal or broadcast', async () => {
    state.transitionStatus.mockResolvedValue(undefined);

    const result = await changeTicketStatus(ctx, ticket, { toStatus: 'closed', expectedVersion: 1 });

    expect(result).toBeNull();
    expect(events.append).not.toHaveBeenCalled();
    expect(publish.publishThreadEvent).not.toHaveBeenCalled();
  });
});

describe('changeTicketPriority', () => {
  it('changes priority under the seen version, journals from→to, and broadcasts', async () => {
    state.setPriority.mockResolvedValue({ id: 'mtk_1', priority: 'high', version: 4 });

    const result = await changeTicketPriority(ctx, ticket, { toPriority: 'high', expectedVersion: 3 });

    expect(result).not.toBeNull();
    expect(state.setPriority).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ ticketId: 'mtk_1', expectedVersion: 3, toPriority: 'high' }),
    );
    expect(events.append).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        ticketId: 'mtk_1',
        eventType: 'priority_changed',
        detail: { from: 'medium', to: 'high' },
      }),
    );
    expect(publish.publishThreadEvent).toHaveBeenCalled();
  });

  it('returns null on a stale version and does NOT journal or broadcast', async () => {
    state.setPriority.mockResolvedValue(undefined);

    const result = await changeTicketPriority(ctx, ticket, { toPriority: 'low', expectedVersion: 1 });

    expect(result).toBeNull();
    expect(events.append).not.toHaveBeenCalled();
    expect(publish.publishThreadEvent).not.toHaveBeenCalled();
  });
});

describe('normalizeTags', () => {
  it('trims, collapses whitespace, drops blanks, and dedupes case-insensitively', () => {
    expect(normalizeTags([' fraud ', 'Fraud', '', '  ', 'vip  customer'])).toEqual([
      'fraud',
      'vip customer',
    ]);
  });

  it('caps the count at 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(normalizeTags(many)).toHaveLength(20);
  });
});

describe('setTicketTags', () => {
  it('writes the normalised set, journals `tagged`, and broadcasts', async () => {
    state.setTags.mockResolvedValue({ id: 'mtk_1', tags: ['fraud'] });

    const result = await setTicketTags(ctx, ticket, [' Fraud ', 'fraud']);

    expect(result).not.toBeNull();
    expect(state.setTags).toHaveBeenCalledWith(ctx, 'mtk_1', ['Fraud']);
    expect(events.append).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ ticketId: 'mtk_1', eventType: 'tagged', detail: { tags: ['Fraud'] } }),
    );
    expect(publish.publishThreadEvent).toHaveBeenCalled();
  });
});
