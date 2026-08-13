/**
 * Applications, below the STRUCTURE line — the same records as a tap-to-detail card list.
 *
 * WHY A SECOND RENDERING RATHER THAN A MIGRATION. The desktop table is 28 columns wide on the
 * Clients tab (21 on Apps) and every one carries an inline pixel `minWidth`, summing to ~3,644px.
 * On a 375px Telegram Mini App viewport that is ten screens of sideways scrolling with no column
 * pinned, which is the single worst surface in Customer Service on a phone. But the desktop table is
 * also correct and in daily use, and `ds/DataTable` in table mode renders `ds/Table`'s markup and
 * styling rather than `.cs-app-table` — so migrating the component would restyle the desktop by
 * definition. Mounting DataTable ONLY below 640 gets the designed card list and leaves the desktop
 * code path untouched, byte for byte.
 *
 * ONE COLUMN DEFINITION, TWO RENDERINGS. This maps `columnsFor(subTab)` — the exact array the table
 * uses — onto `DataColumn`, and every cell delegates to `AppCell`, the exact renderer the `<td>`s
 * use. `AppCell` already returns INLINE content (a `<div>`/`<span>`, never a `<td>`), which is the
 * property `DataTable`'s docblock calls out as what makes this cheap. Nothing is re-implemented, so
 * a new column or a changed formatter reaches the phone for free and cannot drift.
 */
import { useMemo } from 'react';

import { Button } from '@/ds';
import { DataTable, type DataColumn, type DataColumnMobile } from '@/ds/DataTable';
import { AppCell, type AppColumn, type SubTab } from './ApplicationsTable';
import type { Application } from './data';

/**
 * Which of the 28 columns earn a place on the 64px card row. Keyed by LABEL because the column array
 * repeats `key: 'generic'` across MC / DOT / Email / Trucks, so `key` does not identify a column —
 * the label does, and it is unique within each tab's set.
 *
 * Everything not named here is `hidden`, which does NOT mean dropped: hidden columns move to the
 * detail sheet, and `expectDataParity` asserts the union of card + sheet still equals what the table
 * showed. Card first, sheet for the rest.
 */
const CARD_ROLE: Record<string, DataColumnMobile> = {
  Company: 'primary',
  'App ID': 'secondary',
  'Carrier ID': 'secondary',
  Stage: 'value',
};

export interface ApplicationsPhoneListProps {
  rows: readonly Application[];
  subTab: SubTab;
  columns: readonly AppColumn[];
  /** `${appId}|${field}` of the onboarding toggle in flight, or null — same contract as AppRow. */
  pendingToggle: string | null;
  /** Opens the full editable record (ApplicationModal), the phone equivalent of Enter on a row. */
  onOpenRow: (app: Application) => void;
}

export function ApplicationsPhoneList({
  rows,
  subTab,
  columns,
  pendingToggle,
  onOpenRow,
}: ApplicationsPhoneListProps) {
  const dataColumns = useMemo<DataColumn<Application>[]>(
    () =>
      columns.map((col, i) => {
        const busyFor = (app: Application) =>
          pendingToggle?.startsWith(`${app.id}|`) ? pendingToggle.slice(app.id.length + 1) : null;
        const role = CARD_ROLE[String(col.label)];
        return {
          // `field` disambiguates the repeated `generic` key; the index is the last resort so two
          // columns can never collide on a React key or a <dt> anchor.
          id: `${col.key}:${col.field ?? col.label}:${i}`,
          header: col.label,
          cell: (app: Application) => (
            <AppCell col={col} app={app} subTab={subTab} busyField={busyFor(app)} />
          ),
          ...(role ? { mobile: role } : {}),
          // The identity column carries `<th scope="row">` and the sticky pin, and DataTable refuses
          // to drop it — which is what lets a screen reader answer "which application is this?".
          ...(col.label === 'Company' ? { rowHeader: true } : {}),
        };
      }),
    [columns, subTab, pendingToggle],
  );

  return (
    <div className="cs-app-phone-list">
      <DataTable
        caption={subTab === 'clients' ? 'Clients' : 'Applications in process'}
        rows={rows}
        rowKey={(app) => app.id}
        columns={dataColumns}
        density="compact"
        detail={{
          title: (app) => app.company || '—',
          subtitle: (app) => (subTab === 'clients' ? app.carrierId : app.appId) || '—',
          /*
           * The sheet is the whole record but it is READ-ONLY — the onboarding tick boxes and the
           * copy-on-cell-click affordance are both `<td>`-level behaviours that card mode
           * deliberately does not carry. So the sheet ends with the way through to the real editable
           * record, rather than pretending to be it.
           */
          footer: (app) => (
            <Button variant="primary" onClick={() => onOpenRow(app)}>
              Open full record
            </Button>
          ),
        }}
      />
    </div>
  );
}
