/**
 * TopBar "Switch Mytrion" gating: the link back to the picker renders only when the user has
 * MORE than one accessible Mytrion — a Sales agent must never be offered the picker route.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UserContext } from '../context/userContext';

const mockCtx = vi.hoisted(() => ({ current: {} as Partial<UserContext> }));
vi.mock('../context/UserContextProvider', () => ({
  useUserContext: () => ({
    userId: 'u-1',
    profile: 'Sales Agent',
    role: '',
    userName: 'Daniel Brown',
    trusted: false,
    ...mockCtx.current,
  }),
}));
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark', toggle: vi.fn() }) }));
vi.mock('./ActAsPicker', () => ({ ActAsPicker: () => <div data-testid="act-as" /> }));
vi.mock('../api/auth', () => ({ logout: vi.fn() }));

import { TopBar } from './TopBar';

function renderBar() {
  return render(
    <MemoryRouter>
      <TopBar showSwitch />
    </MemoryRouter>,
  );
}

describe('TopBar switch link', () => {
  it('hidden for a single-Mytrion user even when the shell asks for it', () => {
    mockCtx.current = { accessibleMytrions: ['sales'], allDepartmentAccess: false };
    renderBar();
    expect(screen.queryByText('Switch Mytrion')).toBeNull();
  });

  it('shown when there is more than one Mytrion to switch to', () => {
    mockCtx.current = { accessibleMytrions: ['sales', 'billing'], allDepartmentAccess: false };
    renderBar();
    expect(screen.getByText('Switch Mytrion')).toBeInTheDocument();
  });
});
