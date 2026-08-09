/**
 * Drawer/ owns only the anchor and the entrance. Its lifecycle (`useModalDialog`) and its chrome
 * (`ModalChrome`) come from Dialog/, so the two surfaces cannot diverge on Escape, focus return,
 * backdrop dismissal, page scroll locking or scroll ownership.
 */

export { Drawer } from './Drawer';
export type { DrawerProps, DrawerSize } from './Drawer';
