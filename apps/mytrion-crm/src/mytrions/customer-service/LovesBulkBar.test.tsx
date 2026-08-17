/**
 * Bulk Love's clearance push (QA feedback, Dina Carter 2026-08-07). ApplicationsTable disables
 * selection for ineligible rows before this bar ever sees them, so these tests only cover the
 * push/confirm/summary flow itself, not the eligibility gate (see data.test.ts for that).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { bulkSetLovesVerification } from '@/api/cs';
import { LovesBulkBar } from './LovesBulkBar';
import type { Application } from './data';

vi.mock('@/api/cs', () => ({
  bulkSetLovesVerification: vi.fn(),
}));

function app(id: string, company: string): Application {
  return {
    id,
    appId: id,
    company,
    first: 'Jane',
    last: 'Doe',
    biz: 'LLC',
    stage: 'Application',
    wex: '',
    mc: '',
    dot: '',
    phone: '',
    email: '',
    street: '',
    city: 'Chicago',
    state: 'IL',
    zip: '60612',
    credit: null,
    trucks: 1,
    cards: 1,
    date: '',
    dateFilledRaw: '',
    agent: 'not assigned',
    notes: '',
    cycle: '',
    pay: '',
    ta: 0,
    efs: 0,
    lmt: 0,
    mob: 0,
    chn: 0,
    verified: false,
    carrierId: '',
    lovesVerification: '',
  };
}

describe('LovesBulkBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selection count and pushes the confirmed value for every selected id', async () => {
    vi.mocked(bulkSetLovesVerification).mockResolvedValue({
      results: [
        { id: '1', ok: true },
        { id: '2', ok: true },
      ],
    });
    const onDone = vi.fn();
    render(
      <div className="cs-root">
        <LovesBulkBar selected={[app('1', 'Acme'), app('2', 'Beta')]} onDone={onDone} onClear={vi.fn()} />
      </div>,
    );

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    // Confirm dialog gates the actual call.
    expect(bulkSetLovesVerification).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approved' }));

    await waitFor(() => expect(bulkSetLovesVerification).toHaveBeenCalledWith(['1', '2'], 'Approved'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ succeeded: 2, failed: 0, errors: [] }));
  });

  it('reports partial failures by company name, not raw id', async () => {
    vi.mocked(bulkSetLovesVerification).mockResolvedValue({
      results: [
        { id: '1', ok: true },
        { id: '2', ok: false, error: 'Cannot save — missing required field(s): City' },
      ],
    });
    const onDone = vi.fn();
    render(
      <div className="cs-root">
        <LovesBulkBar selected={[app('1', 'Acme'), app('2', 'Beta')]} onDone={onDone} onClear={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not Approved' }));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not Approved' }));

    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        succeeded: 1,
        failed: 1,
        errors: ['Beta: Cannot save — missing required field(s): City'],
      }),
    );
  });

  it('clear selection calls onClear directly, without a confirm step', () => {
    const onClear = vi.fn();
    render(
      <div className="cs-root">
        <LovesBulkBar selected={[app('1', 'Acme')]} onDone={vi.fn()} onClear={onClear} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalled();
    expect(bulkSetLovesVerification).not.toHaveBeenCalled();
  });
});
