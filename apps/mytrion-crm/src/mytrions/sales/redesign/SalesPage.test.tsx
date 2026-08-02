/**
 * Guards the two page-chrome rules the Sales module kept breaking:
 *
 *  1. a tab never re-prints the section name the shell's top bar already shows (the "double shell");
 *  2. there is exactly ONE loading visual on screen at a time (no spinner + skeleton pair).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerTaskPage } from '@/api/salesKpi';
import { NAV, NAV_DESC } from './salesData';
import { SalesPage, SalesPageHead, SalesSubTabs } from './SalesPage';

const state = vi.hoisted(() => ({
  tasks: {
    data: null as WorkerTaskPage | null,
    loading: true,
    revalidating: false,
    error: null as string | null,
    reload: vi.fn(),
    cachedAt: null,
  },
}));

vi.mock('./dcCache', () => ({
  useCachedLoad: () => state.tasks,
  writeDcCache: vi.fn(),
  invalidateDcCache: vi.fn(),
}));
vi.mock('@/api/session', () => ({ getSession: () => ({ worker: { zohoUserId: '1' } }) }));
vi.mock('@/context/ImpersonationProvider', () => ({ useImpersonation: () => ({ actingAs: null }) }));
vi.mock('./ctx', () => ({ useSales: () => ({ pushToast: vi.fn() }) }));

const { TasksTab } = await import('./tabs/TasksTab');

function taskPage(): WorkerTaskPage {
  return {
    tasks: [],
    counts: { open: 0, in_progress: 0, completed: 0, cancelled: 0 },
    pagination: { total: 0, limit: 50, offset: 0, hasMore: false },
  };
}

describe('shared Sales page chrome', () => {
  it('renders one metric strip, description and no section-name heading', () => {
    render(
      <SalesPage>
        <SalesPageHead
          description={NAV_DESC.tasks}
          metrics={[{ label: 'Active', value: 3, hint: 'Open + in progress', tone: 'accent' }]}
        />
      </SalesPage>,
    );

    expect(screen.getByText(NAV_DESC.tasks)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // No title was passed, so no heading exists to compete with the top bar's section name.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('exposes sub-tabs as a real tablist with a single selected tab', () => {
    render(
      <SalesSubTabs
        label="Test section"
        value="b"
        onChange={() => {}}
        items={[
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta', count: 4 },
          { id: 'c', label: 'Gamma', soon: true },
        ]}
      />,
    );

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /Gamma/ })).toBeDisabled();
  });

  it('shows exactly one loading region while a tab is cold, and no duplicate section title', () => {
    state.tasks = { ...state.tasks, data: null, loading: true };
    const { container } = render(<TasksTab />);

    // One aria-busy owner: the page shell. The board skeleton inside it is aria-hidden, so a screen
    // reader is told "busy" once rather than once per placeholder block.
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    // The nav label for this section must not appear inside the page body.
    const label = NAV.find((n) => n.id === 'tasks')?.label;
    expect(label).toBe('My Tasks');
    expect(screen.queryByText('My Tasks')).not.toBeInTheDocument();
  });

  it('drops the loading region as soon as data lands', () => {
    state.tasks = { ...state.tasks, data: taskPage(), loading: false };
    const { container } = render(<TasksTab />);

    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    expect(screen.getByText('No assignments yet')).toBeInTheDocument();
  });
});
