import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewAsPicker } from './ViewAsPicker';

const setActingAs = vi.fn();

vi.mock('@/context/ImpersonationProvider', () => ({
  useImpersonation: () => ({
    mytrionId: 'sales',
    actingAs: {
      zohoUserId: '6227679000000000001',
      name: 'Daniel Brown',
    },
    setActingAs,
  }),
}));

describe('ViewAsPicker', () => {
  beforeEach(() => {
    setActingAs.mockClear();
  });

  it('returns an administrator to their own view from the active banner', () => {
    render(<ViewAsPicker />);

    fireEvent.click(screen.getByRole('button', { name: 'Exit admin view' }));

    expect(setActingAs).toHaveBeenCalledOnce();
    expect(setActingAs).toHaveBeenCalledWith(null);
  });
});
