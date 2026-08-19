/**
 * SavedViews — client-side named filter presets.
 *
 * State-first by design (localStorage is best-effort), so these assertions hold even where the test
 * environment's localStorage is flaky: save a view, see it listed, apply it (reports filter+term back),
 * and delete it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavedViews } from './SavedViews';

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* env without a working localStorage — the component tolerates it, so does the test */
  }
});

describe('SavedViews', () => {
  it('saves the current filter under a name, then applies it', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <SavedViews viewsKey="test:tickets" current={{ filter: 'open', term: 'fraud' }} onApply={onApply} />,
    );

    await user.click(screen.getByRole('button', { name: 'Saved views' }));
    await user.type(screen.getByPlaceholderText(/Name this view/), 'My fraud');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Now listed…
    expect(screen.getByText('My fraud')).toBeInTheDocument();
    // …and applying it reports the stored filter + term back to the console.
    await user.click(screen.getByText('My fraud'));
    expect(onApply).toHaveBeenCalledWith({ filter: 'open', term: 'fraud', tag: '' });
  });

  it('deletes a saved view', async () => {
    const user = userEvent.setup();
    render(
      <SavedViews viewsKey="test:del" current={{ filter: 'all', term: '' }} onApply={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: 'Saved views' }));
    await user.type(screen.getByPlaceholderText(/Name this view/), 'Temp');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Temp')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete view Temp' }));
    expect(screen.queryByText('Temp')).toBeNull();
  });

  it('keeps Save disabled until the view has a name', async () => {
    const user = userEvent.setup();
    render(<SavedViews viewsKey="test:x" current={{ filter: 'open', term: '' }} onApply={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Saved views' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
