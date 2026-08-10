import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { installDialogStub, resetDialogStub } from './dialog';
import { installViewportStubs, resetViewport } from './viewport';

// jsdom implements neither scroll API the chat uses.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => undefined);
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => undefined);

// jsdom implements no CSSOM view module either — no `matchMedia`, no `visualViewport`. Installed
// here rather than per-suite so every consumer of a viewport answers from the same width; see the
// header of ./viewport.ts for why a constant `matches` stopped being sufficient.
installViewportStubs();

// jsdom ships HTMLDialogElement with a reflected `open` and none of showModal/show/close, which
// makes every ds/Dialog and ds/Drawer untestable. See ./dialog.ts for what is and is not faithful.
installDialogStub();

// A suite that narrows the viewport must not hand the next one a phone, and one that unmounts an
// open dialog must not leave it on the modal stack.
afterEach(() => {
  resetViewport();
  resetDialogStub();
});
