import '@testing-library/jest-dom/vitest';

// jsdom implements neither scroll API the chat uses.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => undefined);
Element.prototype.scrollTo = Element.prototype.scrollTo ?? ((): void => undefined);
