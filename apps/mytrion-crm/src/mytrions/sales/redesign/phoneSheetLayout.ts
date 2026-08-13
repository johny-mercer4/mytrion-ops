/**
 * Sales overlay geometry: centered dialog on desktop, bottom sheet on phone (structure line 640).
 * Shared by Data Center DetailSheet and ClientModal so Verification / client / lead / deal
 * all sit the same way in Telegram.
 */

export const SHEET_BACKDROP_DESKTOP =
  'position:fixed;inset:0;z-index:var(--z-modal);background:var(--scrim);backdrop-filter:blur(var(--scrim-blur));-webkit-backdrop-filter:blur(var(--scrim-blur));display:flex;align-items:center;justify-content:center;padding:var(--space-6)';

export const SHEET_BACKDROP_PHONE =
  'position:fixed;inset:0;z-index:var(--z-modal);background:var(--scrim);backdrop-filter:blur(var(--scrim-blur));-webkit-backdrop-filter:blur(var(--scrim-blur));display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;padding:0';

export const SHEET_PANEL_DESKTOP =
  'width:100%;max-height:100%;flex:none;display:flex;flex-direction:column;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);animation:ss-pop var(--duration-normal) var(--ease-decelerate) both;overflow:hidden';

export const SHEET_PANEL_PHONE =
  'width:100%;max-width:100%;max-height:96dvh;flex:none;display:flex;flex-direction:column;border-radius:var(--radius-panel) var(--radius-panel) 0 0;background:var(--surface);border:1px solid var(--border);border-bottom:none;box-shadow:var(--shadow);animation:ss-sheet-up var(--duration-moderate) var(--ease-decelerate) both;overflow:hidden';

export function sheetBackdrop(phone: boolean): string {
  return phone ? SHEET_BACKDROP_PHONE : SHEET_BACKDROP_DESKTOP;
}

export function sheetPanel(phone: boolean, extra = ''): string {
  const base = phone ? SHEET_PANEL_PHONE : SHEET_PANEL_DESKTOP;
  return extra ? `${base};${extra}` : base;
}
