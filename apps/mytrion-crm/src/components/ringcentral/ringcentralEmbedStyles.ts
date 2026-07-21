/**
 * CSS injected into RingCentral Embeddable via stylesUri.
 *
 * Must NOT be hosted on localhost / private IPs — apps.ringcentral.com cannot
 * fetch loopback (Chrome Private Network Access). A data: URI is applied with
 * a plain <link rel="stylesheet"> inside the widget, so it works locally and in prod.
 *
 * Embeddable's docked pill uses grab/move cursors; force a normal pointer everywhere
 * except text fields.
 */
export const RINGCENTRAL_EMBED_CSS = `
*,
*::before,
*::after {
  cursor: pointer !important;
}

html,
body,
#viewport,
#app,
[class*="Dock"],
[class*="Minimized"],
[class*="Header"],
[class*="Drag"],
[class*="draggable"],
[class*="Draggable"],
[draggable="true"] {
  cursor: pointer !important;
}

input,
textarea,
select,
[contenteditable="true"],
input *,
textarea * {
  cursor: text !important;
}
`.replace(/\s+/g, ' ').trim();

/** Raw data: URI — URLSearchParams encodes once when attached to the adapter URL. */
export function ringcentralStylesDataUri(): string {
  return `data:text/css;charset=utf-8,${RINGCENTRAL_EMBED_CSS}`;
}
