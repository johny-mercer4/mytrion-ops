import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { installViewportStubs, resetViewport } from './viewport';

// jsdom implements neither scroll API the chat uses.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => undefined);
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => undefined);

// jsdom implements no CSSOM view module either — no `matchMedia`, no `visualViewport`. Installed
// here rather than per-suite so every consumer of a viewport answers from the same width; see the
// header of ./viewport.ts for why a constant `matches` stopped being sufficient.
installViewportStubs();

// A suite that narrows the viewport must not hand the next one a phone.
afterEach(resetViewport);
