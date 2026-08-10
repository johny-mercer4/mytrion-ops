import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineDiff, type DiffLine } from './InlineDiff';

const lines: DiffLine[] = [
  { kind: 'context', text: '  "id": "4417",', before: 1, after: 1 },
  { kind: 'del', text: '  "stage": "Negotiation",', before: 2 },
  { kind: 'add', text: '  "stage": "Closed Won",', after: 2 },
  { kind: 'changed', text: '  "amount": 41200,', before: 3, after: 3 },
];

describe('InlineDiff', () => {
  it('carries the operation outside colour: a gutter marker and a spoken word per line', () => {
    render(<InlineDiff lines={lines} label="deals/4417.json" />);
    const rows = screen.getAllByRole('row');
    // `noUncheckedIndexedAccess` types rows[n] as possibly-undefined. Assert the shape once rather
    // than non-null-asserting six times — if the row count is wrong, that IS the failure worth
    // seeing, and a `!` would hide it behind a confusing "cannot read property of undefined".
    expect(rows).toHaveLength(4); // the four diff lines; the table has no header row
    const [, removed, added, changed] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    expect(within(removed).getByText('-')).toBeInTheDocument();
    expect(within(removed).getByText('Removed.')).toBeInTheDocument();
    expect(within(added).getByText('+')).toBeInTheDocument();
    expect(within(added).getByText('Added.')).toBeInTheDocument();
    expect(within(changed).getByText('~')).toBeInTheDocument();
    expect(within(changed).getByText('Changed.')).toBeInTheDocument();
  });

  it('says nothing extra on an unchanged line', () => {
    render(<InlineDiff lines={lines} />);
    expect(screen.queryByText('Unchanged.')).toBeNull();
  });

  it('summarises the change as text', () => {
    render(<InlineDiff lines={lines} />);
    expect(screen.getByText('1 added, 1 removed, 1 changed')).toBeInTheDocument();
  });

  it('makes the horizontal scroller reachable by keyboard', async () => {
    render(<InlineDiff lines={lines} label="deals/4417.json" />);
    const region = screen.getByRole('group', { name: 'Changes to deals/4417.json' });
    await userEvent.tab();
    expect(region).toHaveFocus();
  });

  it('adds no tab stop when there is nothing to scroll', () => {
    render(<InlineDiff lines={lines} wrap />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('collapses past maxLines and discloses the rest', async () => {
    render(<InlineDiff lines={lines} maxLines={2} />);
    expect(screen.getAllByRole('row')).toHaveLength(2);
    const more = screen.getByRole('button', { name: 'Show all 4 lines' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Show fewer lines' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('renders an empty diff as words, not as an empty box', () => {
    render(<InlineDiff lines={[]} />);
    expect(screen.getAllByText('No changes').length).toBeGreaterThan(0);
  });
});
