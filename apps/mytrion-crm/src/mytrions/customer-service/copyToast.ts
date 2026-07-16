/**
 * Copy-to-clipboard with the widget's floating "✓ Copied" toast.
 *
 * The toast is mounted inside `.cs-root` (not document.body): every widget style
 * and CSS variable it relies on is scoped under `.cs-root`, so mounting outside
 * leaves the toast unstyled and invisible. The show state is flipped after a
 * forced reflow rather than via requestAnimationFrame, so the fade-in fires
 * reliably even when the tab isn't the focused window (rAF gets throttled there).
 *
 * Shared by the Applications table cells and the record modal header badge.
 */

function showCopyToast(msg: string, ok: boolean, ev: { clientX: number; clientY: number } | null): void {
  const x = ev ? ev.clientX : window.innerWidth / 2;
  const y = ev ? ev.clientY : window.innerHeight / 2;
  const t = document.createElement('div');
  t.className = `cs-copy-toast${ok ? '' : ' cs-copy-toast-err'}`;
  t.textContent = msg;
  t.style.left = `${x}px`;
  t.style.top = `${y - 14}px`;
  (document.querySelector('.cs-root') ?? document.body).appendChild(t);
  // Commit the base state, then flip to shown so the CSS transition runs.
  void t.offsetWidth;
  t.classList.add('cs-copy-toast-show');
  setTimeout(() => {
    t.classList.remove('cs-copy-toast-show');
    setTimeout(() => t.parentNode && t.parentNode.removeChild(t), 250);
  }, 900);
}

function fallbackCopy(text: string, ev: { clientX: number; clientY: number } | null): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showCopyToast(`✓ Copied ${text}`, true, ev);
  } catch {
    showCopyToast('Copy failed', false, ev);
  }
}

/** Copy `text` to the clipboard and float a toast at the pointer location. */
export function copyWithToast(text: string, ev: { clientX: number; clientY: number } | null): void {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showCopyToast(`✓ Copied ${text}`, true, ev),
        () => fallbackCopy(text, ev),
      );
    } else {
      fallbackCopy(text, ev);
    }
  } catch {
    fallbackCopy(text, ev);
  }
}
