/**
 * DeskTicketTags — the ticket tag chip editor.
 *
 * Adding sends the full desired set (existing + new); removing sends the set minus one. Both are
 * optimistic, so the assertions are just on what reached the API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TicketDto } from '@/api/comms';

const api = vi.hoisted(() => ({ setTicketTags: vi.fn() }));
vi.mock('@/api/comms', () => api);

import { DeskTicketTags } from './DeskTicketTags';

// The editor only reads id + tags; cast a minimal object rather than build a full TicketDto.
const ticket = (tags: string[]): TicketDto => ({ id: 'mtk_1', tags }) as unknown as TicketDto;

beforeEach(() => {
  vi.clearAllMocks();
  api.setTicketTags.mockResolvedValue({ ticket: ticket([]) });
});

describe('DeskTicketTags', () => {
  it('adds a tag on Enter, sending existing + new', async () => {
    const user = userEvent.setup();
    render(<DeskTicketTags ticket={ticket(['fraud'])} />);
    await user.type(screen.getByLabelText('Add a tag'), 'urgent{Enter}');
    await waitFor(() => expect(api.setTicketTags).toHaveBeenCalledWith('mtk_1', ['fraud', 'urgent']));
  });

  it('does not add a duplicate (case-insensitive)', async () => {
    const user = userEvent.setup();
    render(<DeskTicketTags ticket={ticket(['Fraud'])} />);
    await user.type(screen.getByLabelText('Add a tag'), 'fraud{Enter}');
    expect(api.setTicketTags).not.toHaveBeenCalled();
  });

  it('removes a tag', async () => {
    const user = userEvent.setup();
    render(<DeskTicketTags ticket={ticket(['fraud', 'vip'])} />);
    await user.click(screen.getByRole('button', { name: 'Remove tag fraud' }));
    await waitFor(() => expect(api.setTicketTags).toHaveBeenCalledWith('mtk_1', ['vip']));
  });
});
