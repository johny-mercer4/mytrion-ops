import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesAnnouncementCenter } from './SalesAnnouncementCenter';

const listSalesAnnouncements = vi.fn();
const markSalesAnnouncementRead = vi.fn();

vi.mock('../../../api/announcements', () => ({
  listSalesAnnouncements: () => listSalesAnnouncements(),
  markSalesAnnouncementRead: (id: string) => markSalesAnnouncementRead(id),
}));

const rows = [
  {
    id: 'man_new',
    title: 'Q3 Sales Target Update',
    body: 'Target raised to **12,000 gallons**.',
    targetDepartments: ['sales'],
    priority: 'normal',
    createdByUserId: 'zoho:42',
    publishedAt: '2026-08-13T12:00:00.000Z',
    createdAt: '2026-08-13T12:00:00.000Z',
    read: false,
    readAt: null,
  },
  {
    id: 'man_read',
    title: 'System Maintenance',
    body: 'The CRM will be unavailable Saturday.',
    targetDepartments: ['sales'],
    priority: 'high',
    createdByUserId: 'zoho:42',
    publishedAt: '2026-08-12T12:00:00.000Z',
    createdAt: '2026-08-12T12:00:00.000Z',
    read: true,
    readAt: '2026-08-12T14:00:00.000Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listSalesAnnouncements.mockResolvedValue(rows);
  markSalesAnnouncementRead.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('SalesAnnouncementCenter', () => {
  it('separates new and archived announcements', async () => {
    render(<SalesAnnouncementCenter />);
    expect(await screen.findByText('Q3 Sales Target Update')).toBeVisible();
    expect(screen.queryByText('System Maintenance')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));
    expect(await screen.findByText('System Maintenance')).toBeVisible();
    expect(screen.queryByText('Q3 Sales Target Update')).not.toBeInTheDocument();
  });

  it('keeps Close unread and moves Got it to Archive after the API succeeds', async () => {
    render(<SalesAnnouncementCenter />);
    fireEvent.click(await screen.findByRole('button', { name: /Q3 Sales Target Update/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(markSalesAnnouncementRead).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Q3 Sales Target Update/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(markSalesAnnouncementRead).toHaveBeenCalledWith('man_new'));
  });
});
