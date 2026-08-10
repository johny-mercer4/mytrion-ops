/**
 * Dialog/ ships three public symbols and one internal one.
 *
 * PUBLIC — `Dialog` (the centred modal) and `ConfirmDialog` (Dialog with the safety decisions
 * already made).
 * INTERNAL — `ModalChrome` (the header/body/footer slots) and `useModalDialog` (the whole modal
 * lifecycle). Neither is re-exported from `src/ds`: `ModalChrome` renders a fragment that is only
 * valid inside a grid panel, and `useModalDialog` is a contract between this folder and `Drawer/`,
 * not a public API. `Drawer` imports both directly — that is the intended coupling, and the reason
 * a drawer and a dialog cannot drift apart on Escape, focus or scroll behaviour.
 */

export { Dialog } from './Dialog';
export type { DialogProps, DialogSize } from './Dialog';

export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps, ConfirmTone } from './ConfirmDialog';

export type { DialogCloseReason, FocusTargetRef } from './useModalDialog';
