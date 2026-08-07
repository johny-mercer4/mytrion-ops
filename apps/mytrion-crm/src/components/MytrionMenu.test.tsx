/**
 * The workspace switcher. The rule worth pinning: it can only ever offer doors that open — it lists
 * exactly what `resolveAccessibleMytrions` grants, the same resolver the router gates on.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

const access = vi.fn();
vi.mock('../access/resolveAccess', () => ({ resolveAccessibleMytrions: () => access() }));
vi.mock('../context/UserContextProvider', () => ({ useUserContext: () => ({ userName: 'Test' }) }));

import { MytrionMenu } from './MytrionMenu';

beforeEach(() => {
  navigate.mockReset();
  access.mockReturnValue({ accessible: ['hr', 'sales'], isAdmin: true, homeMytrion: null });
});

const open = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }));
};

describe('MytrionMenu', () => {
  it('lists only the workspaces the user may enter', () => {
    render(<MytrionMenu trigger={<span>Switch</span>} />);
    open();
    expect(screen.getByRole('menuitem', { name: /HR Mytrion/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Sales/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Finance/ })).toBeNull();
  });

  it('navigates by slug', () => {
    render(<MytrionMenu trigger={<span>Switch</span>} />);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: /HR Mytrion/ }));
    expect(navigate).toHaveBeenCalledWith('/main/hrmytrion');
  });

  it('marks the current workspace and does not navigate to it', () => {
    render(<MytrionMenu current="hr" trigger={<span>Switch</span>} />);
    open();
    const item = screen.getByRole('menuitem', { name: /HR Mytrion/ });
    expect(item).toHaveTextContent('Current');
    fireEvent.click(item);
    // Re-navigating to where you already are remounts the workspace and discards its state.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still offers the full picker', () => {
    render(<MytrionMenu trigger={<span>Switch</span>} />);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'All workspaces' }));
    expect(navigate).toHaveBeenCalledWith('/main');
  });
});
