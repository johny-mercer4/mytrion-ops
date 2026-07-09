/**
 * AutomationModal state machine: Run is disabled until a client is picked; success
 * renders the outcome inline and fires exactly one usage log; failure shows the error
 * message with no log fired.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { runMock, logMock } = vi.hoisted(() => ({ runMock: vi.fn(), logMock: vi.fn() }));
vi.mock('@/api/touchpoints', () => ({ callTouchpoint: vi.fn(), logAutomation: logMock }));
vi.mock('./automations/specs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./automations/specs')>();
  return {
    ...mod,
    AUTOMATION_SPECS: { balance: { run: runMock } },
  };
});
vi.mock('./automations/CarrierPicker', () => ({
  CarrierPicker: ({
    value,
    onChange,
  }: {
    value: { companyName: string } | null;
    onChange: (t: { carrierId: string; applicationId: null; companyName: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onChange({ carrierId: '123', applicationId: null, companyName: 'Acme Trucking' })}
    >
      {value ? value.companyName : 'pick-client'}
    </button>
  ),
}));

import { AutomationModal } from './AutomationModal';
import { ToastProvider } from './Toast';
import type { Automation } from './data';

const automation: Automation = {
  id: 'balance',
  codes: ['C-8'],
  title: 'Balance Check',
  desc: 'View the current account balance for a carrier.',
  showRange: false,
  comingSoon: false,
};

function renderModal() {
  return render(
    <ToastProvider>
      <AutomationModal automation={automation} onClose={() => undefined} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AutomationModal', () => {
  it('disables Run until a client is picked, then runs and renders the outcome + one log', async () => {
    runMock.mockResolvedValueOnce({
      kind: 'kv',
      title: 'Balance',
      rows: [{ label: 'EFS balance', value: '$812.40' }],
    });
    const user = userEvent.setup();
    renderModal();

    const runBtn = screen.getByRole('button', { name: /run action/i });
    expect(runBtn).toBeDisabled();

    await user.click(screen.getByText('pick-client'));
    expect(runBtn).toBeEnabled();

    await user.click(runBtn);
    await waitFor(() => expect(screen.getByText('$812.40')).toBeInTheDocument());
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledTimes(1);
    expect(logMock).toHaveBeenCalledWith('balance');
    expect(screen.getByRole('button', { name: /run again/i })).toBeInTheDocument();
  });

  it('shows the error message inline and fires no log on failure', async () => {
    runMock.mockRejectedValueOnce(new Error('Carrier 123 is not in your client list'));
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText('pick-client'));
    await user.click(screen.getByRole('button', { name: /run action/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('not in your client list'),
    );
    expect(logMock).not.toHaveBeenCalled();
  });
});
