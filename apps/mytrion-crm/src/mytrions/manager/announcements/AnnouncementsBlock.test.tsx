import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsBlock } from './AnnouncementsBlock';

const listManagerAnnouncements = vi.fn();
const publishManagerAnnouncement = vi.fn();

vi.mock('../../../api/announcements', () => ({
  listManagerAnnouncements: () => listManagerAnnouncements(),
  publishManagerAnnouncement: (input: unknown) => publishManagerAnnouncement(input),
}));

beforeEach(() => {
  vi.clearAllMocks();
  listManagerAnnouncements.mockResolvedValue([]);
  publishManagerAnnouncement.mockResolvedValue({ id: 'man_1' });
});

describe('AnnouncementsBlock', () => {
  it('updates the Sales preview as the manager composes', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Q3 Sales Target Update' },
    });
    fireEvent.change(screen.getByPlaceholderText('Share the update and any next steps…'), {
      target: { value: 'Target raised to **12,000 gallons**.' },
    });

    const preview = within(screen.getByLabelText('Live Sales preview'));
    expect(preview.getByRole('heading', { name: 'Q3 Sales Target Update' })).toBeVisible();
    expect(preview.getByText('12,000 gallons')).toBeVisible();
  });

  it('publishes a targeted announcement and reloads the published list', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByPlaceholderText('Share the update and any next steps…'), {
      target: { value: 'CRM maintenance starts at 8 PM.' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'High priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));

    await waitFor(() =>
      expect(publishManagerAnnouncement).toHaveBeenCalledWith({
        title: 'Maintenance',
        body: 'CRM maintenance starts at 8 PM.',
        targetDepartments: ['sales'],
        priority: 'high',
      }),
    );
    await waitFor(() => expect(listManagerAnnouncements).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Published to Sales.');
  });
});
