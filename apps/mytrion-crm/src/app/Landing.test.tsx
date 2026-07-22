/**
 * Landing hard rules: 0 accessible → Forbidden; exactly 1 → ALWAYS auto-navigate (home state
 * irrelevant — the picker can never appear for a single-Mytrion user); home → navigate;
 * multi-access with no home → picker.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { UserContext } from '../context/userContext';

const mockCtx = vi.hoisted(() => ({ current: {} as Partial<UserContext> }));
vi.mock('../context/UserContextProvider', () => ({
  useUserContext: () => ({
    userId: 'u-1',
    profile: 'Sales Agent',
    role: '',
    userName: 'Daniel Brown',
    trusted: true,
    ...mockCtx.current,
  }),
}));
// Stub the picker so this test doesn't mount TopBar/ActAsPicker (session/api heavy).
vi.mock('./MytrionPicker', () => ({
  MytrionPicker: ({ ids }: { ids: string[] }) => <div data-testid="picker">picker:{ids.join(',')}</div>,
}));

import { Landing } from './Landing';

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/main']}>
      <Routes>
        <Route path="/main" element={<Landing />} />
        <Route path="/main/:slug" element={<ProbeSlug />} />
      </Routes>
    </MemoryRouter>,
  );
}

import { useParams } from 'react-router-dom';
function ProbeSlug() {
  const { slug } = useParams();
  return <div data-testid="entered">{slug}</div>;
}

describe('Landing', () => {
  it('exactly one accessible Mytrion auto-enters it even with NO home set', () => {
    mockCtx.current = { accessibleMytrions: ['sales'], homeMytrion: null, allDepartmentAccess: false };
    renderLanding();
    expect(screen.getByTestId('entered').textContent).toBe('salesmytrion');
    expect(screen.queryByTestId('picker')).toBeNull();
  });

  it('a granted home wins for multi-access users', () => {
    mockCtx.current = { accessibleMytrions: ['sales', 'billing'], homeMytrion: 'sales', allDepartmentAccess: false };
    renderLanding();
    expect(screen.getByTestId('entered').textContent).toBe('salesmytrion');
  });

  it('zero accessible renders Forbidden', () => {
    mockCtx.current = { accessibleMytrions: [], homeMytrion: null, allDepartmentAccess: false, profile: 'Nobody' };
    renderLanding();
    expect(screen.queryByTestId('entered')).toBeNull();
    expect(screen.queryByTestId('picker')).toBeNull();
  });

  it('multi-access with no home shows the picker (admins)', () => {
    mockCtx.current = { accessibleMytrions: ['sales', 'billing'], homeMytrion: null, allDepartmentAccess: true };
    renderLanding();
    expect(screen.getByTestId('picker').textContent).toContain('sales');
    expect(screen.queryByTestId('entered')).toBeNull();
  });
});
