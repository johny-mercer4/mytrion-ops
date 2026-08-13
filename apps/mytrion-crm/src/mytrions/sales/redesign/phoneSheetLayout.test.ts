import { describe, expect, it } from 'vitest';
import { sheetBackdrop, sheetPanel } from './phoneSheetLayout';

describe('phoneSheetLayout', () => {
  it('centers the dialog on desktop', () => {
    expect(sheetBackdrop(false)).toContain('align-items:center');
    expect(sheetPanel(false)).toContain('ss-pop');
    expect(sheetPanel(false, 'max-width:820px')).toContain('max-width:820px');
  });

  it('anchors a bottom sheet on phone', () => {
    expect(sheetBackdrop(true)).toContain('justify-content:flex-end');
    expect(sheetPanel(true)).toContain('ss-sheet-up');
    expect(sheetPanel(true)).toContain('96dvh');
  });
});
