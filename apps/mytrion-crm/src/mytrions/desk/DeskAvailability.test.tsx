/**
 * DeskAvailability — the agent work-mode picker.
 *
 * Verifies the three modes render, that choosing one posts it (with the optional note) and reports the
 * new value back to the parent, and that a server error is surfaced rather than silently swallowed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AvailabilityDto } from '@/api/comms';

const api = vi.hoisted(() => ({ setMyAvailability: vi.fn() }));
vi.mock('@/api/comms', () => api);

import { DeskAvailability } from './DeskAvailability';

const avail = (over: Partial<AvailabilityDto> = {}): AvailabilityDto => ({
  zohoUserId: '42',
  availability: 'available',
  availabilityNote: null,
  autoAway: false,
  autoAwayReason: null,
  changedAt: '2026-08-20T10:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.setMyAvailability.mockResolvedValue(avail({ availability: 'away' }));
});

describe('DeskAvailability', () => {
  it('offers the three work modes', () => {
    render(<DeskAvailability open current={avail()} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByRole('button', { name: /Available/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Away/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Do not assign/ })).toBeInTheDocument();
  });

  it('posts the chosen mode and reports it back, then closes', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<DeskAvailability open current={avail()} onClose={onClose} onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: /Away/ }));
    await waitFor(() => expect(api.setMyAvailability).toHaveBeenCalledWith('away', undefined));
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ availability: 'away' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces a server error', async () => {
    const user = userEvent.setup();
    api.setMyAvailability.mockRejectedValue(new Error('presence backend down'));
    render(<DeskAvailability open current={avail()} onClose={() => {}} onChanged={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Do not assign/ }));
    expect(await screen.findByText(/presence backend down/)).toBeInTheDocument();
  });
});
