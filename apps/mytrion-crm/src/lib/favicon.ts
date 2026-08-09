/**
 * The tab icon, painted in the Horizon ramp for the ACTIVE theme.
 *
 * Two ways to make a favicon theme-aware, and only one of them is right here:
 *
 *   1. `@media (prefers-color-scheme)` inside an SVG favicon. Follows the OPERATING SYSTEM, which
 *      is the wrong signal — this app's theme is a `data-theme` attribute the user sets with the
 *      header toggle, so a user on a light OS who chose dark in-app would get the light icon.
 *   2. Rewrite the <link rel="icon"> href when the theme changes. Follows the app. This is that.
 *
 * The mark is the same chevron as index.html, stroked with the theme's own ramp — cyan→pink in
 * dark, blue→teal in light — so the tab reads as the product in either OS chrome.
 *
 * Values are duplicated from styles/theme.css rather than read from the cascade on purpose: this
 * runs inside the same pre-paint path that sets `data-theme`, so getComputedStyle would return the
 * OUTGOING theme's colours for one frame and the icon would lag the UI by a tick.
 */
export type FaviconTheme = 'dark' | 'light';

/** --tint → --secondary, i.e. the two ends of `--ramp` in styles/theme.css. */
const RAMP: Record<FaviconTheme, readonly [string, string]> = {
  dark: ['#47d6ff', '#ffaede'],
  light: ['#0057ff', '#00677f'],
};

function svg(theme: FaviconTheme): string {
  const [from, to] = RAMP[theme];
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">',
    `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>`,
    '</linearGradient></defs>',
    '<path d="M15,85 L15,25 L40,65 L50,80 L60,65 L85,25 L85,85" fill="none" stroke="url(#g)"',
    ' stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg>',
  ].join('');
}

export function applyFavicon(theme: FaviconTheme): void {
  // encodeURIComponent, not base64: a data: URI with raw `#` would terminate the URL at the first
  // gradient stop and the browser would fetch a truncated document.
  const href = `data:image/svg+xml,${encodeURIComponent(svg(theme))}`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = href;
}
