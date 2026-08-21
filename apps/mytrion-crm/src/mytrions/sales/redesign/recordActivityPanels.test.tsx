import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotesPanel } from './recordActivityPanels';

const api = vi.hoisted(() => ({
  createRecordNote: vi.fn(),
  deleteRecordNote: vi.fn(),
  listRecordCalls: vi.fn(),
  listRecordNotes: vi.fn(),
  updateRecordNote: vi.fn(),
}));
const pushToast = vi.hoisted(() => vi.fn());

vi.mock('@/api/dataCenter', () => api);
vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('./ctx', () => ({ useSales: () => ({ pushToast }) }));
vi.mock('./createTicketShared', () => ({ AttachZone: () => null }));

const manageable = {
  id: '1001',
  title: 'Owned title',
  content: 'Owned content',
  createdAt: '2026-08-22T10:00:00.000Z',
  owner: 'Agent One',
  canManage: true,
};
const readOnly = {
  id: '1002',
  title: 'Other title',
  content: 'Other content',
  createdAt: '2026-08-22T09:00:00.000Z',
  owner: 'Agent Two',
  canManage: false,
};

describe('NotesPanel note controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listRecordNotes.mockResolvedValue([manageable, readOnly]);
    api.updateRecordNote.mockResolvedValue({
      id: manageable.id,
      updatedFields: ['Note_Title', 'Note_Content'],
    });
    api.deleteRecordNote.mockResolvedValue({ id: manageable.id, deleted: true });
  });

  it('shows actions only for server-authorized notes and submits the prefilled edit form', async () => {
    render(<NotesPanel kind="leads" id="9001" />);

    expect(await screen.findByText('Owned content')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit note' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete note' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('Owned title');
    expect(screen.getByRole('textbox', { name: 'Note content' })).toHaveValue('Owned content');

    fireEvent.change(screen.getByRole('textbox', { name: 'Note title' }), {
      target: { value: 'Updated title' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note content' }), {
      target: { value: 'Updated content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.updateRecordNote).toHaveBeenCalledWith(
        'leads',
        '9001',
        '1001',
        { title: 'Updated title', content: 'Updated content' },
        undefined,
      ),
    );
    expect(await screen.findByText('Updated content')).toBeInTheDocument();
  });

  it('requires confirmation before deleting and removes the note only after success', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<NotesPanel kind="deals" id="9002" />);

    expect(await screen.findByText('Owned content')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(confirm).toHaveBeenCalledWith('Delete this note? This cannot be undone.');
    await waitFor(() =>
      expect(api.deleteRecordNote).toHaveBeenCalledWith('deals', '9002', '1001', undefined),
    );
    await waitFor(() => expect(screen.queryByText('Owned content')).not.toBeInTheDocument());
  });
});
