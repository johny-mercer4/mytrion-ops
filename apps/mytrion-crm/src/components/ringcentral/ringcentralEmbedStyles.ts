/**
 * CSS injected into RingCentral Embeddable via stylesUri.
 *
 * Must NOT be hosted on localhost / private IPs — apps.ringcentral.com cannot
 * fetch loopback (Chrome Private Network Access). A data: URI is applied with
 * a plain <link rel="stylesheet"> inside the widget, so it works locally and in prod.
 */
export const RINGCENTRAL_EMBED_CSS = `
button,
[role="button"],
a,
.Button_root,
.MuiButtonBase-root,
.MuiIconButton-root,
.MuiFab-root,
[class*="Button"],
[class*="Fab"],
[class*="Header"],
[class*="Dock"],
[class*="Minimized"],
[class*="Presence"],
[class*="Drag"] {
  cursor: pointer !important;
}

input,
textarea,
select,
[contenteditable="true"] {
  cursor: text !important;
}
`.replace(/\s+/g, ' ').trim();

export function ringcentralStylesDataUri(): string {
  return `data:text/css;charset=utf-8,${encodeURIComponent(RINGCENTRAL_EMBED_CSS)}`;
}
