import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const hoisted = vi.hoisted(() => ({
  getLeadBlueprint: vi.fn(),
}));

vi.mock('@/api/dataCenter', () => ({ getLeadBlueprint: hoisted.getLeadBlueprint }));
vi.mock('@/api/impersonation', () => ({ getImpersonation: () => ({ zohoUserId: '42' }) }));

import { LeadBlueprintEditor } from './LeadBlueprintEditor';

const liveBlueprint = {
  process: {
    id: '6227679000162301360',
    name: 'Lead flow',
    fieldApiName: 'Status',
    fieldLabel: 'Status',
    currentValue: 'Third Call',
  },
  transitions: [
    {
      id: '6227679000162301999',
      name: 'Unqualified',
      nextValue: 'Unqualified',
      type: 'manual',
      criteriaMatched: true,
      criteriaMessage: '',
      fields: [{
        apiName: 'Unqualified_Reason',
        label: 'Unqualified reason',
        dataType: 'picklist',
        mandatory: true,
        readOnly: false,
        value: null,
        options: [{ label: 'No response', value: 'No response' }],
      }],
    },
    {
      id: '2', name: 'Auto call', nextValue: 'First Call', type: 'automatic',
      criteriaMatched: true, criteriaMessage: '', fields: [],
    },
    {
      id: '3', name: 'Blocked', nextValue: 'Interested', type: 'manual',
      criteriaMatched: false, criteriaMessage: 'Criteria not met', fields: [],
    },
  ],
};

beforeEach(() => {
  hoisted.getLeadBlueprint.mockReset();
  hoisted.getLeadBlueprint.mockResolvedValue(liveBlueprint);
});

describe('LeadBlueprintEditor', () => {
  it('loads record-specific manual transitions and collects required Blueprint data', async () => {
    const onChange = vi.fn();
    render(<LeadBlueprintEditor leadId="555" onChange={onChange} />);

    expect(await screen.findByText('Third Call')).toBeInTheDocument();
    expect(hoisted.getLeadBlueprint).toHaveBeenCalledWith('555', '42');
    expect(screen.getByRole('radio', { name: 'Unqualified' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'First Call' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Interested' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Unqualified' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      transitionId: '6227679000162301999', nextValue: 'Unqualified', valid: false,
    }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Unqualified reason' }), {
      target: { value: 'No response' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      transitionId: '6227679000162301999',
      nextValue: 'Unqualified',
      data: { Unqualified_Reason: 'No response' },
      valid: true,
    });
  });

  it('shows explicit no-process and vendor-error states', async () => {
    hoisted.getLeadBlueprint.mockResolvedValueOnce(null);
    const { unmount } = render(<LeadBlueprintEditor leadId="555" onChange={vi.fn()} />);
    expect(await screen.findByText(/not in an active Zoho Blueprint/i)).toBeInTheDocument();
    unmount();

    hoisted.getLeadBlueprint.mockRejectedValueOnce(new Error('forbidden'));
    render(<LeadBlueprintEditor leadId="556" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/couldn’t load Zoho Blueprint transitions/i)).toBeInTheDocument());
  });
});
