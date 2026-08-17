/**
 * Required-fields hard block (QA feedback, Dina Carter 2026-08-07): First Name, Last Name, City,
 * and Zip Code must be non-blank before ANY save goes through — mirrored server-side in
 * applicationsSave.ts (see tests/unit/cs-routes.test.ts for that half). This file covers only the
 * new gate; the rest of the modal's save/diff/validation behavior is exercised there already.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { saveApplication } from '@/api/cs';
import { ApplicationModal } from './ApplicationModal';
import type { Application } from './data';

vi.mock('@/api/cs', () => ({
  saveApplication: vi.fn().mockResolvedValue({ id: '123', updatedFields: [], dealId: null, dealSyncedFields: 0 }),
}));

function baseApp(overrides: Partial<Application> = {}): Application {
  return {
    id: '123',
    appId: '123',
    company: 'Vasyuchka Service INC',
    first: 'Jane',
    last: 'Doe',
    biz: 'LLC',
    stage: 'Application',
    wex: 'Cards Produced',
    mc: '',
    dot: '',
    phone: '7738925355',
    email: 'vasyuchka@example.com',
    street: '2544 W Superior st',
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
    ...overrides,
  };
}

function renderModal(app: Application) {
  const onSaved = vi.fn();
  render(
    <div className="cs-root">
      <ApplicationModal app={app} subTab="apps" onClose={vi.fn()} onSaved={onSaved} />
    </div>,
  );
  return { onSaved };
}

describe('ApplicationModal — required fields on save', () => {
  it('blocks the save and explains why when First/Last Name were already blank and untouched', async () => {
    const { onSaved } = renderModal(baseApp({ first: '', last: '' }));

    fireEvent.change(screen.getByLabelText('Customer Service Notes'), {
      target: { value: 'called back, will call again tomorrow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/please fix/i)).toBeInTheDocument());
    expect(screen.getByText('First Name is required')).toBeInTheDocument();
    expect(screen.getByText('Last Name is required')).toBeInTheDocument();
    expect(saveApplication).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('blocks clearing a required field to blank in the same edit', async () => {
    renderModal(baseApp());

    fireEvent.change(screen.getByLabelText('Zip Code'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByText('Zip Code is required')).toBeInTheDocument());
    expect(saveApplication).not.toHaveBeenCalled();
  });

  it('allows the save once every required field is filled in', async () => {
    const { onSaved } = renderModal(baseApp({ city: '' }));

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(saveApplication).toHaveBeenCalledWith('123', { City: 'Chicago' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('does not re-flag a field that is already correctly filled', async () => {
    renderModal(baseApp());

    fireEvent.change(screen.getByLabelText('Customer Service Notes'), { target: { value: 'note' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(saveApplication).toHaveBeenCalled());
    expect(screen.queryByText(/please fix/i)).not.toBeInTheDocument();
  });
});
