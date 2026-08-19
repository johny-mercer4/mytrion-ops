/**
 * CannedReplies — the composer's template picker.
 *
 * Opens on click, lists templates, inserts a body on selection, and saves the current draft as a new
 * template. Backend calls are mocked; this pins the composer-facing behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  listCannedReplies: vi.fn(),
  createCannedReply: vi.fn(),
  deleteCannedReply: vi.fn(),
}));
vi.mock('@/api/comms', () => api);

import { CannedReplies } from './CannedReplies';

beforeEach(() => {
  vi.clearAllMocks();
  api.listCannedReplies.mockResolvedValue([
    { id: 'mcr_1', title: 'Greeting', body: 'Hello, how can I help?', department: null },
  ]);
  api.createCannedReply.mockResolvedValue({ id: 'mcr_2', title: 'X', body: 'Y', department: null });
});

describe('CannedReplies', () => {
  it('inserts a template body on selection', async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    render(<CannedReplies currentDraft="" onInsert={onInsert} />);
    await user.click(screen.getByRole('button', { name: 'Canned replies' }));
    await user.click(await screen.findByText('Greeting'));
    expect(onInsert).toHaveBeenCalledWith('Hello, how can I help?');
  });

  it('saves the current draft as a new template', async () => {
    const user = userEvent.setup();
    render(<CannedReplies currentDraft="Please allow 24h for review." onInsert={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Canned replies' }));
    await user.type(screen.getByPlaceholderText(/Save the current draft as/), 'Review SLA');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(api.createCannedReply).toHaveBeenCalledWith({
        title: 'Review SLA',
        body: 'Please allow 24h for review.',
      }),
    );
  });
});
