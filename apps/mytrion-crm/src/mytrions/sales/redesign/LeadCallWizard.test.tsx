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
  leads: [{ id: '555', contact: 'Jane Trucker', company: 'JT LLC', phone: '+15551234567' }] as Array<{
    id: string;
    contact: string;
    company: string;
    phone: string;
    status?: string;
  }>,
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
import { allowedStatuses, resolveWizardStatus } from './leadStatusFlow';

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
  // Default cached lead has no status → treated as "unknown" (wizard opens, nothing pre-selected).
  hoisted.leads = [{ id: '555', contact: 'Jane Trucker', company: 'JT LLC', phone: '+15551234567' }];
});

describe('resolveWizardStatus', () => {
  it('advances through the call sequence and stays at Third Call', () => {
    expect(resolveWizardStatus('Unaccounted')).toEqual({ show: true, preselect: 'First Call' });
    expect(resolveWizardStatus('New Lead')).toEqual({ show: true, preselect: 'First Call' });
    expect(resolveWizardStatus('No Status')).toEqual({ show: true, preselect: 'First Call' });
    expect(resolveWizardStatus('First Call')).toEqual({ show: true, preselect: 'Second Call' });
    expect(resolveWizardStatus('Second Call')).toEqual({ show: true, preselect: 'Third Call' });
    expect(resolveWizardStatus('Third Call')).toEqual({ show: true, preselect: '' });
  });
  it('does not force the wizard for already-categorized statuses', () => {
    for (const st of ['Interested', 'Not Interested', 'Unqualified', 'Application Filled', 'Follow-up', 'Email Follow-Up']) {
      expect(resolveWizardStatus(st).show).toBe(false);
    }
  });
  it('opens with no pre-selection when the current status is unknown', () => {
    expect(resolveWizardStatus(null)).toEqual({ show: true, preselect: '' });
  });
});

describe('allowedStatuses (Zoho Leads blueprint)', () => {
  const vals = (st: string | null) => allowedStatuses(st).map((o) => o.value);
  it('keeps the call sequence strict — one step, no skip-ahead or jump back', () => {
    expect(vals('New Lead')).toContain('First Call');
    expect(vals('First Call')).toEqual(['Second Call']);
    expect(vals('Second Call')).toEqual(['Third Call']);
    expect(vals('First Call')).not.toContain('Third Call');
    expect(vals('Second Call')).not.toContain('First Call');
  });
  it('triages at New Lead and takes outcomes only after the third call', () => {
    expect(vals('New Lead')).toEqual(expect.arrayContaining(['Interested', 'Not Interested']));
    expect(vals('Third Call')).toEqual(expect.arrayContaining(['Follow-up', 'Email Follow-Up', 'Unqualified']));
    expect(vals('First Call')).not.toContain('Interested'); // outcomes aren't reachable mid-calls
  });
  it('never offers Application Filled manually (automation-only)', () => {
    for (const st of ['New Lead', 'First Call', 'Second Call', 'Third Call', null]) {
      expect(vals(st)).not.toContain('Application Filled');
    }
    expect(allowedStatuses(null)).toHaveLength(9); // all statuses except Application Filled
  });
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

  it('can be closed with the X button — call still logged, status not forced', async () => {
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555' });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(hoisted.updateLead).not.toHaveBeenCalled();
  });

  it('opens a forced wizard on a lead call; Unqualified requires a reason before submit', async () => {
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555', durationMs: 30_000, result: 'Call connected' });

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/update Jane Trucker/i)).toBeInTheDocument();

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

  it('pre-selects the next call status from the lead current status (First → Second Call)', async () => {
    hoisted.leads = [{ id: '555', contact: 'Jane Trucker', company: 'JT LLC', phone: '+15551234567', status: 'First Call' }];
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555' });
    await screen.findByRole('dialog');
    expect(screen.getByRole('radio', { name: 'Second Call' })).toBeChecked();
    const saveBtn = screen.getByRole('button', { name: /save status/i });
    expect(saveBtn).not.toBeDisabled(); // pre-selected → one-click save
    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(hoisted.updateLead).toHaveBeenCalledWith('555', expect.objectContaining({ Status: 'Second Call' }), undefined),
    );
  });

  it('a New Lead first call pre-selects First Call', async () => {
    hoisted.leads = [{ id: '555', contact: 'Jane Trucker', company: 'JT LLC', phone: '+15551234567', status: 'Unaccounted' }];
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555' });
    await screen.findByRole('dialog');
    expect(screen.getByRole('radio', { name: 'First Call' })).toBeChecked();
  });

  it('does not force the wizard for an already-categorized lead (Interested)', () => {
    hoisted.leads = [{ id: '555', contact: 'Jane Trucker', company: 'JT LLC', phone: '+15551234567', status: 'Interested' }];
    render(<LeadCallWizardHost pushToast={pushToast} />);
    fireCall({ leadId: '555' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
