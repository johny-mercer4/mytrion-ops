/**
 * "Does the card show the same data as the table?" — as one assertion.
 *
 * A DataTable migration replaces a hand-written `<table>` with a column array, and the risk that
 * matters is not that it looks wrong: it is that a column quietly stops rendering. On a desktop
 * that is visible in review. In card mode it is invisible by design, because most columns are
 * *supposed* to be off the card — they moved to the detail sheet. So the only honest check is that
 * the union of what the card shows and what the sheet shows still equals what the table showed.
 *
 * Test-only. Imported by `*.test.tsx`, never by app code.
 *
 * Compares SETS of non-empty strings, not sequences: the card deliberately reorders (primary first,
 * value last) and the sheet is ordered by column definition, so any order-sensitive comparison
 * would fail on a correct migration.
 */
import { fireEvent, render, screen, within, cleanup } from '@testing-library/react';
import { act } from 'react';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { setViewport, DESKTOP_WIDTH } from '../../test/viewport';

/**
 * The DATA a container shows — body cells and `<dd>` values, never headers.
 *
 * Column headers are excluded deliberately: they come from the same `columns` array in both
 * renderings, so comparing them would assert the array equals itself. What can actually go missing
 * is a row's values.
 */
function dataIn(root: HTMLElement, selector: string): Set<string> {
  const out = new Set<string>();
  for (const node of root.querySelectorAll(selector)) {
    const text = node.textContent?.trim();
    if (text) out.add(text);
  }
  return out;
}

function cardText(root: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const item of root.querySelectorAll('li')) {
    const text = item.textContent?.trim();
    if (text) out.add(text);
  }
  return out;
}

export interface ParityOptions {
  /** Rendered at both widths. Must be the same element, so the two renderings share a definition. */
  element: ReactElement;
  /** Phone width to compare at. Default 375 (iPhone SE). */
  phoneWidth?: number;
  /**
   * Values the table shows that are deliberately NOT reachable on a phone — a hover-only action
   * label, a column explicitly given `detail: false`. Anything listed here is a decision, and
   * writing it down at the call site is the point.
   */
  droppedOnMobile?: readonly string[];
}

/**
 * Renders `element` at desktop and at phone width and asserts no data was lost in between.
 *
 * On a phone it opens each card's detail sheet in turn, so the comparison covers the sheet as well
 * as the card row — which is where most columns end up.
 */
export async function expectDataParity({
  element,
  phoneWidth = 375,
  droppedOnMobile = [],
}: ParityOptions): Promise<void> {
  setViewport(DESKTOP_WIDTH);
  const desktop = render(element);
  const table = desktop.container.querySelector('table');
  expect(table, 'expected a real <table> at desktop width').not.toBeNull();
  // tbody only, and `th` within it — a th[scope=row] IS the row's identity value.
  const desktopValues = dataIn(table as HTMLElement, 'tbody td, tbody th');
  cleanup();

  await act(async () => {
    setViewport(phoneWidth);
  });
  const phone = render(element);
  const list = phone.container.querySelector('ul[role="list"]');
  expect(list, 'expected a card list below the structure line').not.toBeNull();

  const phoneValues = cardText(list as HTMLElement);

  // Open every card in turn and fold the sheet's <dd> values in.
  const cards = [...(list as HTMLElement).querySelectorAll('button')];
  for (const card of cards) {
    await act(async () => {
      fireEvent.click(card);
    });
    const dialog = document.querySelector('dialog');
    if (!dialog) continue;
    for (const value of dataIn(dialog as HTMLElement, 'dd')) phoneValues.add(value);
    // Close so the next card opens cleanly.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
  }

  const dropped = new Set(droppedOnMobile);
  const missing = [...desktopValues].filter((value) => {
    if (dropped.has(value)) return false;
    // A card row concatenates several cells into one string, so a desktop cell counts as present
    // when any phone string contains it.
    for (const candidate of phoneValues) if (candidate.includes(value)) return false;
    return true;
  });

  expect(
    missing,
    `These values render in the table but are unreachable on a phone — neither on the card nor in ` +
      `its detail sheet. Either give the column a mobile role, leave it in the sheet (detail is ` +
      `true by default), or list it in droppedOnMobile with a reason.`,
  ).toEqual([]);

  cleanup();
  setViewport(DESKTOP_WIDTH);
}

/** Re-exported so a call site needs one import. */
export { screen, within };
