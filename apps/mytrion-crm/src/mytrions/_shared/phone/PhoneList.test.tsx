import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhoneList, PhoneListRow } from './PhoneList';

describe('PhoneList', () => {
  it('renders a labelled grouped list and activates a row', async () => {
    const onClick = vi.fn();
    render(
      <PhoneList label="Carriers">
        <PhoneListRow title="Acme Haul" meta="C-16 · Gold" onClick={onClick} />
      </PhoneList>,
    );
    expect(screen.getByRole('list', { name: 'Carriers' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Acme Haul/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
