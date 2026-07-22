/**
 * Post-call Lead status wizard: fires on a finished outbound lead call, is forced (blocks close +
 * disables submit until valid), enforces the Status→reason pairing in the UI, and writes the lead.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { RingCentralCallEvent } from '@/components/ringcentral/ringcentralEvents';

const hoisted = vi.hoisted(() => ({
  cb: null as null | ((ev: RingCentralCallEvent) => void),
  updateLead: vi.fn(async () => ({ id: '555', updatedFields: ['Status'] })),
  invalidate: vi.fn(),
  leads: [{ id: '555', contact: 'Jane Trucker', company: 'JT LLC', phone: '+15551234567' }],
}));

vi.mock('@/components/ringcentral/ringcentralEvents', () => ({
  subscribeRingCentral: (fn: (ev: RingCentralCallEvent) => void) => {
    hoisted.cb = fn;
    return () => {
      hoisted.cb = null;
    };
  },
}));
vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('@/api/dataCenter', () => ({ updateLead: hoisted.updateLead }));
vi.mock('./dcCache', () => ({
  readDcCache: () => ({ data: hoisted.leads, ts: 0 }),
  invalidateDcCache: hoisted.invalidate,
}));

import { LeadCallWizardHost, reasonFieldFor } from './LeadCallWizard';

const pushToast = vi.fn();

function fireCall(ev: Partial<RingCentralCallEvent>) {
  act(() => {
    hoisted.cb?.({ kind: 'ended', direction: 'Outbound', peer: '+15551234567', at: 0, ...ev } as RingCentralCallEvent);
  });
}

beforeEach(() => {
  hoisted.updateLead.mockClear();
  hoisted.invalidate.mockClear();
  pushToast.mockClear();
});

describe('reasonFieldFor', () => {
  it('maps only Unqualified / Not Interested to a reason field', () => {
    expect(reasonFieldFor('Unqualified')?.field).toBe('Unqualified_Reason');
    expect(reasonFieldFor('Not Interested')?.field).toBe('Not_Interested_Reason');
    expect(reasonFieldFor('Interested')).toBeNull();
    expect(reasonFieldFor('First Call')).toBeNull();
  });
});

describe('LeadCallWizardHost', () => {
  it('does nothing for a deal call (no leadId) or an inbound call', () => {
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ dealId: 'D1' });
    fireCall({ leadId: '555', direction: 'Inbound' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a forced wizard on a lead call; Unqualified requires a reason before submit', async () => {
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555', durationMs: 30_000, result: 'Call connected' });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/update Jane Trucker/i)).toBeInTheDocument();

    // Forced: clicking the backdrop does not close — it nudges.
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(pushToast).toHaveBeenCalledWith('Update the lead', expect.any(String));

    const saveBtn = screen.getByRole('button', { name: /save status/i });
    expect(saveBtn).toBeDisabled(); // nothing picked yet

    fireEvent.click(screen.getByRole('radio', { name: 'Unqualified' }));
    // Reason group now shown, submit still blocked until a reason is chosen.
    expect(screen.getByRole('radio', { name: 'No response' })).toBeInTheDocument();
    expect(saveBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'No response' }));
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(hoisted.updateLead).toHaveBeenCalledWith(
        '555',
        expect.objectContaining({ Status: 'Unqualified', Unqualified_Reason: 'No response' }),
        undefined,
      ),
    );
    expect(hoisted.invalidate).toHaveBeenCalledWith('sales:leads');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a non-reason status (Interested) can submit immediately', async () => {
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555' });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('radio', { name: 'Interested' }));
    const saveBtn = screen.getByRole('button', { name: /save status/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(hoisted.updateLead).toHaveBeenCalledWith('555', expect.objectContaining({ Status: 'Interested' }), undefined),
    );
  });
});
