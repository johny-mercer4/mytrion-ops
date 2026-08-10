/**
 * `<dialog>` for jsdom.
 *
 * jsdom 24 ships `HTMLDialogElement` with a reflected `open` attribute and **no `showModal`, no
 * `show`, no `close`**. Since `ds/Dialog` and `ds/Drawer` are built on the native element precisely
 * to get the focus trap, inert background, Escape and the top layer for free (see the docblock in
 * `ds/Dialog/useModalDialog.ts`), that makes every modal in the design system untestable — the first
 * line of the open effect throws `el.showModal is not a function`.
 *
 * So this implements the parts of the spec the hook actually depends on. It is NOT a full
 * implementation, and deliberately so — the two headline features are things jsdom cannot model at
 * all:
 *
 *   - THE TOP LAYER does not exist here. jsdom has no layout and no paint, so "renders above every
 *     stacking context" is not observable in a test. That property has to be checked in a browser;
 *     `docs/design/FOUNDATIONS.md` and the manual sweep cover it.
 *   - INERTNESS is not enforced. jsdom will happily let a test click a button behind an open modal.
 *     Do not write a test that asserts the background is unreachable — it would pass here and prove
 *     nothing.
 *
 * What IS faithful, and what the tests may rely on:
 *   - `open` flips, so `dialog.open` and the `[open]` CSS selector behave.
 *   - `close()` fires a NON-bubbling `close` event, which is why `useModalDialog` attaches it with
 *     `addEventListener` rather than React's `onClose` prop.
 *   - Escape fires a **cancelable `cancel`** event on the top-most modal dialog, and closes only if
 *     nothing called `preventDefault()`. `useModalDialog` always prevents it and reports the request
 *     upward instead, so this is the exact path that keeps a controlled dialog from lying about its
 *     own state.
 *   - Modals stack, so Escape reaches the innermost one — the confirm-inside-a-drawer case the
 *     scroll-lock counter exists for.
 */

/** Innermost last, matching the real top layer. */
const modalStack: HTMLDialogElement[] = [];

function topMost(): HTMLDialogElement | undefined {
  return modalStack[modalStack.length - 1];
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const dialog = topMost();
  if (!dialog) return;
  // Cancelable: the default action is to close. useModalDialog prevents it every time and asks the
  // parent to flip `open` instead, so the exit animation still gets to run.
  const proceed = dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  if (proceed) dialog.close();
}

export function installDialogStub(): void {
  const proto = HTMLDialogElement.prototype;
  // If a future jsdom implements this for real, defer to it — a stub that shadows a real
  // implementation is how a suite starts passing against behaviour the browser does not have.
  if (typeof proto.showModal === 'function') return;

  proto.showModal = function showModal(this: HTMLDialogElement): void {
    if (this.open) return;
    this.open = true;
    modalStack.push(this);
  };

  proto.show = function show(this: HTMLDialogElement): void {
    this.open = true;
  };

  proto.close = function close(this: HTMLDialogElement, returnValue?: string): void {
    if (!this.open) return;
    this.open = false;
    const index = modalStack.indexOf(this);
    if (index >= 0) modalStack.splice(index, 1);
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new Event('close'));
  };

  document.addEventListener('keydown', onKeyDown);
}

/** Per-test cleanup, so a suite that unmounts an open dialog cannot leave one on the stack. */
export function resetDialogStub(): void {
  modalStack.length = 0;
}
