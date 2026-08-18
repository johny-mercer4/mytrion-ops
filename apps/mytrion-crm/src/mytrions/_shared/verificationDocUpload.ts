/**
 * WHAT A VERIFICATION DOCUMENT UPLOAD ACCEPTS. One definition, for both desks.
 *
 * The server is the authority — `documentService.upload` refuses anything outside its MIME allowlist
 * with a 415 naming the file and what is accepted. This mirrors that list on the client for two
 * reasons, and neither of them is validation:
 *
 *  1. `accept=` on the file input, so the OS picker greys out files that were always going to be
 *     refused. Without it the agent's own file browser offers a `.pages` or a `.zip` cheerfully.
 *  2. A pre-flight check, so the refusal is INSTANT and names the file — rather than a 20 MB upload
 *     over a phone tether that ends in a 415 the agent has to interpret.
 *
 * The client never decides an upload is OK. It only declines early the ones the server would decline
 * anyway; anything it passes still goes through the server's own check.
 *
 * It lives in `_shared` because BOTH Mytrions upload these documents — Sales on the intake form,
 * Verification on the case aside — and neither Mytrion may import from the other.
 */

/** Mirrors `ALLOWED_MIME` in `src/modules/verificationFlow/documentService.ts`. */
const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Extensions, for the two cases a MIME type cannot answer.
 *
 * A browser reports `File.type` from the OS association, and it comes back EMPTY often enough to
 * matter: `.heic` off an iPhone on a Windows machine, `.csv` with no spreadsheet installed, and any
 * file whose extension the OS does not know. Rejecting an empty type outright would refuse files the
 * server accepts, so the extension is the fallback and only an actively WRONG type is refused.
 */
const ALLOWED_EXT: readonly string[] = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.heic',
  '.webp',
  '.xlsx',
  '.xls',
  '.csv',
  '.doc',
  '.docx',
];

/** For `accept=`. Both MIME types and extensions, because pickers honour whichever they understand. */
export const DOC_ACCEPT = [...ALLOWED_MIME, ...ALLOWED_EXT].join(',');

/** `MAX_DOCUMENT_BYTES` in `documentService.ts`. */
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

/** What the agent sees in a hint line, so the rule is stated before it is enforced. */
export const DOC_ACCEPT_HINT = 'PDF, image, spreadsheet or Word document · up to 20 MB';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * The server's own refusals, said early and in the same words.
 *
 * Returns null when the file should be sent. The messages match `documentService.upload`'s so an
 * agent cannot be told two different things about one file depending on how far it got.
 */
export function rejectionFor(file: File): string | null {
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_DOC_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)} — larger than the 20 MB limit.`;
  }
  const ext = extensionOf(file.name);
  const typeOk = file.type !== '' && ALLOWED_MIME.has(file.type);
  const extOk = ALLOWED_EXT.includes(ext);
  // An unknown MIME with a known extension passes: the server reads the bytes, not the browser's guess.
  if (typeOk || extOk) return null;
  return `"${file.name}" is not a supported file. Upload a ${DOC_ACCEPT_HINT.split(' · ')[0]}.`;
}

/** The first refusal across a multi-file pick, so a bad file never leaves a partial upload behind. */
export function firstRejection(files: readonly File[]): string | null {
  for (const file of files) {
    const reason = rejectionFor(file);
    if (reason) return reason;
  }
  return null;
}
