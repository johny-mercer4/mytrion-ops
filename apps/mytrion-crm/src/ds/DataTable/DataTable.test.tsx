import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setViewport } from '../../test/viewport';
import { DataTable, type DataColumn } from './DataTable';
import { expectDataParity } from './parity';

interface Row {
  id: string;
  carrier: string;
  unit: string;
  date: string;
  amount: string;
  status: string;
  driver: string;
}

const ROWS: Row[] = [
  {
    id: 'a',
    carrier: 'Northwind Freight',
    unit: 'Unit 302',
    date: 'Mar 14',
    amount: '$1,240.55',
    status: 'Docs Pending',
    driver: 'D. Carter',
  },
  {
    id: 'b',
    carrier: 'Ridgeline Transport',
    unit: 'Unit 117',
    date: 'Mar 14',
    amount: '$884.20',
    status: 'Active',
    driver: 'M. Ortiz',
  },
];

const COLUMNS: DataColumn<Row>[] = [
  { id: 'carrier', header: 'Carrier', cell: (r) => r.carrier, mobile: 'primary', rowHeader: true },
  { id: 'unit', header: 'Unit', cell: (r) => r.unit, mobile: 'secondary' },
  { id: 'date', header: 'Date', cell: (r) => r.date, mobile: 'secondary', priority: 2 },
  { id: 'driver', header: 'Driver', cell: (r) => r.driver, priority: 3 },
  { id: 'status', header: 'Status', cell: (r) => r.status, mobile: 'value' },
  { id: 'amount', header: 'Amount', cell: (r) => r.amount, numeric: true },
];

const table = (extra: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) => (
  <DataTable
    caption="Open applications"
    rows={ROWS}
    rowKey={(r) => r.id}
    columns={COLUMNS}
    detail={{ title: (r) => r.carrier }}
    {...extra}
  />
);

describe('DataTable — table mode', () => {
  it('renders a real table with the caption as its accessible name', () => {
    render(table());
    expect(screen.getByRole('table', { name: 'Open applications' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('identifies each row with a th scope=row and pins it', () => {
    const { container } = render(table({ stickyFirstColumn: true }));
    const rowHeader = container.querySelector('tbody th[scope="row"]');
    expect(rowHeader).toHaveTextContent('Northwind Freight');
    // The pin is data-driven, not positional: `:first-child` would land on a hidden cell the moment
    // any column drops out, and display:none does not change which element is first.
    expect(rowHeader).toHaveAttribute('data-pin', 'true');
  });

  it('publishes column priority on the header AND every cell, so they hide together', () => {
    const { container } = render(table());
    const dateHeader = [...container.querySelectorAll('th')].find(
      (th) => th.textContent === 'Date',
    );
    expect(dateHeader).toHaveAttribute('data-priority', '2');
    expect(container.querySelectorAll('td[data-priority="2"]')).toHaveLength(ROWS.length);
  });

  it('refuses to make the identity column droppable', () => {
    // A hidden rowHeader would leave the sticky pin on an invisible cell, so the priority is
    // dropped rather than obeyed.
    const { container } = render(
      table({
        columns: COLUMNS.map((c) => (c.rowHeader ? { ...c, priority: 3 as const } : c)),
      }),
    );
    const rowHeader = container.querySelector('tbody th[scope="row"]');
    expect(rowHeader).not.toHaveAttribute('data-priority');
  });

  it('shows the empty state instead of an empty grid', () => {
    render(table({ rows: [], empty: 'No applications match this filter.' }));
    expect(screen.getByText('No applications match this filter.')).toBeInTheDocument();
  });
});

describe('DataTable — card mode', () => {
  const renderPhone = (extra = {}) => {
    setViewport(375);
    return render(table(extra));
  };

  it('replaces the table with a labelled list', () => {
    renderPhone();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('list', { name: 'Open applications' })).toBeInTheDocument();
  });

  it('builds the row from primary + joined secondaries + one value', () => {
    renderPhone();
    const first = screen.getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('Northwind Freight');
    expect(first).toHaveTextContent('Unit 302 · Mar 14');
    expect(first).toHaveTextContent('Docs Pending');
    // Columns with no mobile role stay off the card — they are in the sheet, not squeezed in here.
    expect(first).not.toHaveTextContent('D. Carter');
  });

  it('makes the row a real button that announces it opens a dialog', () => {
    renderPhone();
    const card = screen.getAllByRole('button')[0]!;
    expect(card).toHaveAttribute('aria-haspopup', 'dialog');
    // Enter and Space come free from <button>; a clickable div would need two keydown handlers.
    expect(card.tagName).toBe('BUTTON');
  });

  it('opens the record in a sheet as a <dl>, not a two-column table', () => {
    renderPhone();
    fireEvent.click(screen.getAllByRole('button')[0]!);

    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('dl')).not.toBeNull();
    expect(dialog.querySelector('table')).toBeNull();

    const pairs = [...dialog.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(pairs).toEqual(['Carrier', 'Unit', 'Date', 'Driver', 'Status', 'Amount']);
    expect(dialog).toHaveTextContent('D. Carter');
  });

  it('honours detail:false and mobileCell', () => {
    renderPhone({
      columns: COLUMNS.map((c) =>
        c.id === 'driver'
          ? { ...c, detail: false }
          : c.id === 'unit'
            ? { ...c, mobileCell: () => 'compact' }
            : c,
      ),
    });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('compact');

    fireEvent.click(screen.getAllByRole('button')[0]!);
    const dialog = document.querySelector('dialog')!;
    expect([...dialog.querySelectorAll('dt')].map((d) => d.textContent)).not.toContain('Driver');
  });

  it('defers to onRowActivate when the caller already owns a detail view', () => {
    const onRowActivate = vi.fn();
    renderPhone({ onRowActivate });
    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(onRowActivate).toHaveBeenCalledWith(ROWS[0]);
    // The caller's modal is the detail view; DataTable must not also open one.
    expect(document.querySelector('dialog')?.open).not.toBe(true);
  });

  it('is not interactive when there is nothing to open', () => {
    setViewport(375);
    render(
      <DataTable caption="Read only" rows={ROWS} rowKey={(r) => r.id} columns={COLUMNS} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DataTable — crossing the structure line', () => {
  it('switches rendering without the caller re-mounting anything', async () => {
    const view = render(table());
    expect(screen.getByRole('table')).toBeInTheDocument();

    await act(async () => setViewport(375));
    view.rerender(table());
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('renders the table when matchMedia is unavailable', () => {
    // The ds library build ships into a design-tool sandbox with no CSSOM view module. Falling back
    // to the canonical desktop rendering there is deliberate — a card list is not measurable.
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    try {
      render(table());
      expect(screen.getByRole('table')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    }
  });
});

describe('DataTable — parity', () => {
  it('loses no data between the two renderings', async () => {
    await expectDataParity({ element: table() });
  });
});
