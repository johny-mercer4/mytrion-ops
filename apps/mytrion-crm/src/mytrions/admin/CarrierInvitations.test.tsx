import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CarrierInvitations } from './CarrierInvitations';
import type { CarrierInvitation } from '../../api/carrierUsers';

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

function invite(over: Partial<CarrierInvitation> & { id: string }): CarrierInvitation {
  return {
    profile: 'owner',
    carrierId: '5758544',
    applicationId: null,
    companyName: 'Acme Transport',
    cardId: null,
    driverName: null,
    companyType: null,
    cardCount: null,
    agentName: null,
    agentZohoUserId: null,
    status: 'pending',
    expiresAt: hours(48),
    createdAt: hours(-24),
    inviteUrl: 'https://t.me/bot?start=abc',
    ...over,
  };
}

const INVITES = [
  invite({ id: 'live', companyName: 'Live Co' }),
  invite({ id: 'expired', companyName: 'Expired Co', expiresAt: hours(-2) }),
  invite({ id: 'redeemed', companyName: 'Redeemed Co', status: 'redeemed' }),
  invite({ id: 'cancelled', companyName: 'Cancelled Co', status: 'cancelled' }),
];

function setup(over: Partial<Parameters<typeof CarrierInvitations>[0]> = {}) {
  const props = {
    invitations: INVITES,
    loading: false,
    error: '',
    busyId: null,
    onRefresh: vi.fn(),
    onCopy: vi.fn(),
    onCancel: vi.fn(),
    onReissue: vi.fn(),
    ...over,
  };
  render(<CarrierInvitations {...props} />);
  return { ...props, user: userEvent.setup() };
}

const rowFor = (name: string) => screen.getByText(name).closest('[role="row"]') as HTMLElement;

describe('CarrierInvitations', () => {
  it('is a real table, not a pile of divs', () => {
    setup();

    const table = screen.getByRole('table', { name: 'Carrier invitations' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Company',
      'Type',
      'Carrier',
      'Status',
      'Expires',
      'Actions',
    ]);
  });

  it('shows an elapsed pending link as Expired, in title case', () => {
    setup();

    expect(within(rowFor('Expired Co')).getByText('Expired')).toBeInTheDocument();
    expect(within(rowFor('Live Co')).getByText('Pending')).toBeInTheDocument();
  });

  it('filters by status, counting what survived', async () => {
    const { user } = setup();
    expect(screen.getByText('4 total')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Expired' }));

    expect(screen.getByText('Expired Co')).toBeInTheDocument();
    expect(screen.queryByText('Live Co')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
  });

  it('filters by text across company and carrier', async () => {
    const { user } = setup();

    await user.type(screen.getByPlaceholderText(/Filter — company/), 'redeemed');

    expect(screen.getByText('Redeemed Co')).toBeInTheDocument();
    expect(screen.queryByText('Live Co')).not.toBeInTheDocument();
  });

  it('offers Copy and Cancel only on a live link', () => {
    setup();

    expect(within(rowFor('Live Co')).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(within(rowFor('Live Co')).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(rowFor('Expired Co')).queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  // A spent link used to leave a row with no action at all — there is no resend endpoint, so the
  // honest move is seeding a fresh draft.
  it('offers a new link on spent invites, but not on a redeemed one', async () => {
    const { onReissue, user } = setup();

    await user.click(within(rowFor('Expired Co')).getByRole('button', { name: 'New link' }));
    expect(onReissue).toHaveBeenCalledWith(expect.objectContaining({ id: 'expired' }));

    expect(within(rowFor('Cancelled Co')).getByRole('button', { name: 'New link' })).toBeInTheDocument();
    // Redeemed is a finished job, not a failure to retry.
    expect(within(rowFor('Redeemed Co')).queryByRole('button', { name: 'New link' })).not.toBeInTheDocument();
  });

  it('hands the invite url to the copy handler', async () => {
    const { onCopy, user } = setup();

    await user.click(within(rowFor('Live Co')).getByRole('button', { name: 'Copy' }));
    expect(onCopy).toHaveBeenCalledWith('https://t.me/bot?start=abc');
  });

  it('shows expiry as relative time with the absolute in the tooltip', () => {
    setup();

    const cell = within(rowFor('Live Co')).getByTitle(new Date(INVITES[0]!.expiresAt).toLocaleString());
    expect(cell.textContent).toContain('in 2 days');
  });

  it('shows an elapsed expiry as time past, so the row reads as dead', () => {
    setup();
    expect(within(rowFor('Expired Co')).getByText(/ago/)).toBeInTheDocument();
  });

  // Caught on the running app: a redeemed link kept counting down ("in 7 days") next to its
  // Redeemed pill, which reads as still-live. Once settled, the expiry means nothing.
  it('drops the countdown once the invite is redeemed or cancelled', () => {
    setup();

    expect(within(rowFor('Redeemed Co')).queryByText(/in \d|ago/)).not.toBeInTheDocument();
    expect(within(rowFor('Cancelled Co')).queryByText(/in \d|ago/)).not.toBeInTheDocument();
    expect(within(rowFor('Redeemed Co')).getByText('—')).toBeInTheDocument();
  });

  it('distinguishes an empty result set from an empty table', async () => {
    const { user } = setup();

    await user.type(screen.getByPlaceholderText(/Filter — company/), 'nothing-matches-this');
    expect(screen.getByText('No invitations match this filter.')).toBeInTheDocument();
  });

  it('says the table is empty when there is nothing at all', () => {
    setup({ invitations: [] });
    expect(screen.getByText('No invitations yet.')).toBeInTheDocument();
  });
});
