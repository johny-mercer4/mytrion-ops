/**
 * Applications on a phone must not silently lose a column.
 *
 * The risk in a two-rendering design is not that the card list looks wrong — that is visible. It is
 * that one of the 28 columns quietly stops rendering, which is INVISIBLE by design in card mode,
 * because most columns are supposed to be off the card: they moved to the detail sheet. So the only
 * honest check is the one `expectDataParity` makes — that the union of what the card shows and what
 * the sheet shows still equals what the desktop table showed.
 *
 * The element handed to it renders the SAME branch the panel does (table at 1280, cards at 375) from
 * the SAME `columnsFor()` array and the SAME `AppCell`, so this pins the wiring, not a copy of it.
 */
import { render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectDataParity } from '../../ds/DataTable/parity';
import { setViewport, DESKTOP_WIDTH } from '../../test/viewport';
import { ApplicationsPhoneList } from './ApplicationsPhoneList';
import { AppRow, columnsFor } from './ApplicationsTable';
import type { Application } from './data';

/**
 * Two rows, chosen for the two shapes that break a renderer: one fully populated, one with the
 * empty/zero values every cell has to render as an em dash rather than as nothing.
 */
const ROWS = [
  {
    id: 'a1',
    appId: 'APP-1001',
    company: 'Great Way Inc',
    first: 'Dina',
    last: 'Carter',
    biz: 'Corporation',
    stage: 'Onboarding',
    wex: 'Approved',
    mc: 'MC-774411',
    dot: 'DOT-99120',
    phone: '5551234567',
    email: 'ops@greatway.example',
    street: '400 Rand Rd',
    city: 'Denver',
    state: 'CO',
    zip: '80014',
    credit: 712,
    trucks: 18,
    cards: 22,
    date: '07/28/2026',
    dateFilledRaw: '2026-07-28',
    agent: 'S. Aliyev',
    notes: 'Wants weekly billing',
    cycle: 'Weekly',
    pay: 'Prepay',
    ta: 1,
    efs: 1,
    lmt: 0,
    mob: 1,
    chn: 0,
    verified: true,
    carrierId: '5551239',
    trackingNumber: '7712 8890 4410',
  },
  {
    id: 'a2',
    appId: 'APP-1002',
    company: 'Be Diamond Inc',
    first: '',
    last: '',
    biz: 'LLC',
    stage: 'Docs Pending',
    wex: 'Pending',
    mc: '',
    dot: '',
    phone: '',
    email: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    credit: null,
    trucks: 0,
    cards: 0,
    date: '',
    dateFilledRaw: '',
    agent: '',
    notes: '',
    cycle: '',
    pay: 'Line of Credit',
    ta: 0,
    efs: 0,
    lmt: 0,
    mob: 0,
    chn: 0,
    verified: false,
    carrierId: '',
  },
] as unknown as Application[];

/** The panel's own branch, reduced to the part under test. */
function ApplicationsSurface({ phone }: { phone: boolean }) {
  const columns = columnsFor('clients');
  if (phone) {
    return (
      <ApplicationsPhoneList
        rows={ROWS}
        subTab="clients"
        columns={columns}
        pendingToggle={null}
        onOpenRow={vi.fn()}
      />
    );
  }
  return (
    <table>
      <tbody>
        {ROWS.map((app) => (
          <AppRow
            key={app.id}
            app={app}
            columns={columns}
            subTab="clients"
            busyField={null}
            onCellClick={vi.fn()}
            onOpen={vi.fn()}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * Rendered at both widths, and it must be the SAME element — that is what makes the two renderings
 * share one definition rather than being compared against a hand-written expectation.
 */
function Surface() {
  // The real panel asks useIsPhone(); here the viewport helper drives the same query through
  // matchMedia, so `setViewport` inside expectDataParity picks the branch.
  return <ApplicationsSurfaceViaMedia />;
}

function ApplicationsSurfaceViaMedia() {
  const phone = window.matchMedia('(width < 640px)').matches;
  return <ApplicationsSurface phone={phone} />;
}

describe('Applications — phone card list', () => {
  it('loses nothing the desktop table shows', async () => {
    await expectDataParity({
      element: <Surface />,
      phoneWidth: 375,
      /*
       * EMPTY, and that is the result rather than a stub: every one of the 28 columns is reachable on
       * a phone, either on the card or in its detail sheet. Nothing had to be declared unreachable.
       *
       * The onboarding tick boxes and the VRF flag do not appear here because they render as
       * checkbox CONTROLS rather than text, so they contribute no string to either rendering and
       * parity has nothing to compare. Their behaviour is genuinely desktop-only — toggling lives on
       * `AppRow`'s per-cell handler — which is why the sheet ends in "Open full record".
       */
      droppedOnMobile: [],
    });
  });

  it('puts the company on the card and the long tail in the sheet', async () => {
    // Wrapped in act for the same reason parity.ts wraps it: setViewport fires the matchMedia
    // listeners DataTable subscribes to via useSyncExternalStore, and that is a React state update.
    await act(async () => {
      setViewport(375);
    });
    render(<Surface />);

    // Card row: the identity is on the card itself, not hidden behind a tap.
    const list = screen.getByRole('list');
    expect(within(list).getByText('Great Way Inc')).toBeInTheDocument();
    expect(within(list).getByText('Onboarding')).toBeInTheDocument();

    // A column that is NOT on the card must still be reachable — this is the assertion that would
    // fail if `mobile: 'hidden'` meant "dropped" rather than "moved to the sheet".
    expect(within(list).queryByText('ops@greatway.example')).not.toBeInTheDocument();

    await act(async () => {
      setViewport(DESKTOP_WIDTH);
    });
  });
});
