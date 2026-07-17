/**
 * Clipboard helper for the carrier invite links.
 *
 * Resolves to whether the text actually landed on the clipboard, so callers can tell the truth in
 * their toast. `navigator.clipboard.writeText` rejects asynchronously (permission denied, or any
 * non-secure context), which a plain try/catch around the call cannot see — the earlier version
 * swallowed nothing and leaked an unhandled rejection instead.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the execCommand path below — it still works in the contexts where the
    // async Clipboard API is unavailable or blocked.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
