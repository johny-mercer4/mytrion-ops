/**
 * The reference DataTable migration.
 *
 * This is the assertion every migrated table should carry: the desktop table and the phone card +
 * detail sheet show the SAME data. The risk a migration actually runs is not that it looks wrong —
 * that is visible in review — but that a column quietly stops rendering, which in card mode is
 * invisible by design, because most columns are supposed to be off the card.
 *
 * The panel itself fetches, subscribes to a live bus and owns a timeline drawer, so this tests the
 * COLUMN DEFINITIONS against a fixture rather than mounting the panel. That is the unit that
 * carries the migration risk; the panel's own wiring is unchanged by it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RetentionCaseRow } from '@/api/touchpointTypes';
import { DataTable } from '@/ds';
import { setViewport } from '../../../test/viewport';
import { expectDataParity } from '../../../ds/DataTable/parity';
import { COLUMNS } from './OpenPoolReadonlyPanel';

function caseRow(over: Partial<RetentionCaseRow>): RetentionCaseRow {
  return {
    id: 'c1',
    carrierId: 'CARR-4821',
    zohoDealId: null,
    companyName: 'Northwind Freight',
    applicationId: null,
    agentName: null,
    phaseCode: 'p1',
    statusCode: 'p1_open_pool',
    phaseChangedAt: '2026-08-01T12:00:00Z',
    transactionFrequency: null,
    agentOutcome: null,
    dissatisfactionReason: null,
    reasonNote: null,
    assignedAgentZohoUserId: null,
    poolOwnerZohoUserId: null,
    pendingClaimantZohoUserId: null,
    assignmentCount: 2,
    openPoolAttemptCount: 0,
    ...over,
  } as RetentionCaseRow;
}

const ROWS: RetentionCaseRow[] = [
  caseRow({ id: 'c1' }),
  caseRow({
    id: 'c2',
    carrierId: 'CARR-9033',
    companyName: 'Ridgeline Transport',
    statusCode: 'p1_pool_claim_pending',
    assignmentCount: 1,
  }),
];

const panel = (
  <DataTable
    caption="Deals in the Sales Open Pool."
    rows={ROWS}
    rowKey={(c) => c.id}
    columns={COLUMNS}
    density="compact"
    onRowActivate={() => undefined}
    detail={{ title: (c) => c.companyName || c.carrierId, subtitle: (c) => c.carrierId }}
  />
);

describe('Open Pool — column definitions', () => {
  it('renders every column as a real table on a desktop', () => {
    render(panel);
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Company',
      'Carrier',
      'Quiet',
      'Gallons 90d',
      'Cycle',
      'Status',
      'Window',
    ]);
  });

  it('identifies the row by company, not by position', () => {
    const { container } = render(panel);
    const rowHeader = container.querySelector('tbody th[scope="row"]');
    expect(rowHeader).toHaveTextContent('Northwind Freight');
  });

  it('triages on a phone with who / which / how long / where it stands', () => {
    setViewport(375);
    render(panel);
    const first = screen.getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('Northwind Freight');
    expect(first).toHaveTextContent('CARR-4821');
    // Gallons and cycle count are what you check AFTER deciding a row is worth opening, so they are
    // in the sheet rather than competing for a 375px row.
    expect(first).not.toHaveTextContent('/3');
  });

  it('keeps the row selectable on a desktop', () => {
    // The panel's whole interaction is row-click -> timeline drawer. A migration that dropped that
    // would look correct in a screenshot and be useless in the hand.
    const { container } = render(panel);
    const row = container.querySelector('tbody tr')!;
    expect(row).toHaveAttribute('tabindex', '0');
  });

  /** The one assertion that makes a migration reviewable. */
  it('loses no data between the two renderings', async () => {
    await expectDataParity({ element: panel });
  });
});
